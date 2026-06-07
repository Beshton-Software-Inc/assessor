import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/getUser";
import { getOrgAdminOrgId } from "@/lib/auth/roles";
import { revokeInvite, InviteError } from "@/lib/billing/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/billing/invites/[id]
 * Revokes a pending invite (flips status to 'revoked').
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await getOrgAdminOrgId(user.id);
  if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  try {
    await revokeInvite({ inviteId: id, orgId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof InviteError) {
      const status =
        err.code === "not_found"
          ? 404
          : err.code === "already_accepted"
            ? 409
            : 400;
      return NextResponse.json({ error: err.code }, { status });
    }
    return NextResponse.json(
      { error: "revoke_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
