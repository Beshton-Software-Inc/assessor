import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/getUser";
import { getOrgAdminOrgId } from "@/lib/auth/roles";
import { createPortalSession, PortalError } from "@/lib/billing/portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/portal
 * Returns a Stripe Customer Portal URL for the caller's org.
 */
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await getOrgAdminOrgId(user.id);
  if (!orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { url } = await createPortalSession({ orgId });
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof PortalError) {
      const status = err.code === "no_customer" ? 409 : 400;
      return NextResponse.json({ error: err.code }, { status });
    }
    return NextResponse.json(
      { error: "portal_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
