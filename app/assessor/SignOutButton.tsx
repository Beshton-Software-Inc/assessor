"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Sign-out button shared by the assessor dashboard and detail pages.
 * Clears the Supabase session cookie via the browser client and pushes
 * the user to /login. We refresh() afterwards so the middleware sees
 * the missing cookie on the next render.
 */
export function SignOutButton({
  className,
}: {
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await supabaseBrowser().auth.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      className={
        className ??
        "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      }
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
