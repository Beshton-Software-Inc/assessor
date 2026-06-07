import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/getUser";
import { getOrgAdminOrgId } from "@/lib/auth/roles";
import { createInvite, InviteError } from "@/lib/billing/invites";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/invites
 * Lists pending invites for the caller's org.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await getOrgAdminOrgId(user.id);
  if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = supabaseAdmin();
  const { data } = await admin
    .from("seat_invites")
    .select("id, email, role, status, created_at, accepted_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  return NextResponse.json({ invites: data ?? [] });
}

/**
 * POST /api/billing/invites
 * Body: { email: string, role: 'assessor' | 'org_admin' }
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await getOrgAdminOrgId(user.id);
  if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    role?: "assessor" | "org_admin";
  };
  if (!body.email || (body.role !== "assessor" && body.role !== "org_admin")) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const { invite } = await createInvite({
      orgId,
      email: body.email,
      role: body.role,
      invitedByUserId: user.id,
    });
    return NextResponse.json(
      {
        invite: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          status: invite.status,
          created_at: invite.created_at,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof InviteError) {
      const status =
        err.code === "invalid_email"
          ? 400
          : err.code === "already_member"
            ? 409
            : 500;
      return NextResponse.json({ error: err.code }, { status });
    }
    return NextResponse.json(
      { error: "invite_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
