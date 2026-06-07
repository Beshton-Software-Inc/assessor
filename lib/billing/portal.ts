import "server-only";
import { getStripe, getAppOrigin } from "@/lib/billing/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { SubscriptionRow } from "@/lib/billing/types";

export interface PortalResult {
  url: string;
}

export class PortalError extends Error {
  constructor(
    public code: "no_customer" | "subscription_missing" | "stripe_error",
    message?: string,
  ) {
    super(message ?? code);
  }
}

/**
 * Mints a Stripe Customer Portal session for an org. The portal is the
 * canonical place for the customer to manage payment methods, view
 * invoices, and cancel/reactivate the subscription.
 */
export async function createPortalSession({
  orgId,
}: {
  orgId: string;
}): Promise<PortalResult> {
  const admin = supabaseAdmin();
  const stripe = getStripe();

  const { data, error } = await admin
    .from("subscriptions")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new PortalError("stripe_error", error.message);
  if (!data) throw new PortalError("subscription_missing");
  const sub = data as SubscriptionRow;
  if (!sub.stripe_customer_id) throw new PortalError("no_customer");

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${getAppOrigin()}/admin/billing`,
  });
  return { url: session.url };
}
