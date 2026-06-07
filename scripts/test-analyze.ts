/**
 * End-to-end smoke test for the Gemini video-analysis pipeline.
 *
 * - Loads .env.local for SUPABASE_* and GEMINI_API_KEY
 * - Picks the most recent session with a recording (or argv[2])
 * - Runs the full pipeline: download → ffmpeg → Gemini → PDF → Storage → DB row
 * - Asserts:
 *     * runAnalysis returned an analysis row with a UUID id and pdf_path
 *     * the analyses row exists in the DB and links back to session_id
 *     * a PDF blob exists at pdf_path in the recordings bucket
 *     * the PDF starts with "%PDF-" and has non-zero size
 *     * the result JSON has at least one of the expected fields
 *
 * Run: npm run test:analyze
 *      npm run test:analyze -- <session-id>
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { createClient } from "@supabase/supabase-js";
import {
  listDownloadableSessions,
  getSessionForDownload,
} from "@/lib/sessions/download";
import { runAnalysis } from "@/lib/analysis/analyze";
import { serverEnv } from "@/lib/env";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name} — ${detail}`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (check .env.local)`);
  return v;
}

async function main() {
  console.log("Academic Assessor — analyze pipeline smoke test\n");

  requireEnv("GEMINI_API_KEY");
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const arg = process.argv[2];
  const session = arg
    ? await getSessionForDownload(supabase, arg)
    : (await listDownloadableSessions(supabase, 1))[0];

  if (!session) {
    console.error("No sessions with recordings exist yet. Run an interview first.");
    process.exit(1);
  }
  console.log(`Using session: ${session.id}\n`);

  console.log("[1/4] Running analysis pipeline (download → Gemini → PDF → DB)...");
  const t0 = performance.now();
  const { analysis, pdfBytes } = await runAnalysis(supabase, session.id);
  console.log(`  finished in ${Math.round((performance.now() - t0) / 1000)}s`);

  console.log("\n[2/4] Validating analysis row...");
  check("analysis_id is uuid", /^[0-9a-f-]{36}$/.test(analysis.id), analysis.id);
  check("links to session_id", analysis.session_id === session.id, analysis.session_id);
  check("pdf_path set", !!analysis.pdf_path, analysis.pdf_path ?? "null");
  check("status is ok", analysis.status === "ok", analysis.status);

  const fields = ["student_summary", "scores", "strengths", "growth_areas"];
  const present = fields.filter((f) => analysis.result[f] != null);
  check(
    "result has expected fields",
    present.length > 0,
    `${present.length}/${fields.length} present: ${present.join(", ")}`,
  );

  console.log("\n[3/4] Round-tripping the row from the DB...");
  const { data: row, error: rowErr } = await supabase
    .from("analyses")
    .select("id, session_id, pdf_path, model, status")
    .eq("id", analysis.id)
    .single();
  check("row exists in DB", !rowErr && !!row, rowErr?.message ?? `id=${row?.id}`);
  check(
    "DB session_id matches",
    row?.session_id === session.id,
    row?.session_id ?? "null",
  );

  console.log("\n[4/4] Validating PDF in Storage...");
  // In-memory bytes
  const head = Buffer.from(pdfBytes.slice(0, 5)).toString("ascii");
  check("in-memory PDF magic", head === "%PDF-", `head="${head}" size=${pdfBytes.length}`);

  // Storage download
  if (analysis.pdf_path) {
    const { data: blob, error: dlErr } = await supabase.storage
      .from(serverEnv.recordingsBucket())
      .download(analysis.pdf_path);
    if (dlErr || !blob) {
      check("storage PDF download", false, dlErr?.message ?? "no blob");
    } else {
      const buf = Buffer.from(await blob.arrayBuffer());
      const storageHead = buf.slice(0, 5).toString("ascii");
      check(
        "storage PDF magic",
        storageHead === "%PDF-",
        `head="${storageHead}" size=${buf.length}`,
      );
    }
  }

  const failures = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failures.length}/${checks.length} checks passed.`);
  if (failures.length > 0) {
    console.error(`\nFAIL: ${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nPASS");
}

main().catch((err) => {
  console.error("\nERROR:", err.message ?? err);
  process.exit(1);
});
