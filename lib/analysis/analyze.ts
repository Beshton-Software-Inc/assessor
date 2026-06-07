import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { GoogleGenAI, createPartFromUri, FileState } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import {
  convertWebmToMp4,
  downloadRecordingToFile,
  getSessionForDownload,
  type DownloadableSession,
} from "@/lib/sessions/download";
import { renderAnalysisPdf, type AnalysisResult } from "./pdf";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface AnalysisRow {
  id: string;
  session_id: string;
  created_at: string;
  model: string;
  prompt_hash: string;
  pdf_path: string | null;
  result: AnalysisResult;
  status: string;
}

const PROMPT_PATH = resolvePath(process.cwd(), "prompts/video-analysis-prompt.md");

export async function loadPrompt(): Promise<{ text: string; hash: string }> {
  const text = await readFile(PROMPT_PATH, "utf8");
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return { text, hash };
}

/**
 * Uploads the local mp4 to Gemini's Files API and waits until it's ACTIVE.
 * Video files take a few seconds to process before they can be referenced
 * in a generateContent call.
 */
async function uploadAndWait(
  ai: GoogleGenAI,
  mp4Path: string,
): Promise<{ uri: string; mimeType: string; name: string }> {
  const uploaded = await ai.files.upload({
    file: mp4Path,
    config: { mimeType: "video/mp4" },
  });
  if (!uploaded.name) throw new Error("Gemini upload returned no file name");

  let current = uploaded;
  const start = Date.now();
  const timeoutMs = 5 * 60 * 1000;
  while (current.state === FileState.PROCESSING) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Gemini file processing timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 3000));
    current = await ai.files.get({ name: current.name! });
  }
  if (current.state !== FileState.ACTIVE) {
    throw new Error(
      `Gemini file processing failed: state=${current.state} ${current.error?.message ?? ""}`,
    );
  }
  if (!current.uri || !current.mimeType) {
    throw new Error("Gemini file lacks uri/mimeType after processing");
  }
  return { uri: current.uri, mimeType: current.mimeType, name: current.name! };
}

function tryParseJson(text: string): AnalysisResult {
  // Gemini sometimes wraps JSON in ```json fences despite instructions.
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(stripped) as AnalysisResult;
  } catch (e) {
    throw new Error(
      `Could not parse Gemini response as JSON: ${(e as Error).message}\n--- response ---\n${text.slice(0, 800)}`,
    );
  }
}

export interface RunAnalysisOptions {
  /**
   * If provided, use this local mp4 path instead of downloading + converting
   * the recording. Mainly used by the CLI when the user just downloaded the
   * file and wants to skip a redundant fetch.
   */
  mp4Path?: string;
  /**
   * If provided, also write the PDF to this local path in addition to
   * uploading it to Storage.
   */
  localPdfPath?: string;
}

export interface RunAnalysisResult {
  session: DownloadableSession;
  analysis: AnalysisRow;
  pdfBytes: Uint8Array;
  rawText: string;
}

/**
 * End-to-end pipeline: pick session → ensure mp4 → call Gemini → render PDF →
 * upload PDF to Storage → insert analyses row. Returns the row + PDF bytes.
 *
 * Linking: `session_id` is the single key that ties video, analysis row, and
 * PDF together. The PDF lives at `{recordingsBucket}/{session_id}/analysis-{analysis_id}.pdf`,
 * the recording lives at `{recordingsBucket}/{session_id}/recording.webm`.
 */
export async function runAnalysis(
  supabase: SupabaseClient,
  sessionId: string,
  opts: RunAnalysisOptions = {},
): Promise<RunAnalysisResult> {
  const session = await getSessionForDownload(supabase, sessionId);

  let mp4Path = opts.mp4Path;
  let cleanupDir: string | null = null;
  if (!mp4Path) {
    cleanupDir = await mkdtemp(join(tmpdir(), "academic-assessor-"));
    const webm = join(cleanupDir, "recording.webm");
    mp4Path = join(cleanupDir, "recording.mp4");
    await downloadRecordingToFile(supabase, session.recordingPath, webm);
    await convertWebmToMp4(webm, mp4Path);
  }

  try {
    const { text: promptText, hash: promptHash } = await loadPrompt();
    const model = serverEnv.geminiModel();
    const ai = new GoogleGenAI({ apiKey: serverEnv.geminiApiKey() });

    const file = await uploadAndWait(ai, mp4Path);

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            createPartFromUri(file.uri, file.mimeType),
            { text: promptText },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.4,
      },
    });

    const rawText = response.text ?? "";
    if (!rawText.trim()) throw new Error("Gemini returned empty response");
    const result = tryParseJson(rawText);

    const pdfBytes = await renderAnalysisPdf({
      session: {
        id: session.id,
        createdAt: session.createdAt,
        durationMs: session.durationMs,
      },
      model,
      promptHash,
      result,
    });

    if (opts.localPdfPath) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(opts.localPdfPath, pdfBytes);
    }

    // Insert the row first so we have an analysis_id to use as the PDF filename.
    // We update with pdf_path right after upload.
    const { data: inserted, error: insertErr } = await supabase
      .from("analyses")
      .insert({
        session_id: session.id,
        model,
        prompt_hash: promptHash,
        result,
        status: "ok",
      })
      .select("id, session_id, created_at, model, prompt_hash, pdf_path, result, status")
      .single();
    if (insertErr || !inserted) {
      throw new Error(`Failed to insert analysis row: ${insertErr?.message}`);
    }

    const pdfStoragePath = `${session.id}/analysis-${inserted.id}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from(serverEnv.recordingsBucket())
      .upload(pdfStoragePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadErr) {
      // Best-effort: mark the row as partial so callers can see the PDF is missing.
      await supabase
        .from("analyses")
        .update({ status: `pdf_upload_failed: ${uploadErr.message}` })
        .eq("id", inserted.id);
      throw new Error(`Failed to upload PDF: ${uploadErr.message}`);
    }

    const { data: updated, error: updateErr } = await supabase
      .from("analyses")
      .update({ pdf_path: pdfStoragePath })
      .eq("id", inserted.id)
      .select("id, session_id, created_at, model, prompt_hash, pdf_path, result, status")
      .single();
    if (updateErr || !updated) {
      throw new Error(`Failed to update analysis row with pdf_path: ${updateErr?.message}`);
    }

    // Clean up the Gemini-side file. Storage there is metered and we don't
    // need it after the response.
    try {
      await ai.files.delete({ name: file.name });
    } catch {
      // non-fatal
    }

    return {
      session,
      analysis: updated as AnalysisRow,
      pdfBytes,
      rawText,
    };
  } finally {
    if (cleanupDir) {
      await rm(cleanupDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
