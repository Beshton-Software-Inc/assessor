/**
 * Phase A happy-path role/RLS e2e test.
 *
 * Signs in as each demo account using the anon-key client (the same key the
 * browser uses) and verifies the data layer — auth + RLS — behaves correctly
 * for legitimate users. UI is out of scope.
 *
 * Steps:
 *   1) student-1: can read own session(s) + own profile.
 *   2) assessor:  can read same session(s) + own org membership.
 *   3) org-admin: can read Demo Org row.
 *   4) app-admin: profile flag set; can read ALL session rows.
 *   5) revocation: app-admin sets student_revoked=true on a session ->
 *      assessor can no longer SELECT it.
 *
 * Usage:  npm run test:roles
 */
import { config as loadEnv } from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv();

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
  console.error(
    "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in env.",
  );
  process.exit(1);
}

const PASSWORD = "DemoPass123!";

let failures = 0;
function pass(msg: string) {
  console.log(`PASS  ${msg}`);
}
function fail(msg: string, err?: unknown) {
  failures += 1;
  console.error(`FAIL  ${msg}${err ? ` :: ${formatErr(err)}` : ""}`);
}
function formatErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Fresh anon client + sign-in. Each role gets its own client so JWTs don't
 *  leak across steps. */
async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log("=== Phase A role/RLS happy-path test ===\n");

  // ---------- Step 1: student-1 ----------
  console.log("[1] student-1@example.com");
  try {
    const sb = await signIn("student-1@example.com");
    const { data: sessions, error: sErr } = await sb
      .from("sessions")
      .select("id, enduser_id, assessor_id, org_id");
    if (sErr) throw sErr;
    if (!sessions || sessions.length < 1) {
      fail(`student-1 sessions: expected >=1, got ${sessions?.length ?? 0}`);
    } else {
      pass(`student-1 sees ${sessions.length} session(s)`);
    }

    const {
      data: { user },
    } = await sb.auth.getUser();
    const { data: profile, error: pErr } = await sb
      .from("profiles")
      .select("user_id, display_name, is_app_admin")
      .eq("user_id", user!.id)
      .single();
    if (pErr) throw pErr;
    if (!profile?.display_name) {
      fail("student-1 profile.display_name missing");
    } else {
      pass(`student-1 profile.display_name = "${profile.display_name}"`);
    }
    await sb.auth.signOut();
  } catch (e) {
    fail("student-1 step", e);
  }

  // Capture Demo Org session count via service role. Scoping by org matters:
  // other test orgs (e.g. alpha-org from test-rls) own sessions that demo
  // assessor cannot see, so a global count would over-state the expected min.
  const { data: demoOrg, error: doErr } = await serviceClient
    .from("organizations")
    .select("id")
    .eq("slug", "demo")
    .single();
  if (doErr || !demoOrg) {
    fail("service-role demo-org lookup", doErr);
  }
  const { count: backfilledCount, error: bcErr } = await serviceClient
    .from("sessions")
    .select("*", { count: "exact", head: true })
    .eq("org_id", demoOrg!.id);
  if (bcErr) {
    fail("service-role demo-org session count probe", bcErr);
  }
  const expectedMin = backfilledCount ?? 1;

  // ---------- Step 2: assessor ----------
  console.log("\n[2] assessor@example.com");
  let assessorTargetSessionId: string | null = null;
  try {
    const sb = await signIn("assessor@example.com");
    const { data: sessions, error: sErr } = await sb
      .from("sessions")
      .select("id, assessor_id, student_revoked");
    if (sErr) throw sErr;
    if (!sessions || sessions.length < expectedMin) {
      fail(
        `assessor sessions: expected >=${expectedMin}, got ${sessions?.length ?? 0}`,
      );
    } else {
      pass(`assessor sees ${sessions.length} session(s) (>= ${expectedMin})`);
      assessorTargetSessionId = sessions[0]!.id as string;
    }

    const { data: members, error: mErr } = await sb
      .from("org_members")
      .select("org_id, role");
    if (mErr) throw mErr;
    if (!members || members.length < 1) {
      fail("assessor org_members: expected >=1");
    } else {
      pass(
        `assessor sees ${members.length} org_members row(s); roles=[${members
          .map((m) => m.role)
          .join(",")}]`,
      );
    }
    await sb.auth.signOut();
  } catch (e) {
    fail("assessor step", e);
  }

  // ---------- Step 3: org-admin ----------
  console.log("\n[3] org-admin@example.com");
  try {
    const sb = await signIn("org-admin@example.com");
    const { data: orgs, error: oErr } = await sb
      .from("organizations")
      .select("id, slug, name");
    if (oErr) throw oErr;
    const demo = orgs?.find((o) => o.slug === "demo");
    if (!demo) {
      fail(`org-admin organizations: Demo Org not visible (got ${orgs?.length ?? 0} rows)`);
    } else {
      pass(`org-admin sees Demo Org (id=${demo.id})`);
    }
    await sb.auth.signOut();
  } catch (e) {
    fail("org-admin step", e);
  }

  // ---------- Step 4: app-admin ----------
  console.log("\n[4] admin@example.com");
  let adminClient: SupabaseClient | null = null;
  try {
    const sb = await signIn("admin@example.com");
    adminClient = sb;

    const {
      data: { user },
    } = await sb.auth.getUser();
    const { data: profile, error: pErr } = await sb
      .from("profiles")
      .select("user_id, is_app_admin")
      .eq("user_id", user!.id)
      .single();
    if (pErr) throw pErr;
    if (!profile?.is_app_admin) {
      fail("admin profile.is_app_admin not true");
    } else {
      pass("admin profile.is_app_admin = true");
    }

    // app-admin should see *every* sessions row, including ones with NULL
    // tenant cols (e.g. unbackfilled). Compare against an unrestricted
    // service-role count.
    const { count: totalCount, error: tcErr } = await serviceClient
      .from("sessions")
      .select("*", { count: "exact", head: true });
    if (tcErr) throw tcErr;

    const { data: adminSessions, error: aErr } = await sb
      .from("sessions")
      .select("id");
    if (aErr) throw aErr;

    if ((adminSessions?.length ?? 0) !== (totalCount ?? 0)) {
      fail(
        `admin sees ${adminSessions?.length ?? 0} sessions; expected all ${totalCount}`,
      );
    } else {
      pass(`admin sees all ${adminSessions?.length} session(s)`);
    }
  } catch (e) {
    fail("admin step", e);
  }

  // ---------- Step 5: revocation cuts off the assessor ----------
  console.log("\n[5] revocation hides session from assessor");
  if (!assessorTargetSessionId || !adminClient) {
    fail("revocation step skipped (no target session or admin client)");
  } else {
    try {
      // Admin sets student_revoked=true on the session the assessor saw.
      const { error: upErr } = await adminClient
        .from("sessions")
        .update({ student_revoked: true })
        .eq("id", assessorTargetSessionId);
      if (upErr) throw upErr;
      pass(`admin set student_revoked=true on session ${assessorTargetSessionId}`);

      // Re-sign-in as assessor (fresh JWT) and try to SELECT that exact row.
      const sb = await signIn("assessor@example.com");
      const { data, error: sErr } = await sb
        .from("sessions")
        .select("id")
        .eq("id", assessorTargetSessionId);
      if (sErr) throw sErr;
      if ((data?.length ?? 0) === 0) {
        pass("assessor can no longer SELECT the revoked session");
      } else {
        fail(
          `assessor still sees revoked session (rows=${data?.length}). RLS leak.`,
        );
      }
      await sb.auth.signOut();
    } catch (e) {
      fail("revocation step", e);
    } finally {
      // Reset the flag so this script remains idempotent.
      const { error: resetErr } = await serviceClient
        .from("sessions")
        .update({ student_revoked: false })
        .eq("id", assessorTargetSessionId);
      if (resetErr) {
        console.warn(
          `WARN  could not reset student_revoked on ${assessorTargetSessionId}: ${resetErr.message}`,
        );
      } else {
        console.log(
          `      (cleanup) reset student_revoked=false on ${assessorTargetSessionId}`,
        );
      }
    }
  }

  if (adminClient) await adminClient.auth.signOut();

  console.log(
    `\n=== ${failures === 0 ? "ALL PASS" : `${failures} FAIL`} ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
