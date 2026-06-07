import "server-only";
import type Stripe from "stripe";
import { getStripe, getAppOrigin } from "@/lib/billing/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { PlanCode, PlanRow, SubscriptionRow } from "@/lib/billing/types";

export interface CheckoutInput {
  orgId: string;
  planCode: Exclude<PlanCode, "trial">;
  seats: number;
  callerEmail: string | null;
}

export interface CheckoutResult {
  url: string;
}

export type CheckoutErrorCode =
  | "already_subscribed"
  | "plan_not_seeded"
  | "subscription_missing"
  | "stripe_error";

export class CheckoutError extends Error {
  constructor(
    public code: CheckoutErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/**
 * Mints a Stripe Checkout Session for an org.
 *
 * Flow:
 *  1. Look up the org's subscription row. Must exist (auto-created by the
 *     handle_new_organization trigger).
 *  2. Refuse if already on a paid plan with active/past_due status —
 *     caller should use the customer portal instead.
 *  3. Look up the plan, refuse if Stripe price ids haven't been seeded.
 *  4. Ensure a Stripe customer exists; create on first call.
 *  5. Create a Checkout Session in subscription mode with two line items:
 *     a flat seat price (quantity = seats) and a metered overage price.
 */
export async function createCheckoutSession(
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const admin = supabaseAdmin();
  const stripe = getStripe();

  const { data: subRow, error: subErr } = await admin
    .from("subscriptions")
    .select("*")
    .eq("org_id", input.orgId)
    .maybeSingle();
  if (subErr) throw new CheckoutError("stripe_error", subErr.message);
  if (!subRow) throw new CheckoutError("subscription_missing");
  const sub = subRow as SubscriptionRow;

  if (
    (sub.plan_code === "starter" || sub.plan_code === "pro") &&
    (sub.status === "active" || sub.status === "past_due")
  ) {
    throw new CheckoutError("already_subscribed");
  }

  const { data: planRow, error: planErr } = await admin
    .from("plans")
    .select("*")
    .eq("code", input.planCode)
    .maybeSingle();
  if (planErr) throw new CheckoutError("stripe_error", planErr.message);
  const plan = planRow as PlanRow | null;
  if (!plan || !plan.stripe_seat_price_id) {
    throw new CheckoutError("plan_not_seeded");
  }

  // Customer create-if-null. We persist the customer id even before the
  // subscription is paid so the Portal route can mint a session for orgs
  // that started checkout but didn't complete.
  let customerId = sub.stripe_customer_id;
  if (!customerId) {
    const created = await stripe.customers.create({
      email: input.callerEmail ?? undefined,
      metadata: {
        org_id: input.orgId,
      },
    });
    customerId = created.id;
    await admin
      .from("subscriptions")
      .update({ stripe_customer_id: customerId })
      .eq("org_id", input.orgId);
  }

  const origin = getAppOrigin();
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: plan.stripe_seat_price_id, quantity: Math.max(1, input.seats) },
  ];
  if (plan.stripe_overage_meter_id) {
    lineItems.push({ price: plan.stripe_overage_meter_id });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItems,
    success_url: `${origin}/admin/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/admin/billing/checkout/cancel`,
    metadata: {
      org_id: input.orgId,
      plan_code: input.planCode,
    },
    subscription_data: {
      metadata: {
        org_id: input.orgId,
        plan_code: input.planCode,
      },
    },
    allow_promotion_codes: true,
  });

  if (!session.url) throw new CheckoutError("stripe_error", "no_session_url");
  return { url: session.url };
}
