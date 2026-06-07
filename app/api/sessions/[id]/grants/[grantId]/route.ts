import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";
import { revokeGrant } from "@/lib/sharing/grants";
import { logAudit } from "@/lib/audit/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/sessions/[id]/grants/[grantId]
 *
 * Soft-revokes the grant by setting revoked_at = now(). Idempotent.
 * The route asserts the grant belongs to the [id] session in the path
 * to prevent cross-session revocation by URL tampering. The actual
 * UPDATE goes through supabaseServer() so session_grants_update RLS
 * (granter, session enduser, or app_admin) is the second gate.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; grantId: string }> },
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: sessionId, grantId } = await params;

  const supa = await supabaseServer();

  // Confirm the grant exists and belongs to this session (RLS gates row visibility).
  const { data: grantRow } = await supa
    .from("session_grants")
    .select("id, session_id")
    .eq("id", grantId)
    .maybeSingle();
  if (!grantRow) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if ((grantRow as { session_id: string }).session_id !== sessionId) {
    return NextResponse.json(
      { error: "Grant does not belong to this session" },
      { status: 400 },
    );
  }

  try {
    await revokeGrant(supa, grantId);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to revoke grant", detail: (err as Error).message },
      { status: 500 },
    );
  }

  await logAudit("grant_revoked", {
    targetSessionId: sessionId,
    targetGrantId: grantId,
  });

  return NextResponse.json({ ok: true });
}
