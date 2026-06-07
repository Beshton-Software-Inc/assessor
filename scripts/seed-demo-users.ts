/**
 * Idempotent demo-user seed.
 *
 * Creates 5 demo accounts (admin, org-admin, assessor, student-1, student-2),
 * upserts their profiles, links them to "Demo Org", and backfills any
 * existing sessions so they belong to the assessor + student-1 in Demo Org.
 *
 * Re-runnable: existing users / memberships are detected and updated rather
 * than duplicated.
 *
 * Usage:
 *   npx tsx scripts/seed-demo-users.ts
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Match the convention used by other scripts in this repo.
loadEnv({ path: ".env.local" });
loadEnv(); // also pick up .env if present

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Role = "app_admin" | "org_admin" | "assessor" | "enduser";

interface DemoUser {
  email: string;
  password: string;
  role: Role;
  displayName: string;
  orgSlug?: string;
}

const DEMO_USERS: DemoUser[] = [
  {
    email: "admin@example.com",
    password: "DemoPass123!",
    role: "app_admin",
    displayName: "Demo App Admin",
  },
  {
    email: "org-admin@example.com",
    password: "DemoPass123!",
    role: "org_admin",
    orgSlug: "demo",
    displayName: "Demo Org Admin",
  },
  {
    email: "assessor@example.com",
    password: "DemoPass123!",
    role: "assessor",
    orgSlug: "demo",
    displayName: "Demo Assessor",
  },
  {
    email: "student-1@example.com",
    password: "DemoPass123!",
    role: "enduser",
    orgSlug: "demo",
    displayName: "Demo Student One",
  },
  {
    email: "student-2@example.com",
    password: "DemoPass123!",
    role: "enduser",
    orgSlug: "demo",
    displayName: "Demo Student Two",
  },
];

/**
 * supabase.auth.admin.createUser throws when the email already exists.
 * Catch that and resolve to the existing user_id by paging through users.
 */
async function ensureUser(u: DemoUser): Promise<string> {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { display_name: u.displayName },
  });
  if (!error && created?.user) {
    console.log(`  + created auth user ${u.email} (${created.user.id})`);
    return created.user.id;
  }

  // Fallback: list users and find by email.
  // listUsers paginates 50 at a time; we walk until we find them.
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error: listErr } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (listErr) throw listErr;
    const match = data.users.find(
      (x) => x.email?.toLowerCase() === u.email.toLowerCase(),
    );
    if (match) {
      console.log(`  = reused existing auth user ${u.email} (${match.id})`);
      return match.id;
    }
    if (data.users.length < 200) break;
    page += 1;
  }
  throw new Error(
    `Could not create or find auth user for ${u.email}: ${error?.message}`,
  );
}

async function upsertProfile(u: DemoUser, userId: string) {
  const { error } = await admin
    .from("profiles")
    .upsert(
      {
        user_id: userId,
        display_name: u.displayName,
        is_app_admin: u.role === "app_admin",
      },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

async function getOrgIdBySlug(slug: string): Promise<string> {
  const { data, error } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();
  if (error || !data) {
    throw new Error(`Demo org with slug=${slug} not found: ${error?.message}`);
  }
  return data.id as string;
}

async function upsertMembership(orgId: string, userId: string, role: Role) {
  if (role === "app_admin") return; // app_admin is profile-level, not org-level
  const { error } = await admin
    .from("org_members")
    .upsert(
      { org_id: orgId, user_id: userId, role },
      { onConflict: "org_id,user_id" },
    );
  if (error) throw error;
}

async function backfillSessions(
  orgId: string,
  assessorId: string,
  studentId: string,
) {
  // Set tenant cols only on rows that haven't been backfilled yet.
  const { data, error } = await admin
    .from("sessions")
    .update({
      org_id: orgId,
      assessor_id: assessorId,
      enduser_id: studentId,
    })
    .is("org_id", null)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

async function main() {
  console.log("Seeding demo users...");

  const demoOrgId = await getOrgIdBySlug("demo");
  console.log(`Demo Org id: ${demoOrgId}`);

  const userIds: Record<string, string> = {};

  for (const u of DEMO_USERS) {
    console.log(`\n→ ${u.email} [${u.role}]`);
    const userId = await ensureUser(u);
    userIds[u.email] = userId;
    await upsertProfile(u, userId);
    console.log(`  profile upserted (is_app_admin=${u.role === "app_admin"})`);
    if (u.orgSlug) {
      await upsertMembership(demoOrgId, userId, u.role);
      console.log(`  org_members upserted in '${u.orgSlug}' as '${u.role}'`);
    }
  }

  const assessorId = userIds["assessor@example.com"];
  const student1Id = userIds["student-1@example.com"];
  if (assessorId && student1Id) {
    const updated = await backfillSessions(demoOrgId, assessorId, student1Id);
    console.log(`\nBackfilled ${updated} legacy session(s) into Demo Org.`);
  } else {
    console.log("\nSkipped session backfill (assessor or student-1 missing).");
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
