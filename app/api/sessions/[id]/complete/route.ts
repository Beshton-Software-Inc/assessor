import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { authorizeSessionAccess } from "@/lib/lead/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CompleteBody {
  recordingPath?: string;
  durationMs?: number;
  aborted?: boolean;
}

/**
 * Marks a session completed (or aborted). Accepts either an authenticated
 * user with RLS visibility OR an anonymous /lead caller whose lead cookie
 * owns the session.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await authorizeSessionAccess(id);
  if (!access.ok) {
    return NextResponse.json({ error: access.reason }, { status: access.status });
  }

  const body = (await req.json().catch(() => ({}))) as CompleteBody;

  const updater =
    access.via === "user"
      ? (await supabaseServer()).from("sessions")
      : supabaseAdmin().from("sessions");

  const { error } = await updater
    .update({
      stage: body.aborted ? "aborted" : "completed",
      completed_at: new Date().toISOString(),
      recording_path: body.recordingPath ?? null,
      duration_ms: body.durationMs ?? null,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to complete session", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
