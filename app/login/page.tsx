"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Provider = "google" | "azure" | "apple";

export default function LoginPage() {
  // useSearchParams forces a CSR bailout; wrap in Suspense so Next can
  // prerender the shell and stream the params-dependent UI on the client.
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const params = useSearchParams();
  const errorParam = params.get("error");
  const nextParam = params.get("next");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(
    errorParam ? decodeURIComponent(errorParam) : null,
  );

  const callbackUrl = (() => {
    if (typeof window === "undefined") return "/auth/callback";
    const url = new URL("/auth/callback", window.location.origin);
    if (nextParam) url.searchParams.set("next", nextParam);
    return url.toString();
  })();

  async function signInOAuth(provider: Provider) {
    setErrorMsg(null);
    const supa = supabaseBrowser();
    const { error } = await supa.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl },
    });
    if (error) setErrorMsg(error.message);
  }

  async function signInMagic(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    setStatus("sending");
    const supa = supabaseBrowser();
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl },
    });
    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
      return;
    }
    setStatus("sent");
  }

  return (
    <main className="min-h-dvh flex items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm border border-neutral-200">
        <h1 className="text-2xl font-semibold text-neutral-900">Sign in</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Use a provider or your email to continue.
        </p>

        {errorMsg && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-200">
            {errorMsg}
          </p>
        )}

        <div className="mt-6 space-y-2">
          <button
            type="button"
            onClick={() => signInOAuth("google")}
            className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
          >
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => signInOAuth("azure")}
            className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
          >
            Continue with Microsoft
          </button>
          <button
            type="button"
            onClick={() => signInOAuth("apple")}
            className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
          >
            Continue with Apple
          </button>
        </div>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-neutral-200" />
          <span className="text-xs text-neutral-400 uppercase tracking-wide">or</span>
          <div className="h-px flex-1 bg-neutral-200" />
        </div>

        <form onSubmit={signInMagic} className="space-y-3">
          <label className="block text-sm font-medium text-neutral-700">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
              disabled={status === "sending" || status === "sent"}
            />
          </label>
          <button
            type="submit"
            disabled={status === "sending" || status === "sent"}
            className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {status === "sending"
              ? "Sending…"
              : status === "sent"
              ? "Check your inbox"
              : "Send magic link"}
          </button>
          {status === "sent" && (
            <p className="text-sm text-neutral-600">
              We emailed a sign-in link to <strong>{email}</strong>.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
