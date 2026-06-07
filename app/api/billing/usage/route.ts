import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/getUser";
import { getOrgAdminOrgId } from "@/lib/auth/roles";
import { buildUsageSummary } from "@/lib/billing/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/usage
 * Returns plan + usage summary for the caller's org. Caller must be an
 * org_admin.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await getOrgAdminOrgId(user.id);
  if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const summary = await buildUsageSummary(orgId);
  if (!summary) {
    return NextResponse.json({ error: "no_subscription" }, { status: 404 });
  }
  return NextResponse.json(summary);
}
