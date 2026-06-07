import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";
import type { UploadUrlResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mints a one-time signed upload URL so the browser uploads the WebM blob
 * directly to Supabase Storage. Avoids Vercel's request-body size cap and
 * keeps the service role key server-only.
 *
 * Auth flow: (1) require a valid session, (2) RLS-check the session row is
 * visible to this caller via supabaseServer(), then (3) drop to the
 * service-role client to mint the Storage signed URL — Storage signing
 * needs the service role key, but the access decision was already made by
 * RLS. The follow-up UPDATE that flips stage to 'recording' goes back
 * through supabaseServer() so the sessions_update policy gates it.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const serverSupa = await supabaseServer();
  const { data: row } = await serverSupa
    .from("sessions")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { error: "Forbidden: session not visible" },
      { status: 403 },
    );
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

  // Track the eventual storage path on the session row up front so an aborted
  // upload still leaves a useful audit trail. Routed via supabaseServer() so
  // the sessions_update RLS policy gates it (assessor-on-non-revoked or
  // app_admin only).
  const { error: updateError } = await serverSupa
    .from("sessions")
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
