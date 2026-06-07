import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CompleteBody {
  recordingPath?: string;
  durationMs?: number;
  aborted?: boolean;
}

/**
 * Marks a session completed (or aborted). Auth-gated and routed through the
 * request-scoped supabaseServer() so the sessions_update RLS policy decides
 * whether the caller is allowed to flip the row (assessor-on-non-revoked or
 * the enduser themselves, plus app_admin).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as CompleteBody;

  const supa = await supabaseServer();
  const { error } = await supa
    .from("sessions")
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
