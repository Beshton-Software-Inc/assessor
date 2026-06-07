"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Browser-side Supabase client. Reads the user's auth cookie via
 * `@supabase/ssr` so calls are RLS-scoped to the signed-in user.
 *
 * Use this from `"use client"` components only. Server code must use
 * `supabaseServer()` (RLS-respecting) or `supabaseAdmin()` (service role).
 */
export function supabaseBrowser(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env var",
    );
  }
  cached = createBrowserClient(url, anonKey);
  return cached;
}
