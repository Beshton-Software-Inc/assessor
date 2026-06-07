import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";

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

/**
 * POST /api/sessions is REMOVED in Phase B. Session creation now requires
 * an explicit enduserUserId (the assessor must pair with a student first).
 * Use POST /api/sessions/start instead. Stale clients fail fast and
 * observably with a 400 + hint here so we notice during rollout.
 */
export async function POST() {
  return NextResponse.json(
    { error: "use /api/sessions/start" },
    { status: 400 },
  );
}
