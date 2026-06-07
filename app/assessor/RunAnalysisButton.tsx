"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * POSTs to /api/sessions/[id]/analyze and refreshes the current route
 * once Gemini returns. The button is disabled with a "Running…" label
 * while the request is in flight; failures surface inline.
 *
 * Variant `inline` is for table rows (compact, no width); `block` is the
 * detail-page button.
 */
export function RunAnalysisButton({
  sessionId,
  variant = "inline",
  disabled = false,
}: {
  sessionId: string;
  variant?: "inline" | "block";
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/analyze`, {
        method: "POST",
      });
      if (!res.ok) {
        const detail = await res
          .json()
          .then((j) => j.error ?? j.detail ?? `${res.status}`)
          .catch(() => `${res.status}`);
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      // Re-fetch the page on the server so the new analysis row shows up.
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isBusy = busy || pending;
  const label = isBusy ? "Running…" : "Run Analysis";

  if (variant === "block") {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled || isBusy}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {label}
        </button>
        {error && (
          <p className="text-sm text-red-700">{error}</p>
        )}
      </div>
    );
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isBusy}
        className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        {label}
      </button>
      {error && (
        <span className="mt-1 text-xs text-red-700 max-w-[180px] truncate" title={error}>
          {error}
        </span>
      )}
    </span>
  );
}
