import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";

export interface OrgEnduser {
  userId: string;
  email: string;
  displayName: string | null;
}

/**
 * Lists endusers that are members of `orgId`. The supplied `supa` is used to
 * read org_members + profiles; auth.users (for email) is *always* read via
 * the service-role client because email lives in the auth schema and is not
 * exposed through the standard Postgres role's grants. The auth check is the
 * caller's responsibility.
 *
 * `q` is an optional case-insensitive substring filter applied to display_name
 * and email. Implementation runs in JS after the round-trip; for the Phase B
 * org sizes (tens to low hundreds of endusers per org) this is fine. If
 * orgs grow we revisit with a Postgres view that joins auth.users.email.
 */
export async function listOrgEndusers(
  supa: SupabaseClient,
  orgId: string,
  q?: string,
  limit = 50,
): Promise<OrgEnduser[]> {
  const { data: members, error: memberErr } = await supa
    .from("org_members")
    .select("user_id, role, profiles:profiles!inner(user_id, display_name)")
    .eq("org_id", orgId)
    .eq("role", "enduser");
  if (memberErr) {
    throw new Error(`listOrgEndusers (members) failed: ${memberErr.message}`);
  }

  type Row = {
    user_id: string;
    profiles?: { user_id: string; display_name: string | null } | null;
  };
  const rows = (members ?? []) as unknown as Row[];

  const admin = supabaseAdmin();
  const enriched = await Promise.all(
    rows.map(async (m) => {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      return {
        userId: m.user_id,
        email: u?.user?.email ?? "",
        displayName: m.profiles?.display_name ?? null,
      } satisfies OrgEnduser;
    }),
  );

  const needle = (q ?? "").trim().toLowerCase();
  const filtered = needle
    ? enriched.filter(
        (e) =>
          (e.email ?? "").toLowerCase().includes(needle) ||
          (e.displayName ?? "").toLowerCase().includes(needle),
      )
    : enriched;

  return filtered
    .sort((a, b) => (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email))
    .slice(0, limit);
}

export interface CreateEnduserResult {
  userId: string;
  alreadyExisted: boolean;
}

/**
 * Idempotently provisions an enduser and adds them to `orgId`.
 *
 * Steps (all via service-role admin client):
 *   1. If a user with `email` already exists, reuse them and skip create.
 *   2. Otherwise auth.admin.createUser({ email, email_confirm: true,
 *      password: random, user_metadata: { display_name } }) — the
 *      handle_new_user trigger inserts the profiles row.
 *   3. Upsert org_members(role='enduser') on (org_id, user_id).
 *   4. Upsert the profile display_name in case the trigger fell back to email.
 */
export async function createOrgEnduser(
  orgId: string,
  email: string,
  displayName: string,
): Promise<CreateEnduserResult> {
  const admin = supabaseAdmin();
  const normalizedEmail = email.trim().toLowerCase();

  // Step 1: look up existing user by email.
  const existingId = await findUserIdByEmail(normalizedEmail);
  let userId = existingId;
  let alreadyExisted = Boolean(existingId);

  // Step 2: create if missing.
  if (!userId) {
    const password = generateRandomPassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      email_confirm: true,
      password,
      user_metadata: { display_name: displayName },
    });
    if (createErr || !created?.user) {
      throw new Error(`createOrgEnduser createUser failed: ${createErr?.message ?? "unknown"}`);
    }
    userId = created.user.id;
    alreadyExisted = false;
  }

  // Step 3: upsert org membership.
  const { error: memberErr } = await admin
    .from("org_members")
    .upsert(
      { org_id: orgId, user_id: userId, role: "enduser" },
      { onConflict: "org_id,user_id" },
    );
  if (memberErr) {
    throw new Error(`createOrgEnduser org_members upsert failed: ${memberErr.message}`);
  }

  // Step 4: ensure display_name is recorded in the profile.
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(
      { user_id: userId, display_name: displayName },
      { onConflict: "user_id" },
    );
  if (profileErr) {
    // Non-fatal: the trigger should have already inserted a row.
    console.warn("[pairing] profile display_name upsert failed", profileErr.message);
  }

  return { userId, alreadyExisted };
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = supabaseAdmin();
  // Page through (small orgs only — phase C revisits). Default page size is 50.
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
    page += 1;
    if (page > 50) return null; // bounded scan
  }
}

function generateRandomPassword(): string {
  // 32 bytes of randomness; users invited this way never use this password —
  // they go through the magic-link / password-reset flow instead.
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}
