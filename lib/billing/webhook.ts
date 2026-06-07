import "server-only";
import type Stripe from "stripe";
import { getStripe, getWebhookSecret } from "@/lib/billing/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { PlanCode, SubscriptionStatus } from "@/lib/billing/types";

/**
 * Maps a Stripe subscription status to our local enum. Stripe's docs list
 * a few extra states; we collapse 'paused' / 'incomplete_expired' into
 * sensible local equivalents.
 */
function mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "unpaid":
      return "unpaid";
    case "incomplete":
      return "incomplete";
    case "paused":
      return "past_due";
    default:
      return "incomplete";
  }
}

function tsFromUnix(unix: number | null | undefined): string | null {
  if (!unix) return null;
  return new Date(unix * 1000).toISOString();
}

interface SubscriptionWithPeriod extends Stripe.Subscription {
  current_period_start?: number | null;
  current_period_end?: number | null;
}

async function syncSubscriptionRow(sub: Stripe.Subscription): Promise<void> {
  const admin = supabaseAdmin();
  const orgId = (sub.metadata as Record<string, string> | null)?.org_id ?? null;
  const planCode =
    ((sub.metadata as Record<string, string> | null)?.plan_code as
      | PlanCode
      | undefined) ?? undefined;

  // Find the seat line item (price.recurring.usage_type !== 'metered').
  // We use it to set seat_quantity authoritatively.
  let seatQuantity = 0;
  for (const it of sub.items.data) {
    const price = it.price;
    if (typeof price === "string") continue;
    const isMetered =
      price.recurring && price.recurring.usage_type === "metered";
    if (!isMetered && it.quantity) {
      seatQuantity = it.quantity;
      break;
    }
  }

  const subWithPeriod = sub as SubscriptionWithPeriod;
  const updates: Record<string, unknown> = {
    plan_code: planCode ?? undefined,
    stripe_subscription_id: sub.id,
    stripe_customer_id:
      typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    status: mapStatus(sub.status),
    seat_quantity: seatQuantity,
    current_period_start: tsFromUnix(subWithPeriod.current_period_start),
    current_period_end: tsFromUnix(subWithPeriod.current_period_end),
    cancel_at: tsFromUnix(sub.cancel_at),
    canceled_at: tsFromUnix(sub.canceled_at),
  };
  // strip undefineds
  for (const k of Object.keys(updates)) {
    if (updates[k] === undefined) delete updates[k];
  }

  if (orgId) {
    await admin.from("subscriptions").update(updates).eq("org_id", orgId);
  } else if (typeof sub.customer === "string") {
    await admin
      .from("subscriptions")
      .update(updates)
      .eq("stripe_customer_id", sub.customer);
  } else {
    await admin
      .from("subscriptions")
      .update(updates)
      .eq("stripe_subscription_id", sub.id);
  }
}

/**
 * Verifies signature and dispatches the event to the right handler.
 * Returns a string identifier (event type) on success or throws on bad
 * signature. Always idempotent: every handler is safe to replay.
 */
export async function handleStripeEvent(
  rawBody: string,
  signature: string,
): Promise<{ type: string; processed: boolean }> {
  const stripe = getStripe();
  const event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    getWebhookSecret(),
  );

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;
        const sub = await stripe.subscriptions.retrieve(subId);
        // Hydrate metadata from the checkout session (which carries
        // org_id + plan_code) so the sync function has everything it
        // needs even if subscription_data.metadata wasn't propagated.
        sub.metadata = {
          ...(sub.metadata ?? {}),
          ...((session.metadata as Record<string, string>) ?? {}),
        };
        await syncSubscriptionRow(sub);
      }
      return { type: event.type, processed: true };
    }

    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscriptionRow(sub);
      return { type: event.type, processed: true };
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const admin = supabaseAdmin();
      await admin
        .from("subscriptions")
        .update({
          status: "canceled",
          canceled_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", sub.id);
      return { type: event.type, processed: true };
    }

    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice & {
        subscription?: string | Stripe.Subscription | null;
      };
      const subId =
        typeof inv.subscription === "string"
          ? inv.subscription
          : inv.subscription?.id;
      if (subId) {
        const admin = supabaseAdmin();
        await admin
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("stripe_subscription_id", subId);
      }
      return { type: event.type, processed: true };
    }

    case "invoice.paid": {
      // Portal owns invoice display; nothing to do here. Returning
      // processed=true keeps Stripe from retrying.
      return { type: event.type, processed: true };
    }

    default:
      return { type: event.type, processed: false };
  }
}
