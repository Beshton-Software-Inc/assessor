/**
 * Shared billing types. Mirrors the public.plans / public.subscriptions
 * tables and the API response shapes consumed by the admin/billing UI.
 */

export type PlanCode = "trial" | "starter" | "pro";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

export interface PlanRow {
  code: PlanCode;
  name: string;
  seat_price_cents: number;
  quota_per_seat: number;
  overage_cents: number;
  is_trial: boolean;
  stripe_seat_price_id: string | null;
  stripe_overage_meter_id: string | null;
  created_at: string;
}

export interface SubscriptionRow {
  id: string;
  org_id: string;
  plan_code: PlanCode;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: SubscriptionStatus;
  seat_quantity: number;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SeatInviteRow {
  id: string;
  org_id: string;
  invited_by: string;
  email: string;
  role: "assessor" | "org_admin";
  status: "pending" | "accepted" | "revoked" | "expired";
  token: string;
  created_at: string;
  accepted_at: string | null;
}

export interface UsageEventRow {
  id: number;
  org_id: string;
  actor_user_id: string | null;
  kind: "analysis_run" | "session_started";
  target_session_id: string | null;
  target_analysis_id: string | null;
  quantity: number;
  billed: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface UsageSummary {
  plan: {
    code: PlanCode;
    name: string;
    quotaPerSeat: number;
    overageCents: number;
    seatPriceCents: number;
  };
  subscription: {
    status: SubscriptionStatus;
    seatQuantity: number;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    daysRemaining: number | null;
  };
  currentPeriod: {
    used: number;
    included: number;
    overage: number;
    projectedOverageCents: number;
  };
  last3Months: Array<{ month: string; count: number }>;
}

export class QuotaExceededError extends Error {
  code = "quota_exceeded" as const;
  constructor(
    public currentCount: number,
    public quota: number,
    public planCode: PlanCode,
    public status: SubscriptionStatus,
  ) {
    super("quota_exceeded");
  }
}
