/**
 * Interactive CLI: pick a recorded session, run the Gemini video analysis
 * pipeline, save the resulting PDF locally and to Supabase Storage, and
 * insert the analysis row.
 *
 * Usage:
 *   npm run analyze                  # interactive picker
 *   npm run analyze -- <session-id>  # specific session
 *   npm run analyze -- --latest      # most recent session with a recording
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import {
  listDownloadableSessions,
  getSessionForDownload,
  type DownloadableSession,
} from "@/lib/sessions/download";
import { runAnalysis } from "@/lib/analysis/analyze";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (check .env.local)`);
  return v;
}

function makeSupabase() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function fmtRow(idx: number, s: DownloadableSession): string {
  const created = new Date(s.createdAt).toISOString().replace("T", " ").slice(0, 19);
  const dur = s.durationMs ? `${Math.round(s.durationMs / 1000)}s` : "?";
  return `  [${String(idx).padStart(2)}] ${s.id}  ${created}  ${s.stage.padEnd(9)}  ${dur.padStart(5)}`;
}

async function pickInteractively(
  sessions: DownloadableSession[],
): Promise<DownloadableSession> {
  console.log(`\nFound ${sessions.length} session(s) with recordings:\n`);
  console.log(
    "       id" + " ".repeat(36 - 2) + "  created (UTC)         stage      dur",
  );
  sessions.forEach((s, i) => console.log(fmtRow(i + 1, s)));
  console.log("");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("Pick a session [1]: ")).trim() || "1";
    const idx = Number(answer);
    if (!Number.isInteger(idx) || idx < 1 || idx > sessions.length) {
      throw new Error(`Invalid selection: ${answer}`);
    }
    return sessions[idx - 1];
  } finally {
    rl.close();
  }
}

async function main() {
  // Force require so missing keys fail before doing any work.
  requireEnv("GEMINI_API_KEY");

  const supabase = makeSupabase();
  const args = process.argv.slice(2);

  let session: DownloadableSession;
  if (args[0] === "--latest") {
    const sessions = await listDownloadableSessions(supabase, 1);
    if (sessions.length === 0) throw new Error("No recordings found");
    session = sessions[0];
  } else if (args[0]) {
    session = await getSessionForDownload(supabase, args[0]);
  } else {
    const sessions = await listDownloadableSessions(supabase, 50);
    if (sessions.length === 0) throw new Error("No recordings found");
    session = await pickInteractively(sessions);
  }

  const outDir = resolve(process.cwd(), "downloads", "analyses");
  await mkdir(outDir, { recursive: true });
  const localPdfPath = resolve(outDir, `${session.id}.pdf`);
  const localJsonPath = resolve(outDir, `${session.id}.json`);

  console.log(`\n→ session ${session.id}`);
  console.log("→ downloading + converting recording (skipped if cached)...");
  console.log("→ uploading to Gemini and analyzing... (this can take a minute)");
  const t0 = performance.now();
  const { analysis, rawText } = await runAnalysis(supabase, session.id, {
    localPdfPath,
  });
  await writeFile(localJsonPath, rawText);
  const elapsed = Math.round((performance.now() - t0) / 1000);

  console.log("\nDone in", elapsed, "s.");
  console.log("  analysis_id:", analysis.id);
  console.log("  session_id: ", analysis.session_id);
  console.log("  model:      ", analysis.model);
  console.log("  prompt_hash:", analysis.prompt_hash);
  console.log("  pdf_path:   ", analysis.pdf_path);
  console.log("  local pdf:  ", localPdfPath);
  console.log("  raw json:   ", localJsonPath);
}

main().catch((err) => {
  console.error("\nError:", err.message ?? err);
  process.exit(1);
});
