import "server-only";
import Stripe from "stripe";

let cached: Stripe | null = null;

/**
 * Lazy Stripe client singleton. Constructed on first call, cached for the
 * process lifetime. Throws a friendly error when STRIPE_SECRET_KEY is
 * missing or still set to the REPLACE_ME placeholder so build-time imports
 * (e.g. webhook route) don't blow up Vercel deploys before keys are set.
 */
export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key === "REPLACE_ME" || key.startsWith("REPLACE_")) {
    throw new Error(
      "Stripe is not configured: set STRIPE_SECRET_KEY in .env.local " +
        "(see .env.local.example).",
    );
  }
  // Pin a specific API version to insulate from upstream behavior
  // changes. The Stripe SDK's TS types narrow `apiVersion` to the latest
  // string literal it ships with; we ship a config object cast to the
  // SDK's accepted shape so SDK bumps don't churn this file.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = { apiVersion: "2025-07-30.basil", typescript: true } as any;
  cached = new Stripe(key, config);
  return cached;
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret === "REPLACE_ME" || secret.startsWith("REPLACE_")) {
    throw new Error(
      "Stripe webhook secret missing: set STRIPE_WEBHOOK_SECRET in .env.local.",
    );
  }
  return secret;
}

/**
 * Returns the canonical app origin used in success/cancel redirects.
 * Falls back to localhost for local dev so the env file doesn't have to
 * be filled in to run the app at all.
 */
export function getAppOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_ORIGIN ??
    process.env.APP_ORIGIN ??
    "http://localhost:3000"
  );
}
