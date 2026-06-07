import { redirect } from "next/navigation";
import type { Route } from "next";
import { getUser } from "@/lib/auth/getUser";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ProfileForm } from "./ProfileForm";
import { ManagePaymentButton } from "./ManagePaymentButton";
import { UserMenu } from "@/components/UserMenu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const route = (p: string): Route => p as Route;

const ROLE_LABELS: Record<string, string> = {
  org_admin: "Org admin",
  assessor: "Assessor",
  enduser: "Student",
};

const ROLE_COLORS: Record<string, string> = {
  org_admin: "bg-violet-100 text-violet-800 border-violet-200",
  assessor: "bg-blue-100 text-blue-800 border-blue-200",
  enduser: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export default async function ProfilePage() {
  const user = await getUser();
  if (!user) redirect(route("/login?next=/profile"));

  const admin = supabaseAdmin();

  // Resolve org names for each membership so we can show "Assessor at Demo Org"
  // rather than just "assessor".
  const orgIds = Array.from(new Set(user.memberships.map((m) => m.org_id)));
  const orgsById = new Map<string, { name: string; slug: string }>();
  if (orgIds.length > 0) {
    const { data: orgs } = await admin
      .from("organizations")
      .select("id, name, slug")
      .in("id", orgIds);
    for (const o of (orgs ?? []) as Array<{ id: string; name: string; slug: string }>) {
      orgsById.set(o.id, { name: o.name, slug: o.slug });
    }
  }

  // Org admins also see a payment section. Resolve their primary admin org +
  // subscription row so we can show plan/status alongside the Stripe button.
  const adminMembership = user.memberships.find((m) => m.role === "org_admin");
  let billingContext: {
    orgName: string;
    planCode: string;
    status: string;
    currentPeriodEnd: string | null;
    hasStripeCustomer: boolean;
  } | null = null;

  if (adminMembership) {
    const { data: sub } = await admin
      .from("subscriptions")
      .select(
        "plan_code, status, current_period_end, stripe_customer_id, plans(name)",
      )
      .eq("org_id", adminMembership.org_id)
      .maybeSingle();
    const orgName = orgsById.get(adminMembership.org_id)?.name ?? "Your organization";
    if (sub) {
      const row = sub as unknown as {
        plan_code: string;
        status: string;
        current_period_end: string | null;
        stripe_customer_id: string | null;
        plans: { name: string } | null;
      };
      billingContext = {
        orgName,
        planCode: row.plans?.name ?? row.plan_code,
        status: row.status,
        currentPeriodEnd: row.current_period_end,
        hasStripeCustomer: Boolean(row.stripe_customer_id),
      };
    } else {
      billingContext = {
        orgName,
        planCode: "—",
        status: "no_subscription",
        currentPeriodEnd: null,
        hasStripeCustomer: false,
      };
    }
  }

  return (
    <main className="min-h-dvh bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold text-neutral-900">Profile</h1>
          <UserMenu
            displayName={user.profile?.display_name}
            email={user.email}
          />
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        {/* Identity card — read-only fundamentals */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-neutral-900">Identity</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Your account ID and role membership. Roles are managed by your
            organization administrator.
          </p>

          <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                User ID
              </dt>
              <dd className="mt-1 break-all font-mono text-xs text-neutral-700">
                {user.id}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Roles
              </dt>
              <dd className="mt-1 flex flex-wrap gap-2">
                {user.profile?.is_app_admin && (
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                    App admin
                  </span>
                )}
                {user.memberships.length === 0 && !user.profile?.is_app_admin && (
                  <span className="text-sm text-neutral-500">No roles</span>
                )}
                {user.memberships.map((m) => {
                  const orgName = orgsById.get(m.org_id)?.name ?? m.org_id;
                  return (
                    <span
                      key={`${m.org_id}-${m.role}`}
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[m.role] ?? "bg-neutral-100 text-neutral-800 border-neutral-200"}`}
                    >
                      {ROLE_LABELS[m.role] ?? m.role}
                      <span className="ml-1.5 text-neutral-500">· {orgName}</span>
                    </span>
                  );
                })}
              </dd>
            </div>
          </dl>
        </section>

        {/* Editable profile fields */}
        <ProfileForm
          initialDisplayName={user.profile?.display_name ?? ""}
          initialPhoneNumber={user.profile?.phone_number ?? ""}
          initialEmail={user.email ?? ""}
        />

        {/* Payment section — org admins only */}
        {billingContext && (
          <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-neutral-900">
              Payment
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Billing for <span className="font-medium">{billingContext.orgName}</span>.
              Manage payment methods and invoices in the Stripe customer portal.
            </p>

            <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Current plan
                </dt>
                <dd className="mt-1 text-sm font-medium text-neutral-900">
                  {billingContext.planCode}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Status
                </dt>
                <dd className="mt-1 text-sm text-neutral-900">
                  {billingContext.status.replace("_", " ")}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Period ends
                </dt>
                <dd className="mt-1 text-sm text-neutral-900">
                  {billingContext.currentPeriodEnd
                    ? new Date(billingContext.currentPeriodEnd).toLocaleDateString()
                    : "—"}
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex flex-wrap gap-3">
              <ManagePaymentButton hasStripeCustomer={billingContext.hasStripeCustomer} />
              <a
                href="/admin/billing"
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
              >
                Open billing console
              </a>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
