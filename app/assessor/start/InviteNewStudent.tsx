"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";

interface CreatedEnduserResponse {
  userId: string;
  alreadyExisted: boolean;
}

/**
 * Invite a new student into the assessor's org. POSTs to /api/pairing/endusers
 * which idempotently provisions the auth user, the profile, and the
 * org_members row. On success we router.refresh() so the picker re-hydrates
 * with the new enduser, and chain into POST /api/sessions/start to navigate
 * straight into the interview UI on /?sessionId=...
 *
 * If the user already existed (HTTP 409) we still proceed — the route returns
 * the existing userId, which is exactly what we need to start an interview.
 */
export function InviteNewStudent() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setStatus("submitting");

    try {
      const inviteRes = await fetch("/api/pairing/endusers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), displayName: displayName.trim() }),
      });

      // 200 = newly created, 409 = already existed (still has userId in body).
      if (inviteRes.status !== 200 && inviteRes.status !== 409) {
        const body = (await inviteRes.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        throw new Error(body.error ?? `Invite failed (${inviteRes.status})`);
      }

      const created = (await inviteRes.json()) as CreatedEnduserResponse;
      if (!created.userId) {
        throw new Error("Invite succeeded but no user id returned");
      }

      if (created.alreadyExisted) {
        setInfo(
          "Student already existed in your organization — starting the interview now.",
        );
      }

      // Refresh the server prop so the picker re-renders with the new student.
      router.refresh();

      // Chain into start-session and bounce to the interview UI.
      const startRes = await fetch("/api/sessions/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enduserUserId: created.userId }),
      });
      if (!startRes.ok) {
        const body = (await startRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Failed to start (${startRes.status})`);
      }
      const { sessionId } = (await startRes.json()) as { sessionId: string };
      setStatus("success");
      router.push(`/?sessionId=${encodeURIComponent(sessionId)}` as Route);
    } catch (err) {
      setStatus("error");
      setError((err as Error).message);
    }
  }

  const submitting = status === "submitting" || status === "success";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
      <label className="block text-sm font-medium text-neutral-700">
        Student name
        <input
          type="text"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Jordan Smith"
          autoComplete="name"
          disabled={submitting}
          className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50"
        />
      </label>

      <label className="block text-sm font-medium text-neutral-700">
        Email
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="student@example.com"
          autoComplete="email"
          disabled={submitting}
          className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50"
        />
      </label>

      {info && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {info}
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {status === "submitting"
          ? "Inviting…"
          : status === "success"
          ? "Starting…"
          : "Invite & start interview"}
      </button>

      <p className="text-xs text-neutral-500">
        We&apos;ll add this student to your organization. They&apos;ll be able
        to sign in later via password reset on the email they receive.
      </p>
    </form>
  );
}
