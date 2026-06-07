import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { getMemberships, type Membership } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/supabase/server";

export interface AuthedProfile {
  user_id: string;
  display_name: string | null;
  phone_number: string | null;
  is_app_admin: boolean;
}

export interface AuthedUser {
  id: string;
  email: string | null;
  profile: AuthedProfile | null;
  memberships: Membership[];
}

/**
 * Server-only auth resolver. Returns the authenticated user along with
 * their profile row and org memberships, or null if the request has no
 * valid session.
 *
 * Cached per-request (React `cache`) so multiple calls in the same
 * server render only hit Supabase once.
 *
 * TODO(phase-B): when an app_admin reads through here, tee an entry
 * into the audit_log table so privileged reads are observable.
 */
export const getUser = cache(async (): Promise<AuthedUser | null> => {
  const supa = await supabaseServer();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return null;

  // Use the admin client for the profile read because the user may have
  // just been provisioned and we want the freshest row regardless of
  // RLS shape. The id is trusted (came from a verified JWT).
  const admin = supabaseAdmin();
  const [{ data: profile }, memberships] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id, display_name, phone_number, is_app_admin")
      .eq("user_id", user.id)
      .maybeSingle(),
    getMemberships(user.id),
  ]);

  return {
    id: user.id,
    email: user.email ?? null,
    profile: (profile as AuthedProfile | null) ?? null,
    memberships,
  };
});
