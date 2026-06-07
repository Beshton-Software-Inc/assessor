import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  QuotaExceededError,
  type PlanRow,
  type SubscriptionRow,
} from "@/lib/billing/types";

/**
 * Calls the SQL helper org_can_run_analysis(). When false, throws a
 * QuotaExceededError populated with the current count and the included
 * quota so the API route can return a structured 402 response.
 *
 * The route should still proceed when this returns successfully — overage
 * for paid plans is allowed; metering happens separately.
 */
export async function assertCanRunAnalysis(orgId: string): Promise<{
  used: number;
  included: number;
  planCode: string;
  status: string;
}> {
  const admin = supabaseAdmin();

  const { data: canRun, error: canErr } = await admin.rpc(
    "org_can_run_analysis",
    { p_org_id: orgId },
  );
  if (canErr) throw new Error(`quota_check_failed: ${canErr.message}`);

  const { data: subRow } = await admin
    .from("subscriptions")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  const sub = subRow as SubscriptionRow | null;

  const { data: planRow } = sub
    ? await admin
        .from("plans")
        .select("*")
        .eq("code", sub.plan_code)
        .maybeSingle()
    : { data: null };
  const plan = planRow as PlanRow | null;

  const { data: usedResp } = await admin.rpc("org_period_analysis_count", {
    p_org_id: orgId,
  });
  const used = (usedResp as number | null) ?? 0;
  const included = plan
    ? plan.is_trial
      ? plan.quota_per_seat
      : plan.quota_per_seat * Math.max(1, sub?.seat_quantity ?? 0)
    : 0;

  if (!canRun) {
    throw new QuotaExceededError(
      used,
      included,
      (sub?.plan_code ?? "trial") as PlanRow["code"],
      (sub?.status ?? "trialing") as SubscriptionRow["status"],
    );
  }

  return {
    used,
    included,
    planCode: sub?.plan_code ?? "trial",
    status: sub?.status ?? "trialing",
  };
}

/**
 * Submits a Stripe meter event for an analysis that ran beyond the
 * org's included quota. Idempotent: Stripe dedupes meter events by
 * `identifier` within a 24h window, and we use the analysis_id which is
 * globally unique. We also flip usage_events.billed=true so subsequent
 * counts of unbilled overruns don't double-charge.
 *
 * No-ops on trial / canceled / unpaid / incomplete plans (those should
 * not have produced an analysis at all if the quota gate is in place).
 */
export async function meterOverageIfNeeded({
  orgId,
  analysisId,
}: {
  orgId: string;
  analysisId: string;
}): Promise<{ metered: boolean }> {
  const admin = supabaseAdmin();
  const { data: subRow } = await admin
    .from("subscriptions")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  const sub = subRow as SubscriptionRow | null;
  if (!sub) return { metered: false };
  if (sub.plan_code !== "starter" && sub.plan_code !== "pro") {
    // mark as billed=true so it doesn't sit in the "unbilled" index forever
    await admin
      .from("usage_events")
      .update({ billed: true })
      .eq("target_analysis_id", analysisId);
    return { metered: false };
  }
  if (sub.status !== "active" && sub.status !== "past_due") {
    return { metered: false };
  }

  const { data: planRow } = await admin
    .from("plans")
    .select("*")
    .eq("code", sub.plan_code)
    .maybeSingle();
  const plan = planRow as PlanRow | null;
  if (!plan) return { metered: false };

  const { data: usedResp } = await admin.rpc("org_period_analysis_count", {
    p_org_id: orgId,
  });
  const used = (usedResp as number | null) ?? 0;
  const included = plan.quota_per_seat * Math.max(1, sub.seat_quantity);

  // Always flip the row to billed=true so the unbilled index stays small.
  // For in-quota analyses this is purely accounting; for overages we also
  // submit the Stripe meter event below.
  await admin
    .from("usage_events")
    .update({ billed: true })
    .eq("target_analysis_id", analysisId);

  if (used <= included) return { metered: false };
  if (!sub.stripe_customer_id) return { metered: false };

  // Lazy-load stripe so a missing STRIPE_SECRET_KEY doesn't blow up the
  // analyze route entirely; instead the meter event silently drops in
  // dev. The webhook secret check guarantees prod has real keys.
  try {
    const { getStripe } = await import("@/lib/billing/stripe");
    const stripe = getStripe();
    await stripe.billing.meterEvents.create({
      event_name: "analysis_overage",
      payload: {
        stripe_customer_id: sub.stripe_customer_id,
        value: "1",
      },
      identifier: analysisId,
    });
    return { metered: true };
  } catch {
    return { metered: false };
  }
}
