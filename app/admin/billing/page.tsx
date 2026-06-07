import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/requireRole";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildUsageSummary } from "@/lib/billing/usage";
import type {
  PlanCode,
  SeatInviteRow,
  SubscriptionStatus,
} from "@/lib/billing/types";
import { SignOutButton } from "../org/SignOutButton";
import {
  BillingOrgPicker,
  type BillingOrgPickerOption,
} from "./BillingOrgPicker";
import { SubscribeButton } from "./SubscribeButton";
import { ManageBillingButton } from "./ManageBillingButton";
import { SeatControls } from "./SeatControls";
import { InviteForm } from "./InviteForm";
import { RevokeInviteButton } from "./RevokeInviteButton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface MemberRow {
  user_id: string;
  role: string;
  created_at: string;
  display_name: string | null;
}

const ROLE_BADGE: Record<string, string> = {
  org_admin: "bg-violet-50 text-violet-700 border border-violet-200",
  assessor: "bg-blue-50 text-blue-700 border border-blue-200",
  enduser: "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

const ROLE_LABEL: Record<string, string> = {
  org_admin: "Org admin",
  assessor: "Assessor",
  enduser: "Student",
};

const STATUS_BADGE: Record<SubscriptionStatus, string> = {
  trialing: "bg-amber-50 text-amber-800 border border-amber-200",
  active: "bg-emerald-50 text-emerald-800 border border-emerald-200",
  past_due: "bg-amber-50 text-amber-800 border border-amber-200",
  canceled: "bg-neutral-100 text-neutral-700 border border-neutral-200",
  unpaid: "bg-neutral-100 text-neutral-700 border border-neutral-200",
  incomplete: "bg-neutral-100 text-neutral-700 border border-neutral-200",
};

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
};

const INVITE_STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800 border border-amber-200",
  accepted: "bg-emerald-50 text-emerald-800 border border-emerald-200",
  revoked: "bg-neutral-100 text-neutral-600 border border-neutral-200",
  expired: "bg-neutral-100 text-neutral-600 border border-neutral-200",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatCents(cents: number): string {
  if (!cents) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatMoneyShort(cents: number): string {
  if (cents % 100 === 0) return `$${cents / 100}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatMonthLabel(yyyymm: string): string {
  // "2026-04" → "Apr"
  const [y, m] = yyyymm.split("-");
  if (!y || !m) return yyyymm;
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  if (Number.isNaN(d.getTime())) return yyyymm;
  return d.toLocaleString(undefined, { month: "short", timeZone: "UTC" });
}

/**
 * Org-admin billing console (phase C).
 *
 * Reads subscription, plan, usage, members, and pending invites for the
 * caller's org and renders four cards: Plan, Usage, Seats, Invites.
 *
 * App-admins are allowed in too — they pick an org via ?org= query and
 * the OrgPicker (reused from /admin/org) covers multi-org admins.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    org?: string;
    invite_error?: string;
    status?: string;
  }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const isAppAdmin = Boolean(user.profile?.is_app_admin);
  const orgAdminMemberships = user.memberships.filter(
    (m) => m.role === "org_admin",
  );

  // Either org_admin somewhere OR app_admin can view this surface.
  if (orgAdminMemberships.length === 0 && !isAppAdmin) {
    redirect("/" as Route);
  }

  const supa = supabaseAdmin();

  // Resolve eligible orgs. For app_admins we list all orgs; for plain
  // org_admins we only list orgs they admin.
  let pickerOrgs: BillingOrgPickerOption[] = [];
  let eligibleOrgIds: string[] = [];
  if (isAppAdmin) {
    const { data } = await supa
      .from("organizations")
      .select("id, name")
      .order("name", { ascending: true });
    const rows = (data ?? []) as { id: string; name: string }[];
    pickerOrgs = rows.map((r) => ({ id: r.id, name: r.name }));
    eligibleOrgIds = rows.map((r) => r.id);
  } else {
    eligibleOrgIds = orgAdminMemberships.map((m) => m.org_id);
    const { data } = await supa
      .from("organizations")
      .select("id, name")
      .in("id", eligibleOrgIds);
    pickerOrgs = ((data ?? []) as { id: string; name: string }[]).map((r) => ({
      id: r.id,
      name: r.name,
    }));
  }

  if (eligibleOrgIds.length === 0) {
    return (
      <main className="min-h-dvh bg-neutral-50 px-6 py-12">
        <div className="mx-auto max-w-4xl">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Billing
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
                Billing
              </h1>
            </div>
            <SignOutButton />
          </header>
          <div className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6">
            <p className="text-sm text-neutral-600">
              You don&apos;t have access to any billing surfaces.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const requestedOrg = params?.org;
  const selectedOrgId =
    requestedOrg && eligibleOrgIds.includes(requestedOrg)
      ? requestedOrg
      : eligibleOrgIds[0];
  if (requestedOrg && !eligibleOrgIds.includes(requestedOrg)) {
    redirect(`/admin/billing?org=${eligibleOrgIds[0]}` as Route);
  }

  const { data: orgRow } = await supa
    .from("organizations")
    .select("id, name, slug")
    .eq("id", selectedOrgId)
    .maybeSingle();
  const selectedOrg = orgRow as
    | { id: string; name: string; slug: string }
    | null;

  if (!selectedOrg) {
    return (
      <main className="min-h-dvh bg-neutral-50 px-6 py-12">
        <div className="mx-auto max-w-4xl">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Billing
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
                Organization not found
              </h1>
            </div>
            <SignOutButton />
          </header>
        </div>
      </main>
    );
  }

  const summary = await buildUsageSummary(selectedOrg.id);

  // Members + pending invites + active seat count.
  const [membersRes, invitesRes, activeSeatsResp] = await Promise.all([
    supa
      .from("org_members")
      .select("user_id, role, created_at")
      .eq("org_id", selectedOrg.id),
    supa
      .from("seat_invites")
      .select(
        "id, email, role, status, created_at, accepted_at, invited_by, token, org_id",
      )
      .eq("org_id", selectedOrg.id)
      .order("created_at", { ascending: false }),
    supa.rpc("org_active_seats", { p_org_id: selectedOrg.id }),
  ]);

  const members = (membersRes.data ?? []) as Array<{
    user_id: string;
    role: string;
    created_at: string;
  }>;

  let memberDisplay: MemberRow[] = [];
  if (members.length > 0) {
    const userIds = members.map((m) => m.user_id);
    const { data: profileRows } = await supa
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);
    const nameByUser = new Map<string, string | null>();
    for (const p of profileRows ?? []) {
      nameByUser.set(
        (p as { user_id: string }).user_id,
        (p as { display_name: string | null }).display_name ?? null,
      );
    }
    memberDisplay = members
      .map((m) => ({
        user_id: m.user_id,
        role: m.role,
        created_at: m.created_at,
        display_name: nameByUser.get(m.user_id) ?? null,
      }))
      .sort((a, b) => {
        const order: Record<string, number> = {
          org_admin: 0,
          assessor: 1,
          enduser: 2,
        };
        const ra = order[a.role] ?? 9;
        const rb = order[b.role] ?? 9;
        if (ra !== rb) return ra - rb;
        return (a.display_name ?? "").localeCompare(b.display_name ?? "");
      });
  }

  const invites = (invitesRes.data ?? []) as SeatInviteRow[];
  const pendingInvites = invites.filter((i) => i.status === "pending");
  const otherInvites = invites.filter((i) => i.status !== "pending");
  const activeSeats = (activeSeatsResp.data as number | null) ?? 0;

  // If usage summary failed to load (subscription row missing — shouldn't
  // happen because of the trigger, but guard anyway).
  if (!summary) {
    return (
      <main className="min-h-dvh bg-neutral-50 px-6 py-12">
        <div className="mx-auto max-w-4xl">
          <BillingHeader
            user={user}
            isAppAdmin={isAppAdmin}
            orgName={selectedOrg.name}
            pickerOrgs={pickerOrgs}
            currentOrg={selectedOrg.id}
          />
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <p className="text-sm text-amber-900">
              No subscription record found for this organization.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const planCode = summary.plan.code as PlanCode;
  const status = summary.subscription.status;
  const includedThisPeriod = summary.currentPeriod.included;
  const usedThisPeriod = summary.currentPeriod.used;
  const overage = summary.currentPeriod.overage;
  const usagePct = includedThisPeriod
    ? Math.min(
        100,
        Math.round((usedThisPeriod / includedThisPeriod) * 100),
      )
    : 0;

  const maxMonthCount = Math.max(
    ...summary.last3Months.map((m) => m.count),
    1,
  );

  const canSubscribe =
    planCode === "trial" ||
    status === "canceled" ||
    status === "unpaid" ||
    status === "incomplete";
  const canManage =
    (planCode === "starter" || planCode === "pro") &&
    (status === "active" || status === "past_due");
  const canChangeSeats = canManage; // same gating as portal

  const inviteError = params?.invite_error;
  const successFlag = params?.status;

  return (
    <main className="min-h-dvh bg-neutral-50 px-6 py-12">
      <div className="mx-auto max-w-4xl">
        <BillingHeader
          user={user}
          isAppAdmin={isAppAdmin}
          orgName={selectedOrg.name}
          pickerOrgs={pickerOrgs}
          currentOrg={selectedOrg.id}
        />

        {status === "past_due" && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span>
              Your subscription is{" "}
              <span className="font-semibold">past due</span>. Update your
              payment method to keep running analyses.
            </span>
            <ManageBillingButton />
          </div>
        )}
        {inviteError && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            We couldn&apos;t apply your invitation: <code>{inviteError}</code>.
            Ask your administrator to resend.
          </div>
        )}
        {successFlag === "subscribed" && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            Subscription confirmed. Welcome aboard.
          </div>
        )}

        {/* (a) PLAN CARD */}
        <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
                Plan
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h3 className="text-2xl font-semibold text-neutral-900">
                  {summary.plan.name}
                </h3>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}
                >
                  {STATUS_LABEL[status]}
                </span>
              </div>
              <p className="mt-2 text-sm text-neutral-700">
                {planCode === "trial" ? (
                  <>
                    Free trial · {summary.plan.quotaPerSeat} analyses across
                    your org · No credit card required
                  </>
                ) : (
                  <>
                    {formatMoneyShort(summary.plan.seatPriceCents)}/seat/mo ·{" "}
                    {summary.plan.quotaPerSeat} analyses included per seat ·{" "}
                    {formatCents(summary.plan.overageCents)}/analysis overage
                  </>
                )}
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                {planCode === "trial" && status === "trialing" ? (
                  <>
                    Trial ends in{" "}
                    <span className="font-medium text-neutral-700">
                      {summary.subscription.daysRemaining ?? 0}{" "}
                      {summary.subscription.daysRemaining === 1
                        ? "day"
                        : "days"}
                    </span>
                    {summary.subscription.currentPeriodEnd && (
                      <>
                        {" "}
                        on {formatDate(summary.subscription.currentPeriodEnd)}
                      </>
                    )}
                  </>
                ) : summary.subscription.currentPeriodEnd ? (
                  <>
                    Renews on{" "}
                    <span className="font-medium text-neutral-700">
                      {formatDate(summary.subscription.currentPeriodEnd)}
                    </span>
                  </>
                ) : (
                  <>No active billing period.</>
                )}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {canManage ? (
                <ManageBillingButton />
              ) : canSubscribe ? (
                <SubscribeButton
                  defaultPlan={planCode === "pro" ? "pro" : "starter"}
                  defaultSeats={Math.max(activeSeats, 1)}
                  reactivate={status !== "trialing"}
                />
              ) : (
                <span className="text-xs text-neutral-400">
                  No actions available.
                </span>
              )}
              <Link
                href={"/pricing" as Route}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-neutral-500 hover:text-neutral-900"
              >
                View public pricing →
              </Link>
            </div>
          </div>
        </section>

        {/* (b) USAGE CARD */}
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
              Usage
            </h2>
            <p className="text-xs text-neutral-500">
              {usedThisPeriod} of {includedThisPeriod} analyses this period
            </p>
          </div>

          <p className="mt-3 text-2xl font-semibold tabular-nums text-neutral-900">
            {usedThisPeriod}{" "}
            <span className="text-neutral-400">/ {includedThisPeriod}</span>
          </p>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className={`h-full ${
                overage > 0 ? "bg-red-500" : "bg-blue-500"
              }`}
              style={{ width: `${usagePct}%` }}
            />
          </div>

          {overage > 0 && (
            <p className="mt-2 text-sm text-red-700">
              Overage: {overage} {overage === 1 ? "analysis" : "analyses"} ·{" "}
              ~{formatCents(summary.currentPeriod.projectedOverageCents)} at{" "}
              {formatCents(summary.plan.overageCents)} each
            </p>
          )}

          {/* 3-month chart */}
          <div className="mt-6">
            <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Last 3 months
            </h3>
            <div className="mt-3 flex h-28 items-end gap-3">
              {summary.last3Months.map((m) => {
                const heightPct = Math.round((m.count / maxMonthCount) * 100);
                return (
                  <div
                    key={m.month}
                    className="flex flex-1 flex-col items-center gap-1"
                  >
                    <div className="text-xs tabular-nums text-neutral-700">
                      {m.count}
                    </div>
                    <div className="relative w-full flex-1 rounded-md bg-neutral-100">
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-md bg-blue-500"
                        style={{
                          height: `${Math.max(heightPct, m.count > 0 ? 8 : 0)}%`,
                        }}
                      />
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-neutral-400">
                      {formatMonthLabel(m.month)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="mt-4 text-xs text-neutral-400">
            Analyses are counted per session-analyze run, not per playback.
            Overage is billed at the end of the period.
          </p>
        </section>

        {/* (c) SEATS CARD */}
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
              Seats
            </h2>
            <p className="text-xs text-neutral-500">
              Active members: {activeSeats} of{" "}
              {summary.subscription.seatQuantity || activeSeats || 0} seats
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <SeatControls
              seats={summary.subscription.seatQuantity}
              activeSeats={activeSeats}
              disabled={!canChangeSeats}
            />
            {!canChangeSeats && (
              <p className="text-xs text-neutral-500">
                Seat changes are available after subscribing to a paid plan.
              </p>
            )}
          </div>

          {summary.subscription.seatQuantity > 0 &&
            activeSeats > summary.subscription.seatQuantity && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                You have more billable members ({activeSeats}) than seats (
                {summary.subscription.seatQuantity}). Upgrade your seat count
                or remove members in{" "}
                <Link
                  href={"/admin/org" as Route}
                  className="underline"
                >
                  /admin/org
                </Link>
                .
              </div>
            )}

          {memberDisplay.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">No members yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {memberDisplay.map((m) => (
                    <tr
                      key={m.user_id}
                      className="border-b border-neutral-100 last:border-b-0"
                    >
                      <td className="py-3 pr-4 text-neutral-900">
                        {m.display_name ?? (
                          <span className="text-neutral-400">
                            (no name set)
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            ROLE_BADGE[m.role] ??
                            "bg-neutral-100 text-neutral-700 border border-neutral-200"
                          }`}
                        >
                          {ROLE_LABEL[m.role] ?? m.role}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-neutral-600">
                        {formatDate(m.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* (d) INVITES CARD */}
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
              Invites
            </h2>
            <p className="text-xs text-neutral-500">
              {pendingInvites.length}{" "}
              {pendingInvites.length === 1 ? "pending" : "pending"}
            </p>
          </div>

          <div className="mt-4">
            <InviteForm />
          </div>

          {pendingInvites.length === 0 && otherInvites.length === 0 ? (
            <p className="mt-6 text-sm text-neutral-500">
              No invites yet. Add one above.
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Sent</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...pendingInvites, ...otherInvites].map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-b border-neutral-100 last:border-b-0"
                    >
                      <td className="py-3 pr-4 text-neutral-900 break-all">
                        {inv.email}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            ROLE_BADGE[inv.role] ??
                            "bg-neutral-100 text-neutral-700 border border-neutral-200"
                          }`}
                        >
                          {ROLE_LABEL[inv.role] ?? inv.role}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            INVITE_STATUS_BADGE[inv.status] ??
                            "bg-neutral-100 text-neutral-700 border border-neutral-200"
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-neutral-600">
                        {formatDate(inv.created_at)}
                      </td>
                      <td className="py-3 pr-4">
                        {inv.status === "pending" ? (
                          <RevokeInviteButton inviteId={inv.id} />
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-4 text-xs text-neutral-400">
            Invitees receive a magic link via email. They will land directly on
            this page after accepting.
          </p>
        </section>
      </div>
    </main>
  );
}

function BillingHeader({
  user,
  isAppAdmin,
  orgName,
  pickerOrgs,
  currentOrg,
}: {
  user: { email: string | null; profile: { display_name: string | null } | null };
  isAppAdmin: boolean;
  orgName: string;
  pickerOrgs: BillingOrgPickerOption[];
  currentOrg: string;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Billing
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
          {orgName}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Signed in as{" "}
          <span className="font-medium text-neutral-700">
            {user.profile?.display_name ?? user.email}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {pickerOrgs.length > 1 && (
          <BillingOrgPicker orgs={pickerOrgs} current={currentOrg} />
        )}
        <Link
          href={"/admin/org" as Route}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Org admin
        </Link>
        {isAppAdmin && (
          <Link
            href={"/admin/console" as Route}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Console
          </Link>
        )}
        <SignOutButton />
      </div>
    </header>
  );
}
