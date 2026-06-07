"use client";

import { useState } from "react";

/**
 * Opens the Stripe Customer Portal for the current org. The /api/billing/portal
 * endpoint creates the portal session server-side and returns its URL — we
 * just bounce window.location there. If there's no Stripe customer yet
 * (org has never subscribed), the button hints rather than failing.
 */
export function ManagePaymentButton({
  hasStripeCustomer,
}: {
  hasStripeCustomer: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(body.error ?? `Failed (${res.status})`);
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!hasStripeCustomer) {
    return (
      <div className="text-sm text-neutral-500">
        Subscribe to a plan to manage payment methods.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Opening…" : "Manage payment methods"}
      </button>
      {errorMsg && (
        <p className="text-xs text-red-600">{errorMsg}</p>
      )}
    </div>
  );
}
