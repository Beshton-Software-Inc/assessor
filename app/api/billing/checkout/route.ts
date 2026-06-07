import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/getUser";
import { getOrgAdminOrgId } from "@/lib/auth/roles";
import {
  createCheckoutSession,
  CheckoutError,
} from "@/lib/billing/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/checkout
 * Body: { planCode: 'starter' | 'pro', seats: number }
 *
 * Mints a Stripe Checkout Session for the caller's org and returns the
 * hosted URL. Caller must be an org_admin. Refuses if the org already has
 * a paid plan in active/past_due — caller should hit the portal route.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await getOrgAdminOrgId(user.id);
  const isAppAdmin = Boolean(user.profile?.is_app_admin);
  if (!orgId && !isAppAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!orgId) {
    return NextResponse.json(
      { error: "Org context required" },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    planCode?: "starter" | "pro";
    seats?: number;
  };
  if (body.planCode !== "starter" && body.planCode !== "pro") {
    return NextResponse.json({ error: "Invalid planCode" }, { status: 400 });
  }
  const seats = Math.max(1, Math.floor(body.seats ?? 1));

  try {
    const { url } = await createCheckoutSession({
      orgId,
      planCode: body.planCode,
      seats,
      callerEmail: user.email,
    });
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof CheckoutError) {
      const status =
        err.code === "already_subscribed"
          ? 409
          : err.code === "plan_not_seeded"
            ? 402
            : 400;
      return NextResponse.json({ error: err.code }, { status });
    }
    return NextResponse.json(
      { error: "checkout_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
