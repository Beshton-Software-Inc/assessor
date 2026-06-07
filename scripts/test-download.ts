/**
 * End-to-end smoke test for the session download + ffmpeg conversion pipeline.
 *
 * - Connects to the real Supabase project using SUPABASE_SERVICE_ROLE_KEY
 *   from .env.local.
 * - Picks the most recent session with a recording (or one passed via argv).
 * - Downloads the webm and converts it to mp4.
 * - Runs `ffprobe` on the result and asserts the output has at least a video
 *   stream and an audio stream, the duration is > 0, and the container is mp4.
 *
 * Run with:  npm run test:download
 *        or  npm run test:download -- <session-id>
 *
 * Exit code 0 = pass, non-zero = fail.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  convertWebmToMp4,
  downloadRecordingToFile,
  getSessionForDownload,
  listDownloadableSessions,
} from "@/lib/sessions/download";

interface FfprobeOutput {
  format?: { format_name?: string; duration?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string }>;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (check .env.local)`);
  return v;
}

function ffprobe(file: string): Promise<FfprobeOutput> {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      file,
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", rejectPromise);
    proc.on("close", (code) => {
      if (code !== 0) return rejectPromise(new Error(`ffprobe failed: ${stderr}`));
      try {
        resolvePromise(JSON.parse(stdout) as FfprobeOutput);
      } catch (e) {
        rejectPromise(e);
      }
    });
  });
}

interface AssertionResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: AssertionResult[] = [];

function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name} — ${detail}`);
}

async function main() {
  console.log("Academic Assessor — download/convert smoke test\n");

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

  console.log(`Using session: ${session.id}`);
  console.log(`  stage:   ${session.stage}`);
  console.log(`  created: ${session.createdAt}`);
  console.log(`  webm:    ${session.recordingPath}\n`);

  const outDir = resolve(process.cwd(), "downloads", "test");
  await mkdir(outDir, { recursive: true });
  const webmPath = resolve(outDir, `${session.id}.webm`);
  const mp4Path = resolve(outDir, `${session.id}.mp4`);

  console.log("[1/3] Downloading webm from Supabase Storage...");
  await downloadRecordingToFile(supabase, session.recordingPath, webmPath);
  const webmStat = await stat(webmPath);
  check("webm downloaded", webmStat.size > 0, `${webmStat.size} bytes`);

  console.log("\n[2/3] Converting to mp4 with ffmpeg...");
  await convertWebmToMp4(webmPath, mp4Path);
  const mp4Stat = await stat(mp4Path);
  check("mp4 written", mp4Stat.size > 0, `${mp4Stat.size} bytes`);

  console.log("\n[3/3] Probing mp4 with ffprobe...");
  const probed = await ffprobe(mp4Path);

  const fmt = probed.format?.format_name ?? "";
  check("container is mp4", fmt.split(",").includes("mp4"), `format_name="${fmt}"`);

  const duration = Number(probed.format?.duration ?? 0);
  check("duration > 0", duration > 0, `${duration.toFixed(2)}s`);

  const streams = probed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  check("has video stream", !!video, video ? `codec=${video.codec_name}` : "missing");
  check("has audio stream", !!audio, audio ? `codec=${audio.codec_name}` : "missing");
  check(
    "video codec is h264",
    video?.codec_name === "h264",
    `codec=${video?.codec_name ?? "none"}`,
  );
  check(
    "audio codec is aac",
    audio?.codec_name === "aac",
    `codec=${audio?.codec_name ?? "none"}`,
  );

  const failures = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failures.length}/${results.length} checks passed.`);
  console.log(`Output: ${mp4Path}`);

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
