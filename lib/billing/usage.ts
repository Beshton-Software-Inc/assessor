import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import type {
  PlanRow,
  SubscriptionRow,
  UsageSummary,
} from "@/lib/billing/types";

/**
 * Builds the UsageSummary object consumed by /api/billing/usage and the
 * server-rendered /admin/billing page. Reads via supabaseAdmin so the
 * caller doesn't need a JWT bound to authenticated; the API route is
 * responsible for enforcing requireRole('org_admin') before calling.
 */
export async function buildUsageSummary(
  orgId: string,
): Promise<UsageSummary | null> {
  const admin = supabaseAdmin();
  const { data: subRow } = await admin
    .from("subscriptions")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!subRow) return null;
  const sub = subRow as SubscriptionRow;

  const { data: planRow } = await admin
    .from("plans")
    .select("*")
    .eq("code", sub.plan_code)
    .maybeSingle();
  const plan = planRow as PlanRow | null;
  if (!plan) return null;

  const { data: usedResp } = await admin.rpc("org_period_analysis_count", {
    p_org_id: orgId,
  });
  const used = (usedResp as number | null) ?? 0;
  const included = plan.is_trial
    ? plan.quota_per_seat
    : plan.quota_per_seat * Math.max(1, sub.seat_quantity);
  const overage = Math.max(0, used - included);
  const projectedOverageCents = overage * plan.overage_cents;

  // Last 3 months bucketed: read all analysis_run events for this org in
  // the last 4 months, then aggregate in JS. Keeps the SQL portable and
  // simple. For phase-2 scale this should move to a SQL window function.
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCMonth(since.getUTCMonth() - 3);
  since.setUTCHours(0, 0, 0, 0);
  const { data: events } = await admin
    .from("usage_events")
    .select("created_at")
    .eq("org_id", orgId)
    .eq("kind", "analysis_run")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true });
  const buckets = new Map<string, number>();
  const monthsToShow: string[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    monthsToShow.push(key);
    buckets.set(key, 0);
  }
  for (const ev of (events ?? []) as Array<{ created_at: string }>) {
    const d = new Date(ev.created_at);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const last3Months = monthsToShow.map((m) => ({
    month: m,
    count: buckets.get(m) ?? 0,
  }));

  let daysRemaining: number | null = null;
  if (sub.current_period_end) {
    const ms =
      new Date(sub.current_period_end).getTime() - Date.now();
    daysRemaining = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }

  return {
    plan: {
      code: plan.code,
      name: plan.name,
      quotaPerSeat: plan.quota_per_seat,
      overageCents: plan.overage_cents,
      seatPriceCents: plan.seat_price_cents,
    },
    subscription: {
      status: sub.status,
      seatQuantity: sub.seat_quantity,
      currentPeriodStart: sub.current_period_start,
      currentPeriodEnd: sub.current_period_end,
      daysRemaining,
    },
    currentPeriod: {
      used,
      included,
      overage,
      projectedOverageCents,
    },
    last3Months,
  };
}
