import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";
import { listGrantsForSession } from "@/lib/sharing/grants";
import { logAudit } from "@/lib/audit/log";
import type { GrantScope } from "@/lib/sharing/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-user grant management for a session.
 *
 *   GET    /api/sessions/[id]/grants
 *   POST   /api/sessions/[id]/grants  body: { granteeEmail? | granteeUserId?, scope, expiresAt?, label? }
 *
 * Auth posture:
 *   - The caller must be the session's enduser (verified by RLS-fetching
 *     the row with enduser_id = auth.uid()) or an app_admin.
 *   - Assessors are intentionally NOT permitted to mint grants in Phase B.
 *
 * The actual INSERT goes through supabaseServer() so the
 * session_grants_insert RLS policy is the second gate (defense-in-depth):
 * the policy requires granted_by_user_id = auth.uid() AND the caller to
 * be the session's enduser (or app_admin).
 */

interface CreateGrantBody {
  granteeEmail?: string;
  granteeUserId?: string;
  scope: GrantScope;
  expiresAt?: string;
  label?: string;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: sessionId } = await params;

  const supa = await supabaseServer();
  const grants = await listGrantsForSession(supa, sessionId).catch(() => null);
  if (!grants) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ grants });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: sessionId } = await params;
  const body = (await req.json().catch(() => ({}))) as CreateGrantBody;

  if (!body.scope || (body.scope !== "analysis" && body.scope !== "full")) {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }
  if (!body.granteeEmail && !body.granteeUserId) {
    return NextResponse.json(
      { error: "granteeEmail or granteeUserId required" },
      { status: 400 },
    );
  }

  // Confirm the caller can see this session AND is the enduser (or app_admin).
  const isAppAdmin = Boolean(user.profile?.is_app_admin);
  const supa = await supabaseServer();
  const { data: row } = await supa
    .from("sessions")
    .select("id, enduser_id")
    .eq("id", sessionId)
    .maybeSingle();
  const isEnduser = (row as { enduser_id: string | null } | null)?.enduser_id === user.id;
  if (!row || (!isAppAdmin && !isEnduser)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Resolve granteeEmail -> userId if needed (admin client; auth schema lookup).
  let granteeUserId = body.granteeUserId ?? null;
  if (!granteeUserId && body.granteeEmail) {
    granteeUserId = await findUserIdByEmail(body.granteeEmail);
    if (!granteeUserId) {
      return NextResponse.json(
        { error: "User with that email not found" },
        { status: 404 },
      );
    }
  }
  if (!granteeUserId) {
    return NextResponse.json({ error: "Could not resolve grantee" }, { status: 400 });
  }

  // Insert via supabaseServer() so RLS gates as defense-in-depth.
  const { data: inserted, error: insertErr } = await supa
    .from("session_grants")
    .insert({
      session_id: sessionId,
      grantee_user_id: granteeUserId,
      granted_by_user_id: user.id,
      scope: body.scope,
      expires_at: body.expiresAt ?? null,
      share_label: body.label ?? null,
      share_token: null,
    })
    .select("id, grantee_user_id, scope, expires_at")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: "Failed to create grant", detail: insertErr?.message },
      { status: 500 },
    );
  }

  await logAudit("grant_created", {
    targetSessionId: sessionId,
    targetGrantId: inserted.id as string,
    metadata: { scope: body.scope, grantee: granteeUserId },
  });

  return NextResponse.json({
    grantId: inserted.id as string,
    granteeUserId: inserted.grantee_user_id as string | null,
    scope: inserted.scope as GrantScope,
    expiresAt: (inserted.expires_at as string | null) ?? null,
  });
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = supabaseAdmin();
  const needle = email.trim().toLowerCase();
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === needle);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
    page += 1;
    if (page > 50) return null;
  }
}
