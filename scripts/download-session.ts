/**
 * Interactive CLI: pick a recorded interview session, download the WebM from
 * Supabase Storage, and convert it to MP4 with ffmpeg.
 *
 * Usage:
 *   npm run download                  # interactive picker
 *   npm run download -- <session-id>  # download a specific session
 *   npm run download -- --latest      # download the most recent recording
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv(); // .env fallback, does not override .env.local
import { createClient } from "@supabase/supabase-js";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  convertWebmToMp4,
  downloadRecordingToFile,
  getSessionForDownload,
  listDownloadableSessions,
  type DownloadableSession,
} from "@/lib/sessions/download";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (check .env.local)`);
  return v;
}

function makeSupabase() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
  const supabase = makeSupabase();
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--inspect"));

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

  const outDir = resolve(process.cwd(), "downloads");
  await mkdir(outDir, { recursive: true });
  const webmPath = resolve(outDir, `${session.id}.webm`);
  const mp4Path = resolve(outDir, `${session.id}.mp4`);

  console.log(`\n→ session ${session.id}`);
  console.log(`  storage path: ${session.recordingPath}`);

  console.log("→ downloading webm...");
  const t1 = performance.now();
  await downloadRecordingToFile(supabase, session.recordingPath, webmPath);
  console.log(`  saved ${webmPath} (${Math.round((performance.now() - t1) / 1000)}s)`);

  console.log("→ converting to mp4 with ffmpeg...");
  const t2 = performance.now();
  await convertWebmToMp4(webmPath, mp4Path);
  console.log(`  saved ${mp4Path} (${Math.round((performance.now() - t2) / 1000)}s)`);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("\nError:", err.message ?? err);
  process.exit(1);
});
