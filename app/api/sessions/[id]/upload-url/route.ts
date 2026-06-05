import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { UploadUrlResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mints a one-time signed upload URL so the browser uploads the WebM blob
 * directly to Supabase Storage. Avoids Vercel's request-body size cap and
 * keeps the service role key server-only.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bucket = serverEnv.recordingsBucket();
  const path = `${id}/recording.webm`;

  const supabase = supabaseAdmin();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create upload URL", detail: error?.message },
      { status: 500 },
    );
  }

  // Track the eventual storage path on the session row up front so
  // an aborted upload still leaves a useful audit trail.
  await supabase
    .from("sessions")
    .update({ stage: "recording", recording_path: path })
    .eq("id", id);

  return NextResponse.json<UploadUrlResponse>({
    uploadUrl: data.signedUrl,
    token: data.token,
    path,
  });
}
