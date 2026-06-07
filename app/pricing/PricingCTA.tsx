"use client";

import Link from "next/link";
import type { Route } from "next";

type Kind = "trial" | "starter" | "pro";
type Variant = "primary" | "secondary";

interface Props {
  kind: Kind;
  isSignedIn: boolean;
  label: string;
  variant?: Variant;
}

/**
 * Resolves a CTA destination for each pricing column.
 *
 *  - Signed-out: route through /login?next=… so the user lands on
 *    /admin/billing after auth (with the desired plan preselected for paid
 *    tiers via the #subscribe hash + ?plan= query param).
 *  - Signed-in: drop straight into /admin/billing. Paid plans add ?plan=
 *    and #subscribe so the dashboard can scroll/preselect the chosen tier.
 *
 * The /admin/billing page may not exist yet in this worktree; the link is
 * still safe — the middleware redirects to /login if the user is signed
 * out, and the dashboard route owns its own role gating once it ships.
 */
export function PricingCTA({ kind, isSignedIn, label, variant = "secondary" }: Props) {
  const target = (() => {
    if (kind === "trial") return "/admin/billing";
    return `/admin/billing?plan=${kind}#subscribe`;
  })();

  const href = (
    isSignedIn ? target : `/login?next=${encodeURIComponent(target)}`
  ) as Route;

  const base =
    "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-neutral-900";
  const styles =
    variant === "primary"
      ? "bg-neutral-900 text-white hover:bg-neutral-800 shadow-sm"
      : "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50";

  return (
    <Link href={href} className={`${base} ${styles}`}>
      {label}
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
