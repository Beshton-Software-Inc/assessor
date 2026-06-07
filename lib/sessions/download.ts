import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import type { SessionRow } from "@/lib/types";

export interface DownloadableSession {
  id: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  recordingPath: string;
  stage: SessionRow["stage"];
}

export async function listDownloadableSessions(
  supabase: SupabaseClient,
  limit = 50,
): Promise<DownloadableSession[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, created_at, completed_at, duration_ms, recording_path, stage")
    .not("recording_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to list sessions: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    completedAt: (r.completed_at as string | null) ?? null,
    durationMs: (r.duration_ms as number | null) ?? null,
    recordingPath: r.recording_path as string,
    stage: r.stage as SessionRow["stage"],
  }));
}

export async function getSessionForDownload(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<DownloadableSession> {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, created_at, completed_at, duration_ms, recording_path, stage")
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    throw new Error(`Session ${sessionId} not found: ${error?.message ?? "no row"}`);
  }
  if (!data.recording_path) {
    throw new Error(`Session ${sessionId} has no recording uploaded`);
  }
  return {
    id: data.id as string,
    createdAt: data.created_at as string,
    completedAt: (data.completed_at as string | null) ?? null,
    durationMs: (data.duration_ms as number | null) ?? null,
    recordingPath: data.recording_path as string,
    stage: data.stage as SessionRow["stage"],
  };
}

/**
 * Returns a short-lived signed URL for the recording webm. We sign rather than
 * piping the blob through this process so streaming conversions can fetch
 * directly into ffmpeg's stdin.
 */
export async function signRecordingUrl(
  supabase: SupabaseClient,
  recordingPath: string,
  expiresInSec = 300,
): Promise<string> {
  const bucket = serverEnv.recordingsBucket();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(recordingPath, expiresInSec);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to sign recording URL: ${error?.message ?? "no URL"}`);
  }
  return data.signedUrl;
}

export async function downloadRecordingToFile(
  supabase: SupabaseClient,
  recordingPath: string,
  destPath: string,
): Promise<void> {
  const url = await signRecordingUrl(supabase, recordingPath);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download recording: ${res.status} ${res.statusText}`);
  }
  await mkdir(dirname(destPath), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
}

/**
 * Converts a webm file on disk to an mp4 file on disk via ffmpeg.
 * Re-encodes video (libx264) and audio (aac) since LLMs and most video
 * pipelines reject opus-in-mp4. `-movflags +faststart` lets the resulting
 * file start playing before fully downloaded.
 */
export function convertWebmToMp4(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Streams a webm Readable through ffmpeg and returns mp4 bytes via a Readable.
 * Used by the API route — note mp4 needs `-movflags frag_keyframe+empty_moov`
 * because piped output cannot seek back to write the moov atom.
 */
export function streamWebmToMp4(input: Readable): Readable {
  const args = [
    "-i",
    "pipe:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-f",
    "mp4",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "pipe:1",
  ];
  const proc = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });

  // Surface ffmpeg failures on the output stream so the caller's response
  // ends with an error instead of silently truncating.
  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  proc.on("close", (code) => {
    if (code !== 0) {
      proc.stdout.destroy(
        new Error(`ffmpeg failed (code ${code}): ${stderr.slice(-500)}`),
      );
    }
  });

  pipeline(input, proc.stdin).catch((err) => {
    proc.stdout.destroy(err);
  });

  return proc.stdout;
}

/**
 * High-level helper for the API route: signs the recording URL, fetches it,
 * and pipes the webm body through ffmpeg into an mp4 stream.
 */
export async function streamSessionAsMp4(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<{ session: DownloadableSession; mp4: Readable }> {
  const session = await getSessionForDownload(supabase, sessionId);
  const url = await signRecordingUrl(supabase, session.recordingPath);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch recording: ${res.status} ${res.statusText}`);
  }
  const webm = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream);
  return { session, mp4: streamWebmToMp4(webm) };
}
