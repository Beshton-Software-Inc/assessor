"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface ProfileFormProps {
  initialDisplayName: string;
  initialPhoneNumber: string;
  initialEmail: string;
}

export function ProfileForm({
  initialDisplayName,
  initialPhoneNumber,
  initialEmail,
}: ProfileFormProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber);
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

  const dirty =
    displayName !== initialDisplayName ||
    phoneNumber !== initialPhoneNumber ||
    email.trim().toLowerCase() !== initialEmail.trim().toLowerCase();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg(null);
    setEmailNotice(null);

    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName,
        phoneNumber,
        email: email.trim().toLowerCase() === initialEmail.trim().toLowerCase()
          ? undefined
          : email,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      emailConfirmationSent?: boolean;
    };

    if (!res.ok || body.error) {
      setStatus("error");
      setErrorMsg(body.error ?? `Failed (${res.status})`);
      return;
    }
    setStatus("saved");
    if (body.emailConfirmationSent) {
      setEmailNotice(
        `Confirmation links sent to ${initialEmail} and ${email}. Click the link in the new address to finish the change.`,
      );
    }
    // Re-render the server component so the header + identity card pick up
    // the new display_name immediately.
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-neutral-900">
        Personal details
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        How you appear across the app and how we reach you.
      </p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-neutral-700">
            Display name
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
          </label>
          <label className="block text-sm font-medium text-neutral-700">
            Phone number
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+1 555 123 4567"
              autoComplete="tel"
              className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
          </label>
        </div>

        <label className="block text-sm font-medium text-neutral-700">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            Changes require confirmation from your current and new email.
          </span>
        </label>

        {errorMsg && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMsg}
          </p>
        )}
        {emailNotice && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {emailNotice}
          </p>
        )}
        {status === "saved" && !emailNotice && !errorMsg && (
          <p className="text-sm text-emerald-700">Saved.</p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!dirty || status === "saving"}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </section>
  );
}
