import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/requireRole";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Friendly cancel landing. Reached when the user closes Stripe Checkout
 * before completing payment. No Stripe call is made — there's nothing to
 * report. We just reassure the user and link back to billing or pricing.
 */
export default async function CheckoutCancelPage() {
  const user = await requireUser();
  const isAppAdmin = Boolean(user.profile?.is_app_admin);
  const isOrgAdmin = user.memberships.some((m) => m.role === "org_admin");
  if (!isAppAdmin && !isOrgAdmin) {
    redirect("/" as Route);
  }

  return (
    <main className="min-h-dvh bg-neutral-50 px-6 py-16">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-neutral-200 bg-white p-8">
          <p className="text-xs uppercase tracking-wide text-neutral-500">
            Checkout cancelled
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
            Your card was not charged
          </h1>
          <p className="mt-3 text-sm text-neutral-600">
            You closed the checkout flow before completing payment. Nothing
            was processed and your subscription status is unchanged.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={"/admin/billing" as Route}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Try again
            </Link>
            <Link
              href={"/pricing" as Route}
              className="text-sm font-medium text-neutral-700 underline hover:text-neutral-900"
            >
              View pricing
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
