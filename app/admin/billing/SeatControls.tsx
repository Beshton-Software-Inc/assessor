"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * +/- seat stepper. POSTs /api/billing/seats with the new total and
 * router.refresh()es the page to pull the updated subscription row from
 * the server. The minus button is disabled when the new total would
 * drop below the current count of billable members; the user is prompted
 * to remove members in /admin/org first.
 *
 * Optimistic update: we update the displayed count immediately so the UI
 * feels snappy, but if the API rejects we revert and show the error.
 */
export function SeatControls({
  seats,
  activeSeats,
  disabled,
}: {
  seats: number;
  activeSeats: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<number>(seats);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<number | null>(null);

  async function applyChange(target: number) {
    if (target < 1) return;
    setBusy(true);
    setErr(null);
    const previous = current;
    setCurrent(target);
    try {
      const res = await fetch("/api/billing/seats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seats: target }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        seatQuantity?: number;
        error?: string;
        activeSeats?: number;
      };
      if (!res.ok || !json.ok) {
        setCurrent(previous);
        setErr(
          json.error === "seats_below_active_members"
            ? `Cannot drop below ${json.activeSeats ?? activeSeats} active members.`
            : (json.error ?? `seats_failed (${res.status})`),
        );
        return;
      }
      if (typeof json.seatQuantity === "number") {
        setCurrent(json.seatQuantity);
      }
      router.refresh();
    } catch (e) {
      setCurrent(previous);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmTarget(null);
    }
  }

  function requestChange(delta: number) {
    const target = current + delta;
    if (target < 1) return;
    if (delta < 0 && target < activeSeats) {
      setErr(`Cannot drop below ${activeSeats} active members.`);
      return;
    }
    // Confirm before applying because Stripe prorates immediately and
    // issues a real invoice. Skip confirmation for the no-op trial-zero
    // -> subscribe path (caller is gated by `disabled` already).
    setConfirmTarget(target);
  }

  const minusDisabled =
    disabled || busy || current <= 1 || current - 1 < activeSeats;
  const plusDisabled = disabled || busy;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => requestChange(-1)}
          disabled={minusDisabled}
          title={
            current - 1 < activeSeats
              ? "Remove members in /admin/org first"
              : undefined
          }
          className="h-9 w-9 rounded-lg border border-neutral-300 bg-white text-lg font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
        >
          −
        </button>
        <div className="min-w-16 text-center">
          <span className="text-2xl font-semibold tabular-nums text-neutral-900">
            {current}
          </span>
          <span className="ml-1 text-sm text-neutral-500">
            {current === 1 ? "seat" : "seats"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => requestChange(1)}
          disabled={plusDisabled}
          className="h-9 w-9 rounded-lg border border-neutral-300 bg-white text-lg font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
        >
          +
        </button>
      </div>
      {err && <p className="text-xs text-red-600">Error: {err}</p>}

      {confirmTarget !== null && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            Change seats from <strong>{seats}</strong> to{" "}
            <strong>{confirmTarget}</strong>? This will prorate immediately
            and issue a new invoice.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => applyChange(confirmTarget)}
              disabled={busy}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? "Updating…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmTarget(null)}
              disabled={busy}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
