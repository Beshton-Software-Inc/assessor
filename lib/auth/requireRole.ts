import "server-only";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getUser, type AuthedUser } from "@/lib/auth/getUser";
import { getLandingPath, type OrgRole } from "@/lib/auth/roles";

// Next.js 15 typed routes treats redirect() as taking Route<string>.
// We construct paths dynamically (login + landing pages), so cast at the
// boundary rather than fighting the type.
const route = (p: string): Route => p as Route;

/**
 * Server-side guard for dashboard pages. Redirects:
 *   - to /login if no session
 *   - to the user's natural landing page if their role doesn't match
 *
 * Returns the resolved AuthedUser so the page can use it without a
 * second round-trip to Supabase.
 *
 * `role = "app_admin"` is a special pseudo-role that maps to the
 * profiles.is_app_admin flag rather than an org_members row.
 */
export async function requireRole(
  role: OrgRole | "app_admin",
): Promise<AuthedUser> {
  const user = await getUser();
  if (!user) {
    redirect(route("/login"));
  }

  const ok =
    role === "app_admin"
      ? Boolean(user.profile?.is_app_admin)
      : user.memberships.some((m) => m.role === role);

  if (!ok) {
    const landing = await getLandingPath(user.id);
    redirect(route(landing));
  }

  return user;
}

/**
 * Soft variant: returns the user (and never null) but does not enforce
 * a role. Use in pages that render multi-role views.
 */
export async function requireUser(): Promise<AuthedUser> {
  const user = await getUser();
  if (!user) redirect(route("/login"));
  return user;
}
