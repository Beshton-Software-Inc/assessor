import type { Metadata } from "next";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";
import { PricingCTA } from "./PricingCTA";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — Academic Assessor",
  description:
    "Per-seat pricing for academic assessment teams. 14-day free trial, transparent overage pricing, no contracts.",
};

interface PlanRow {
  code: string;
  name: string;
  seat_price_cents: number;
  quota_per_seat: number;
  overage_cents: number;
  is_trial: boolean;
}

// Fallback plans in case the DB read fails (e.g. local dev with no migration).
// These mirror supabase/migrations/0005_billing.sql seed values exactly.
const FALLBACK_PLANS: PlanRow[] = [
  { code: "trial", name: "Trial", seat_price_cents: 0, quota_per_seat: 5, overage_cents: 0, is_trial: true },
  { code: "starter", name: "Starter", seat_price_cents: 2900, quota_per_seat: 50, overage_cents: 150, is_trial: false },
  { code: "pro", name: "Pro", seat_price_cents: 4900, quota_per_seat: 200, overage_cents: 150, is_trial: false },
];

async function loadPlans(): Promise<Record<string, PlanRow>> {
  try {
    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("plans")
      .select("code, name, seat_price_cents, quota_per_seat, overage_cents, is_trial")
      .in("code", ["trial", "starter", "pro"]);
    if (error || !data || data.length === 0) {
      return Object.fromEntries(FALLBACK_PLANS.map((p) => [p.code, p]));
    }
    const map: Record<string, PlanRow> = {};
    for (const row of data as PlanRow[]) map[row.code] = row;
    // Fill any missing codes with fallback so the page always renders three columns.
    for (const fb of FALLBACK_PLANS) if (!map[fb.code]) map[fb.code] = fb;
    return map;
  } catch {
    return Object.fromEntries(FALLBACK_PLANS.map((p) => [p.code, p]));
  }
}

function formatPrice(cents: number): string {
  if (cents === 0) return "$0";
  if (cents % 100 === 0) return `$${cents / 100}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatOverage(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function PricingPage() {
  const [plans, user] = await Promise.all([loadPlans(), getUser()]);
  const isSignedIn = Boolean(user);

  const trial = plans.trial;
  const starter = plans.starter;
  const pro = plans.pro;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-50 text-neutral-900">
      {/* Decorative gradient orbs */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 -z-0 transform-gpu blur-3xl"
      >
        <div
          className="relative left-1/2 aspect-[1155/678] w-[72.1875rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-indigo-300 via-sky-200 to-emerald-200 opacity-30"
          style={{
            clipPath:
              "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.7%, 76.1% 97.7%, 74.1% 44.1%)",
          }}
        />
      </div>

      {/* Top nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900 text-white">
            A
          </span>
          <span className="text-neutral-900">Academic Assessor</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href={isSignedIn ? "/" : "/login"}
            className="rounded-lg px-3 py-2 text-neutral-700 hover:text-neutral-900"
          >
            {isSignedIn ? "Dashboard" : "Sign in"}
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-3xl px-6 pt-8 pb-12 text-center sm:pt-16 sm:pb-20">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/80 px-3 py-1 text-xs font-medium text-neutral-600 shadow-sm backdrop-blur">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          14-day free trial — no credit card required
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
          Plans built for assessment teams
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-neutral-600">
          Per-seat pricing, transparent overage, and a quota that scales with you. Cancel any
          time from your billing dashboard.
        </p>
      </section>

      {/* Plan cards */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-16">
        <div className="grid gap-6 md:grid-cols-3">
          {/* Trial */}
          <article className="group flex flex-col rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm transition hover:shadow-md">
            <header>
              <h2 className="text-base font-semibold text-neutral-900">{trial.name}</h2>
              <p className="mt-1 text-sm text-neutral-500">Try the full product, on us.</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight text-neutral-900">Free</span>
                <span className="text-sm text-neutral-500">/ 14 days</span>
              </div>
            </header>
            <ul className="mt-6 space-y-3 text-sm text-neutral-700">
              <Feature>{trial.quota_per_seat} analyses across your org</Feature>
              <Feature>Full feature access</Feature>
              <Feature>No credit card required</Feature>
              <Feature>Read-only after trial until you subscribe</Feature>
            </ul>
            <div className="mt-8 pt-6 border-t border-neutral-100">
              <PricingCTA
                kind="trial"
                isSignedIn={isSignedIn}
                label="Start free trial"
                variant="secondary"
              />
            </div>
          </article>

          {/* Starter (highlighted) */}
          <article className="relative flex flex-col rounded-2xl border-2 border-neutral-900 bg-white p-7 shadow-lg ring-1 ring-neutral-900/5">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white shadow-sm">
              Most popular
            </span>
            <header>
              <h2 className="text-base font-semibold text-neutral-900">{starter.name}</h2>
              <p className="mt-1 text-sm text-neutral-500">For growing assessment teams.</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight text-neutral-900">
                  {formatPrice(starter.seat_price_cents)}
                </span>
                <span className="text-sm text-neutral-500">/ seat / month</span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">Billed monthly. Prorated changes.</p>
            </header>
            <ul className="mt-6 space-y-3 text-sm text-neutral-700">
              <Feature emphasis>
                {starter.quota_per_seat} analyses included per seat
              </Feature>
              <Feature>
                {formatOverage(starter.overage_cents)} per analysis past quota
              </Feature>
              <Feature>Unlimited assessors per org</Feature>
              <Feature>Email support</Feature>
            </ul>
            <div className="mt-8 pt-6 border-t border-neutral-100">
              <PricingCTA
                kind="starter"
                isSignedIn={isSignedIn}
                label={isSignedIn ? "Subscribe" : "Start with Starter"}
                variant="primary"
              />
            </div>
          </article>

          {/* Pro */}
          <article className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm transition hover:shadow-md">
            <header>
              <h2 className="text-base font-semibold text-neutral-900">{pro.name}</h2>
              <p className="mt-1 text-sm text-neutral-500">For high-volume programs.</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight text-neutral-900">
                  {formatPrice(pro.seat_price_cents)}
                </span>
                <span className="text-sm text-neutral-500">/ seat / month</span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">Billed monthly. Prorated changes.</p>
            </header>
            <ul className="mt-6 space-y-3 text-sm text-neutral-700">
              <Feature emphasis>
                {pro.quota_per_seat} analyses included per seat
              </Feature>
              <Feature>
                {formatOverage(pro.overage_cents)} per analysis past quota
              </Feature>
              <Feature>Priority support</Feature>
              <Feature>Custom org branding (coming soon)</Feature>
            </ul>
            <div className="mt-8 pt-6 border-t border-neutral-100">
              <PricingCTA
                kind="pro"
                isSignedIn={isSignedIn}
                label={isSignedIn ? "Subscribe" : "Start with Pro"}
                variant="secondary"
              />
            </div>
          </article>
        </div>

        {/* Comparison strip */}
        <div className="mt-10 grid grid-cols-1 gap-3 rounded-2xl border border-neutral-200 bg-white/60 p-5 text-sm text-neutral-600 backdrop-blur sm:grid-cols-3">
          <ComparisonRow
            label="What counts as an analysis?"
            value="One analyze run per session"
          />
          <ComparisonRow
            label="Change seats anytime"
            value="Prorated immediately"
          />
          <ComparisonRow
            label="Cancel"
            value="From your billing dashboard"
          />
        </div>
      </section>

      {/* FAQ */}
      <section className="relative z-10 mx-auto max-w-3xl px-6 pb-20">
        <h2 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl">
          Frequently asked questions
        </h2>
        <div className="mt-8 divide-y divide-neutral-200 rounded-2xl border border-neutral-200 bg-white">
          <Faq
            q="What counts as an analysis?"
            a="An analysis is a single run of our scoring pipeline against a completed assessment session. Replays, re-listening, and viewing past results don't count. You're only billed when an analysis is freshly produced."
          />
          <Faq
            q="Can I change my seat count later?"
            a="Yes. Your org admin can add or remove seats from the billing dashboard at any time. Changes prorate immediately and a new invoice is issued for the difference."
          />
          <Faq
            q="What happens at the end of my free trial?"
            a="Your account becomes read-only — past assessments and analyses remain accessible, but new analyses are blocked until you subscribe. You can subscribe at any time to lift the block; nothing is deleted."
          />
          <Faq
            q="Are there contracts or annual commitments?"
            a="No. Plans are month-to-month and you can cancel from the customer portal at any time. Cancellation takes effect at the end of the current billing period."
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 mx-auto max-w-6xl px-6 pb-12">
        <div className="flex flex-col items-center justify-between gap-3 border-t border-neutral-200 pt-8 text-xs text-neutral-500 sm:flex-row">
          <p>© {new Date().getFullYear()} Academic Assessor</p>
          <div className="flex gap-5">
            <Link href="/" className="hover:text-neutral-900">
              Home
            </Link>
            <Link href={isSignedIn ? "/" : "/login"} className="hover:text-neutral-900">
              {isSignedIn ? "Dashboard" : "Sign in"}
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Feature({
  children,
  emphasis = false,
}: {
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <li className="flex items-start gap-3">
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="mt-0.5 h-5 w-5 flex-none text-emerald-600"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
          clipRule="evenodd"
        />
      </svg>
      <span className={emphasis ? "font-medium text-neutral-900" : undefined}>{children}</span>
    </li>
  );
}

function ComparisonRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
      <span className="mt-1 font-medium text-neutral-900">{value}</span>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group p-5 [&[open]>summary>span:last-child]:rotate-45">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-neutral-900">
        <span>{q}</span>
        <span
          aria-hidden="true"
          className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full border border-neutral-300 text-neutral-500 transition-transform"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 1v10M1 6h10" strokeLinecap="round" />
          </svg>
        </span>
      </summary>
      <p className="mt-3 text-sm leading-relaxed text-neutral-600">{a}</p>
    </details>
  );
}
