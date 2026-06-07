"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Sign-out button for the student dashboard. Calls supabase.auth.signOut()
 * which clears the auth cookie via the @supabase/ssr cookie adapter, then
 * full-refreshes to "/" so the middleware re-evaluates and the cached
 * server tree is dropped.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    const supa = supabaseBrowser();
    const { error: e } = await supa.auth.signOut();
    if (e) {
      setError(e.message);
      return;
    }
    startTransition(() => {
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-neutral-600 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-neutral-950"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error ? (
        <span className="text-xs text-red-300">{error}</span>
      ) : null}
    </div>
  );
}
