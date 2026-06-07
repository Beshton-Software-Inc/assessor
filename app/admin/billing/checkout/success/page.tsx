import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/requireRole";
import { getStripe } from "@/lib/billing/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ManageBillingButton } from "../../ManageBillingButton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SearchParams {
  session_id?: string;
}

/**
 * Post-checkout confirmation page. The Stripe webhook (canonical writer)
 * may not have updated `subscriptions` yet by the time the user is
 * redirected back, so we read directly from Stripe for the friendly
 * confirmation. The /admin/billing card will catch up once the webhook
 * lands a moment later.
 */
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const isAppAdmin = Boolean(user.profile?.is_app_admin);
  const isOrgAdmin = user.memberships.some((m) => m.role === "org_admin");
  if (!isAppAdmin && !isOrgAdmin) {
    redirect("/" as Route);
  }

  const params = await searchParams;
  const sessionId = params.session_id;
  if (!sessionId) {
    redirect("/admin/billing?status=missing_session" as Route);
  }

  let planLabel = "Subscription";
  let seatQuantity: number | null = null;
  let renewsOn: string | null = null;
  let receiptEmail: string | null = null;
  let orgName: string | null = null;
  let stripeFailed = false;

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "customer"],
    });

    const planMeta =
      (session.metadata?.plan_code as string | undefined) ?? null;
    const orgId = (session.metadata?.org_id as string | undefined) ?? null;

    if (planMeta) {
      planLabel = planMeta === "pro" ? "Pro" : "Starter";
    }

    const sub =
      session.subscription && typeof session.subscription !== "string"
        ? session.subscription
        : null;
    if (sub) {
      // Pull seat quantity from the seat line item if present, otherwise
      // fall back to the first item's quantity.
      const items = sub.items?.data ?? [];
      const firstItem = items[0];
      if (firstItem) seatQuantity = firstItem.quantity ?? null;
      // Stripe's TypeScript types may not surface current_period_end on
      // every Subscription variant; index defensively.
      const subWithPeriod = sub as unknown as {
        current_period_end?: number | null;
      };
      const periodEnd = subWithPeriod.current_period_end;
      if (periodEnd) {
        renewsOn = new Date(periodEnd * 1000).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      }
    }

    const cust =
      session.customer && typeof session.customer !== "string"
        ? session.customer
        : null;
    if (cust && "email" in cust) {
      receiptEmail = cust.email ?? null;
    }
    receiptEmail = receiptEmail ?? session.customer_details?.email ?? null;

    if (orgId) {
      const { data: orgRow } = await supabaseAdmin()
        .from("organizations")
        .select("name")
        .eq("id", orgId)
        .maybeSingle();
      orgName = (orgRow as { name: string } | null)?.name ?? null;
    }
  } catch {
    stripeFailed = true;
  }

  return (
    <main className="min-h-dvh bg-neutral-50 px-6 py-16">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-emerald-200 bg-white p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-xl font-semibold">
              ✓
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-emerald-700">
                Subscription active
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
                You&apos;re all set
              </h1>
            </div>
          </div>

          {stripeFailed ? (
            <p className="mt-6 text-sm text-neutral-600">
              We couldn&apos;t fetch your full session details right now, but
              your subscription will be active in a moment. Open the billing
              dashboard for the live status.
            </p>
          ) : (
            <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {orgName && (
                <div>
                  <dt className="text-xs text-neutral-500">Organization</dt>
                  <dd className="mt-1 text-sm font-medium text-neutral-900">
                    {orgName}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-neutral-500">Plan</dt>
                <dd className="mt-1 text-sm font-medium text-neutral-900">
                  {planLabel}
                </dd>
              </div>
              {seatQuantity !== null && (
                <div>
                  <dt className="text-xs text-neutral-500">Seats</dt>
                  <dd className="mt-1 text-sm font-medium text-neutral-900">
                    {seatQuantity}
                  </dd>
                </div>
              )}
              {renewsOn && (
                <div>
                  <dt className="text-xs text-neutral-500">Next renewal</dt>
                  <dd className="mt-1 text-sm font-medium text-neutral-900">
                    {renewsOn}
                  </dd>
                </div>
              )}
              {receiptEmail && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-neutral-500">Receipt</dt>
                  <dd className="mt-1 text-sm text-neutral-700">
                    Sent to{" "}
                    <span className="font-medium text-neutral-900">
                      {receiptEmail}
                    </span>
                  </dd>
                </div>
              )}
            </dl>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={"/admin/billing?status=subscribed" as Route}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Go to billing dashboard
            </Link>
            <ManageBillingButton />
          </div>
        </div>
      </div>
    </main>
  );
}
