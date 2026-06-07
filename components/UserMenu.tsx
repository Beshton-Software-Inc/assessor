"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { supabaseBrowser } from "@/lib/supabase/client";

interface UserMenuProps {
  displayName?: string | null;
  email?: string | null;
}

/**
 * Header dropdown that replaces the per-dashboard SignOutButton. Shows
 * "Welcome, [name] ▾" and on click reveals a Profile + Sign out menu.
 *
 * Sign out: clears the auth cookie via supabase.auth.signOut() and then
 * router.replace("/") + refresh() so middleware re-evaluates the gate.
 */
export function UserMenu({ displayName, email }: UserMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function onSignOut() {
    setError(null);
    const supa = supabaseBrowser();
    const { error: e } = await supa.auth.signOut();
    if (e) {
      setError(e.message);
      return;
    }
    setOpen(false);
    startTransition(() => {
      router.replace("/" as Route);
      router.refresh();
    });
  }

  const label = displayName?.trim() || email?.trim() || "Account";

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-1"
      >
        <span className="hidden text-neutral-500 sm:inline">Welcome,</span>
        <span className="max-w-[14ch] truncate">{label}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          width={10}
          height={10}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M2 4l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-48 origin-top-right rounded-md border border-neutral-200 bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5"
        >
          {email && (
            <div className="border-b border-neutral-100 px-3 py-2 text-xs text-neutral-500">
              <div className="truncate" title={email}>
                {email}
              </div>
            </div>
          )}
          <Link
            href={"/profile" as Route}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
          >
            Profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            disabled={pending}
            className="block w-full px-3 py-2 text-left text-sm text-neutral-900 hover:bg-neutral-50 disabled:opacity-50"
          >
            {pending ? "Signing out…" : "Sign out"}
          </button>
          {error && (
            <p className="px-3 py-1 text-xs text-red-600">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
