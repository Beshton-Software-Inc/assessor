import "server-only";
import { getStripe } from "@/lib/billing/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { PlanRow, SubscriptionRow } from "@/lib/billing/types";

export class SeatsError extends Error {
  constructor(
    public code:
      | "subscription_missing"
      | "not_subscribed"
      | "seats_below_active_members"
      | "seat_item_not_found"
      | "stripe_error",
    message?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export interface SeatUpdateInput {
  orgId: string;
  seats: number;
}

export interface SeatUpdateResult {
  ok: true;
  seatQuantity: number;
}

/**
 * Updates the seat quantity on a live Stripe subscription with
 * `proration_behavior: 'always_invoice'` so the customer is charged or
 * credited immediately. The local subscriptions row is also updated, but
 * the customer.subscription.updated webhook event will reconcile a second
 * time as authoritative.
 *
 * Refuses to drop below the count of currently active billable members
 * (assessors + org_admins). The org_admin must remove members in
 * /admin/org first if they want to shrink seats.
 */
export async function updateSeatQuantity(
  input: SeatUpdateInput,
): Promise<SeatUpdateResult> {
  const admin = supabaseAdmin();
  const stripe = getStripe();
  const seats = Math.max(1, Math.floor(input.seats));

  const { data: subRow, error: subErr } = await admin
    .from("subscriptions")
    .select("*")
    .eq("org_id", input.orgId)
    .maybeSingle();
  if (subErr) throw new SeatsError("stripe_error", subErr.message);
  if (!subRow) throw new SeatsError("subscription_missing");
  const sub = subRow as SubscriptionRow;

  if (
    !sub.stripe_subscription_id ||
    (sub.status !== "active" && sub.status !== "past_due")
  ) {
    throw new SeatsError("not_subscribed");
  }

  const { data: activeSeatsResp } = await admin.rpc("org_active_seats", {
    p_org_id: input.orgId,
  });
  const activeSeats = (activeSeatsResp as number | null) ?? 0;
  if (seats < activeSeats) {
    throw new SeatsError("seats_below_active_members", undefined, {
      activeSeats,
    });
  }

  const { data: planRow } = await admin
    .from("plans")
    .select("*")
    .eq("code", sub.plan_code)
    .maybeSingle();
  const plan = planRow as PlanRow | null;
  if (!plan || !plan.stripe_seat_price_id) {
    throw new SeatsError("stripe_error", "plan_not_seeded");
  }

  const stripeSub = await stripe.subscriptions.retrieve(
    sub.stripe_subscription_id,
  );
  const seatItem = stripeSub.items.data.find(
    (it) =>
      typeof it.price !== "string" &&
      it.price.id === plan.stripe_seat_price_id,
  );
  if (!seatItem) throw new SeatsError("seat_item_not_found");

  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    items: [{ id: seatItem.id, quantity: seats }],
    proration_behavior: "always_invoice",
  });

  await admin
    .from("subscriptions")
    .update({ seat_quantity: seats })
    .eq("org_id", input.orgId);

  return { ok: true, seatQuantity: seats };
}
