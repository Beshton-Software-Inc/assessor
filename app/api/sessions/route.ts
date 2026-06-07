import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";
import { getAssessorOrgId } from "@/lib/auth/roles";
import type { CreateSessionResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lists sessions visible to the caller. Routed through the request-scoped
 * supabaseServer() client so RLS scopes the result set: assessors see their
 * org's sessions, endusers see only their own, app_admins see everything.
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);

  const supa = await supabaseServer();
  const { data, error } = await supa
    .from("sessions")
    .select("id, created_at, completed_at, duration_ms, recording_path, stage")
    .not("recording_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: "Failed to list sessions", detail: error.message },
      { status: 500 },
    );
  }

  const sessions = (data ?? []).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    completedAt: (r.completed_at as string | null) ?? null,
    durationMs: (r.duration_ms as number | null) ?? null,
    recordingPath: r.recording_path as string,
    stage: r.stage,
  }));
  return NextResponse.json({ sessions });
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only assessors can create interview sessions. If the user is an assessor
  // in multiple orgs we take the first; phase B will accept org_id from the
  // client so an assessor with two hats can choose which org owns the row.
  const assessorOrgId = await getAssessorOrgId(user.id);
  if (!assessorOrgId) {
    return NextResponse.json(
      { error: "Forbidden: not an assessor in any organization" },
      { status: 403 },
    );
  }

  const userAgent = req.headers.get("user-agent");

  // We use supabaseAdmin() for this insert deliberately. The RLS policy
  // sessions_insert requires assessor_id = auth.uid(); for phase A we also
  // set enduser_id = auth.uid() because there is no student-pairing flow
  // yet. Bypassing RLS here keeps the seam narrow: the auth check above
  // already established the caller is an assessor in `assessorOrgId`.
  // TODO(phase-B): replace with a pre-interview pairing flow that creates
  // or selects an enduser and accepts org_id from the client; once that
  // exists this insert can move to supabaseServer() and let RLS gate it.
  const supa = supabaseAdmin();
  const { data, error } = await supa
    .from("sessions")
    .insert({
      stage: "started",
      user_agent: userAgent,
      org_id: assessorOrgId,
      assessor_id: user.id,
      enduser_id: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create session", detail: error?.message },
      { status: 500 },
    );
  }

  return NextResponse.json<CreateSessionResponse>({ sessionId: data.id });
}
