import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";
import { revokeShareToken } from "@/lib/sharing/tokens";
import { logAudit } from "@/lib/audit/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/sessions/[id]/share-token/[grantId]
 *
 * Revoke a share-token grant. Distinct from /grants/[grantId] only for
 * routing clarity in the student UI; backend behavior is identical except
 * we assert share_token IS NOT NULL on the row to refuse revoking a
 * per-user grant via this endpoint.
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
  const { data: row } = await supa
    .from("session_grants")
    .select("id, session_id, share_token")
    .eq("id", grantId)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if ((row as { session_id: string }).session_id !== sessionId) {
    return NextResponse.json(
      { error: "Grant does not belong to this session" },
      { status: 400 },
    );
  }
  if (!(row as { share_token: string | null }).share_token) {
    return NextResponse.json(
      { error: "Grant is not a share-token grant" },
      { status: 400 },
    );
  }

  try {
    await revokeShareToken(supa, grantId);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to revoke share token", detail: (err as Error).message },
      { status: 500 },
    );
  }

  await logAudit("grant_revoked", {
    targetSessionId: sessionId,
    targetGrantId: grantId,
    metadata: { kind: "share_token" },
  });

  return NextResponse.json({ ok: true });
}
