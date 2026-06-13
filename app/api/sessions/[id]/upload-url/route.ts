import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { authorizeSessionAccess } from "@/lib/lead/access";
import type { UploadUrlResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mints a one-time signed upload URL so the browser uploads the WebM blob
 * directly to Supabase Storage. Avoids Vercel's request-body size cap and
 * keeps the service role key server-only.
 *
 * Auth: either an authenticated user with RLS visibility on the session,
 * or an anonymous /lead caller whose lead cookie owns the session.
 * Storage signing always uses the service role; the access decision is
 * already made by authorizeSessionAccess(). The follow-up sessions UPDATE
 * goes through supabaseServer() for the user path so RLS gates it, and
 * through the admin client for the lead path (no JWT to drive RLS).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await authorizeSessionAccess(id);
  if (!access.ok) {
    return NextResponse.json({ error: access.reason }, { status: access.status });
  }

  const bucket = serverEnv.recordingsBucket();
  const path = `${id}/recording.webm`;

  const admin = supabaseAdmin();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create upload URL", detail: error?.message },
      { status: 500 },
    );
  }

  // Mark the row 'recording' and persist the eventual storage path. Routed
  // through supabaseServer() for the user path so the sessions_update RLS
  // policy gates it; through the admin client for the lead path because
  // lead callers don't carry an RLS-capable JWT.
  const updater =
    access.via === "user"
      ? (await supabaseServer()).from("sessions")
      : admin.from("sessions");

  const { error: updateError } = await updater
    .update({ stage: "recording", recording_path: path })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to mark session recording", detail: updateError.message },
      { status: 500 },
    );
  }

  return NextResponse.json<UploadUrlResponse>({
    uploadUrl: data.signedUrl,
    token: data.token,
    path,
  });
}
