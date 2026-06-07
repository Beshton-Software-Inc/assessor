"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Scope = "analysis" | "full";
type Expiry = "1d" | "7d" | "30d" | "never";

interface CreateShareLinkFormProps {
  sessionId: string;
}

interface ShareTokenResponse {
  grantId: string;
  token: string;
  url: string;
  scope: Scope;
  expiresAt: string | null;
}

const EXPIRY_TO_MS: Record<Expiry, number | null> = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  never: null,
};

/**
 * Form for minting a new share-link grant. POSTs to /api/sessions/[id]/share-token
 * with the chosen scope/expiry/label, then surfaces the resulting URL in a
 * copy-able toast and router.refresh()es so the new row appears in the table.
 *
 * Auto-copies the URL to the clipboard on success — students will almost
 * always paste this into a message, so save them a click.
 */
export function CreateShareLinkForm({ sessionId }: CreateShareLinkFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [scope, setScope] = useState<Scope>("analysis");
  const [expiry, setExpiry] = useState<Expiry>("7d");
  const [label, setLabel] = useState("");
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatedUrl(null);
    setCopied(false);

    const expMs = EXPIRY_TO_MS[expiry];
    const expiresAt =
      expMs == null ? undefined : new Date(Date.now() + expMs).toISOString();

    const body: {
      scope: Scope;
      expiresAt?: string;
      label?: string;
    } = { scope };
    if (expiresAt) body.expiresAt = expiresAt;
    const trimmedLabel = label.trim();
    if (trimmedLabel) body.label = trimmedLabel;

    let res: Response;
    try {
      res = await fetch(`/api/sessions/${sessionId}/share-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      setError((e as Error).message);
      return;
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      setError(data.error ?? `Failed to create share link (${res.status})`);
      return;
    }

    const data = (await res.json()) as ShareTokenResponse;
    setCreatedUrl(data.url);
    setLabel("");

    // Best-effort clipboard copy. Non-fatal if blocked (Safari sometimes
    // requires a fresh user gesture for clipboard writes).
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(data.url);
        setCopied(true);
      } catch {
        setCopied(false);
      }
    }

    startTransition(() => {
      router.refresh();
    });
  }

  async function copyAgain() {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="font-medium text-neutral-300">Scope</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            disabled={pending}
            className="mt-1.5 block w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="analysis">Analysis only (no recording)</option>
            <option value="full">Full access (recording + analysis)</option>
          </select>
        </label>

        <label className="block text-xs">
          <span className="font-medium text-neutral-300">Expires in</span>
          <select
            value={expiry}
            onChange={(e) => setExpiry(e.target.value as Expiry)}
            disabled={pending}
            className="mt-1.5 block w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="1d">1 day</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="never">Never</option>
          </select>
        </label>
      </div>

      <label className="block text-xs">
        <span className="font-medium text-neutral-300">
          Label <span className="text-neutral-500">(optional, for your reference)</span>
        </span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={pending}
          placeholder="e.g. Mom, College counselor, Mentor"
          maxLength={120}
          className="mt-1.5 block w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center rounded-md bg-indigo-500 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-neutral-950"
        >
          {pending ? "Creating…" : "Create share link"}
        </button>
        {scope === "full" ? (
          <span className="text-xs text-amber-300/80">
            Anyone with this link will be able to download the recording.
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      ) : null}

      {createdUrl ? (
        <div className="rounded-md border border-emerald-800/60 bg-emerald-950/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-emerald-200">
              {copied ? "Link copied to clipboard" : "Share link created"}
            </span>
            <button
              type="button"
              onClick={copyAgain}
              className="inline-flex items-center rounded-md border border-emerald-700/60 bg-emerald-900/40 px-2 py-0.5 text-[11px] font-medium text-emerald-100 hover:border-emerald-500 hover:bg-emerald-900/70 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-neutral-950"
            >
              {copied ? "Copy again" : "Copy"}
            </button>
          </div>
          <code className="mt-2 block break-all rounded bg-neutral-950/80 px-2 py-1.5 font-mono text-[11px] text-emerald-100">
            {createdUrl}
          </code>
          <p className="mt-2 text-[11px] text-emerald-200/70">
            We won&apos;t show this URL again after you leave the page —
            revoke and recreate if you lose it.
          </p>
        </div>
      ) : null}
    </form>
  );
}
