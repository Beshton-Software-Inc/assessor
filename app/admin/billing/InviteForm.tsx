"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Email + role inviter. POSTs /api/billing/invites and refreshes the
 * server-rendered list on success. Disambiguates server errors so the
 * common "already a member" / "invalid email" flows surface clearly.
 */
export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"assessor" | "org_admin">("assessor");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/billing/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        invite?: { email?: string };
        error?: string;
      };
      if (!res.ok) {
        setErr(
          json.error === "invalid_email"
            ? "That doesn’t look like a valid email."
            : json.error === "already_member"
              ? "That email is already a member of this org."
              : (json.error ?? `invite_failed (${res.status})`),
        );
        return;
      }
      setOkMsg(`Invitation sent to ${json.invite?.email ?? email}.`);
      setEmail("");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col">
        <label
          htmlFor="invite-email"
          className="text-xs font-medium text-neutral-500"
        >
          Email
        </label>
        <input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          className="mt-1 w-72 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col">
        <label
          htmlFor="invite-role"
          className="text-xs font-medium text-neutral-500"
        >
          Role
        </label>
        <select
          id="invite-role"
          value={role}
          onChange={(e) =>
            setRole(e.target.value as "assessor" | "org_admin")
          }
          className="mt-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="assessor">Assessor</option>
          <option value="org_admin">Org admin</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={busy || email.trim().length === 0}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send invite"}
      </button>
      {err && <p className="basis-full text-xs text-red-600">{err}</p>}
      {okMsg && <p className="basis-full text-xs text-emerald-700">{okMsg}</p>}
    </form>
  );
}
