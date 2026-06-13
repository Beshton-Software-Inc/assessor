import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/getUser";
import { claimLeadRun, getActiveLeadRun, toPublic } from "@/lib/lead/run";
import { clearLeadCookie } from "@/lib/lead/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/lead/runs/:id/claim
 *
 * Called from page 5 right after sign-in completes. Links the in-flight
 * lead run to the auth.user, and reassigns the linked sessions' enduser_id.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const lead = await getActiveLeadRun();
  if (!lead) {
    return NextResponse.json({ error: "No active lead run" }, { status: 401 });
  }
  const { id } = await params;
  if (id !== lead.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (lead.user_id && lead.user_id !== user.id) {
    return NextResponse.json(
      { error: "Lead already claimed by another user" },
      { status: 409 },
    );
  }

  const claimed = await claimLeadRun(lead.id, user.id);
  // Cookie has done its job — drop it so the user transitions cleanly to
  // the authenticated dashboard surface from here on.
  await clearLeadCookie();
  return NextResponse.json({ run: toPublic(claimed) });
}
