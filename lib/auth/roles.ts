import { supabaseAdmin } from "@/lib/supabase/server";

export type OrgRole = "org_admin" | "assessor" | "enduser";

export interface Membership {
  org_id: string;
  role: OrgRole;
}

/**
 * These helpers all use the service-role admin client deliberately:
 * they run inside auth gates BEFORE we have an RLS-capable JWT bound
 * to the supabaseServer() client (chicken-and-egg). Pass the user_id
 * explicitly — never trust a parameter that crossed a network boundary
 * without first calling supabaseServer().auth.getUser().
 */

export async function getAppAdmin(userId: string): Promise<boolean> {
  const supa = supabaseAdmin();
  const { data, error } = await supa
    .from("profiles")
    .select("is_app_admin")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.is_app_admin);
}

export async function getMemberships(userId: string): Promise<Membership[]> {
  const supa = supabaseAdmin();
  const { data, error } = await supa
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", userId);
  if (error || !data) return [];
  return data as Membership[];
}

export async function getAssessorOrgId(userId: string): Promise<string | null> {
  const memberships = await getMemberships(userId);
  return memberships.find((m) => m.role === "assessor")?.org_id ?? null;
}

export async function getOrgAdminOrgId(userId: string): Promise<string | null> {
  const memberships = await getMemberships(userId);
  return memberships.find((m) => m.role === "org_admin")?.org_id ?? null;
}

export async function getEnduserOrgIds(userId: string): Promise<string[]> {
  const memberships = await getMemberships(userId);
  return memberships.filter((m) => m.role === "enduser").map((m) => m.org_id);
}

/**
 * Returns the "highest" landing page for a user given their roles.
 * Order: app_admin > org_admin > assessor > enduser > none.
 */
export async function getLandingPath(userId: string): Promise<string> {
  if (await getAppAdmin(userId)) return "/admin/org";
  const memberships = await getMemberships(userId);
  if (memberships.some((m) => m.role === "org_admin")) return "/admin/org";
  if (memberships.some((m) => m.role === "assessor")) return "/assessor";
  if (memberships.some((m) => m.role === "enduser")) return "/student";
  return "/";
}
