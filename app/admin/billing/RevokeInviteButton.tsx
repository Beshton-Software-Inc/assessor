"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * DELETE /api/billing/invites/[id]. The server flips status to 'revoked'
 * (the magic link Supabase already issued will still resolve, but the
 * /auth/callback acceptance code refuses non-pending invites).
 */
export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function revoke() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/billing/invites/${encodeURIComponent(inviteId)}`,
        { method: "DELETE" },
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? `revoke_failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={revoke}
        disabled={busy}
        className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        {busy ? "Revoking…" : "Revoke"}
      </button>
      {err && <p className="text-[10px] text-red-600">{err}</p>}
    </div>
  );
}
