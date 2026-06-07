"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface RevokeButtonProps {
  sessionId: string;
  grantId: string;
  /**
   * Which API surface to call. Both endpoints behave the same backend-side,
   * but the share-token route additionally asserts share_token IS NOT NULL,
   * which gives us a small belt-and-braces guard against UI-side mix-ups.
   */
  kind: "user" | "share";
  /** Used for the confirm() dialog copy — e.g. "alex@school.edu" or "Mom". */
  label?: string | null;
  /** Tailwind variant for the button. */
  variant?: "default" | "subtle";
}

/**
 * Client-side revoke control for a session_grants row. POSTs DELETE to the
 * appropriate API surface, swallows the trivial "already revoked" no-op,
 * then router.refresh()es so the server-rendered access page re-queries
 * and the row visibly disappears.
 */
export function RevokeButton({
  sessionId,
  grantId,
  kind,
  label,
  variant = "default",
}: RevokeButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const path =
    kind === "share"
      ? `/api/sessions/${sessionId}/share-token/${grantId}`
      : `/api/sessions/${sessionId}/grants/${grantId}`;

  async function onClick() {
    setError(null);
    const message =
      kind === "share"
        ? `Revoke this share link${label ? ` ("${label}")` : ""}? Anyone using it will lose access immediately.`
        : `Revoke access for ${label ?? "this person"}? They will no longer be able to view this interview.`;
    if (typeof window !== "undefined" && !window.confirm(message)) return;

    try {
      const res = await fetch(path, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setError(body.error ?? `Revoke failed (${res.status})`);
        return;
      }
    } catch (e) {
      setError((e as Error).message);
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  const baseClasses =
    variant === "subtle"
      ? "inline-flex items-center rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:border-red-700/60 hover:bg-red-950/30 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-neutral-950"
      : "inline-flex items-center rounded-md border border-red-900/60 bg-red-950/30 px-2.5 py-1 text-xs font-medium text-red-200 hover:border-red-600 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-neutral-950";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={baseClasses}
      >
        {pending ? "Revoking…" : "Revoke"}
      </button>
      {error ? <span className="text-xs text-red-300">{error}</span> : null}
    </div>
  );
}
