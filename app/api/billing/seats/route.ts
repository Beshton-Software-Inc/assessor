import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/getUser";
import { getOrgAdminOrgId } from "@/lib/auth/roles";
import { updateSeatQuantity, SeatsError } from "@/lib/billing/seats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/seats
 * Body: { seats: number }
 *
 * Updates seat quantity on the caller's org's live Stripe subscription.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await getOrgAdminOrgId(user.id);
  if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { seats?: number };
  const seats = Math.max(1, Math.floor(body.seats ?? 0));
  if (seats < 1) {
    return NextResponse.json({ error: "Invalid seats" }, { status: 400 });
  }

  try {
    const result = await updateSeatQuantity({ orgId, seats });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SeatsError) {
      const status =
        err.code === "seats_below_active_members"
          ? 400
          : err.code === "not_subscribed"
            ? 409
            : 400;
      return NextResponse.json({ error: err.code, ...(err.extra ?? {}) }, { status });
    }
    return NextResponse.json(
      { error: "seats_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
