"use client";

import { useState } from "react";

type Plan = "starter" | "pro";

/**
 * Subscribe / Resubscribe action. Lets the org_admin pick Starter vs Pro
 * via a small inline radio (defaulting to Starter unless they were on Pro)
 * and posts to /api/billing/checkout. The server returns a hosted Stripe
 * Checkout URL which we navigate to via window.location so the redirect
 * survives all browsers (no popup blockers).
 */
export function SubscribeButton({
  defaultPlan,
  defaultSeats,
  reactivate,
}: {
  defaultPlan: Plan;
  defaultSeats: number;
  reactivate?: boolean;
}) {
  const [plan, setPlan] = useState<Plan>(defaultPlan);
  const [seats, setSeats] = useState<number>(Math.max(1, defaultSeats));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planCode: plan, seats }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !json.url) {
        setErr(json.error ?? `checkout_failed (${res.status})`);
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
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 text-xs text-neutral-600">
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            name="plan"
            value="starter"
            checked={plan === "starter"}
            onChange={() => setPlan("starter")}
          />
          Starter
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            name="plan"
            value="pro"
            checked={plan === "pro"}
            onChange={() => setPlan("pro")}
          />
          Pro
        </label>
        <label className="ml-2 inline-flex items-center gap-1">
          <span>Seats</span>
          <input
            type="number"
            min={1}
            value={seats}
            onChange={(e) =>
              setSeats(Math.max(1, parseInt(e.target.value || "1", 10)))
            }
            className="w-16 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Redirecting…" : reactivate ? "Resubscribe" : "Subscribe"}
      </button>
      {err && <p className="text-xs text-red-600">Error: {err}</p>}
    </div>
  );
}
