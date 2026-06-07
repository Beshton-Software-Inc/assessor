import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";

let cachedAdmin: SupabaseClient | null = null;

/**
 * Service-role client. BYPASSES Row-Level Security. Use only inside
 * narrow server-side helpers that legitimately need to act on behalf of
 * the system (e.g. minting Storage signed URLs after an RLS-respecting
 * read has confirmed access, or running the analysis pipeline).
 *
 * Never call this from a route without first authenticating the caller.
 */
export function supabaseAdmin(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(serverEnv.supabaseUrl(), serverEnv.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}

function publicAnonKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) env var",
    );
  }
  return key;
}

function publicUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? serverEnv.supabaseUrl();
}

/**
 * Request-scoped server client bound to the Next.js cookie store.
 * Calls made through this client RESPECT Row-Level Security: the caller's
 * JWT (from cookies) drives `auth.uid()` inside policy predicates.
 *
 * This is the default client for API routes and server components that
 * read tenant data. Cookies are awaited per Next.js 15 conventions.
 */
export async function supabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(publicUrl(), publicAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set cookies; the middleware refresh
          // path is the canonical place for that. Swallow here.
        }
      },
    },
  });
}
