import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/webhook
 *
 * Stripe webhook receiver. The body is read raw via req.text() — Next.js
 * 15 app-router does not pre-parse JSON unless you call req.json(), so
 * the SHA-256 signature verification works directly on the byte stream
 * Stripe sent.
 *
 * We import the handler lazily so a missing STRIPE_SECRET_KEY at build
 * time doesn't break the build (the route module itself is import-safe).
 */
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }
  const rawBody = await req.text();

  try {
    const { handleStripeEvent } = await import("@/lib/billing/webhook");
    const result = await handleStripeEvent(rawBody, signature);
    return NextResponse.json({ received: true, type: result.type });
  } catch (err) {
    const message = (err as Error).message ?? "unknown";
    if (message.toLowerCase().includes("signature")) {
      return NextResponse.json({ error: "bad_signature" }, { status: 400 });
    }
    // Stripe will retry on non-2xx; for unknown errors we still return
    // 500 so we get visibility, but the handler is meant to be fully
    // resilient to known event types.
    return NextResponse.json(
      { error: "webhook_failed", detail: message },
      { status: 500 },
    );
  }
}
