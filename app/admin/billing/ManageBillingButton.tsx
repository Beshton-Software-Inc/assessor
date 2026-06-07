"use client";

import { useState } from "react";

/**
 * POSTs /api/billing/portal and navigates to the returned Stripe Customer
 * Portal URL. Handles loading state + bubbles up any server-side error.
 */
export function ManageBillingButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !json.url) {
        setErr(json.error ?? `portal_failed (${res.status})`);
        return;
      }
      window.location.href = json.url;
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Opening…" : "Manage billing"}
      </button>
      {err && <p className="text-xs text-red-600">Error: {err}</p>}
    </div>
  );
}
