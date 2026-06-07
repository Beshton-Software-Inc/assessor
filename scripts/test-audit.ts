/**
 * Audit-log RLS / SECURITY DEFINER tests.
 *
 * Verifies the contract from migration 0004_sharing_audit.sql:
 *   1. Direct INSERT into audit_log by an authenticated user is rejected by RLS.
 *   2. rpc('log_audit', ...) signed in as student-1 succeeds and writes a row
 *      whose actor_user_id == student-1.
 *   3. student-1 cannot SELECT that row (audit_log_select is app_admin-only).
 *   4. admin (app_admin) CAN SELECT it; actor_user_id matches student-1.
 *   5. Service-role client deletes the inserted test rows for cleanup.
 *
 * Exit 0 on full pass, 1 otherwise.
 */
import { config as loadEnv } from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
  console.error("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = "DemoPass123!";
const MARKER = `audit-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const results: { n: number; desc: string; pass: boolean; detail: string }[] = [];

function record(n: number, desc: string, pass: boolean, detail = "") {
  results.push({ n, desc, pass, detail });
  console.log(`[CHECK ${n}] ${desc}: ${pass ? "PASS" : "FAIL"}${detail ? " " + detail : ""}`);
}

async function signInAs(email: string): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signin ${email}: ${error.message}`);
  return c;
}

async function getUserId(email: string): Promise<string> {
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  if (!u) throw new Error(`user not found: ${email}`);
  return u.id;
}

async function main() {
  const student1Id = await getUserId("student-1@example.com");

  // Pick (or create) a session owned by student-1 to use as target_session_id.
  const { data: existingSession } = await svc
    .from("sessions").select("id").eq("enduser_id", student1Id).limit(1);
  let targetSessionId: string;
  if (existingSession && existingSession.length > 0) {
    targetSessionId = existingSession[0].id;
  } else {
    const { data: demoOrg } = await svc
      .from("organizations").select("id").eq("slug", "demo").single();
    const assessorId = await getUserId("assessor@example.com");
    const { data: ins, error: insErr } = await svc
      .from("sessions")
      .insert({
        org_id: demoOrg!.id,
        assessor_id: assessorId,
        enduser_id: student1Id,
        stage: "completed",
      })
      .select("id").single();
    if (insErr) throw insErr;
    targetSessionId = ins!.id;
  }

  const s1 = await signInAs("student-1@example.com");
  const adminClient = await signInAs("admin@example.com");

  // CHECK 1: direct INSERT into audit_log as authenticated → must be rejected.
  {
    const { data, error } = await s1.from("audit_log")
      .insert({
        actor_user_id: student1Id,
        action: "share_view",
        target_session_id: targetSessionId,
        metadata: { test: true, marker: MARKER, mode: "direct" },
      })
      .select("id");
    record(
      1,
      "student-1 direct INSERT into audit_log rejected",
      !!error || (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`,
    );
  }

  // CHECK 2: rpc('log_audit', ...) as student-1 succeeds.
  {
    const { error } = await s1.rpc("log_audit", {
      p_action: "share_view",
      p_target_session_id: targetSessionId,
      p_target_grant_id: null,
      p_metadata: { test: true, marker: MARKER },
    });
    record(2, "student-1 rpc('log_audit') succeeds",
      !error, `err=${error?.message ?? ""}`);
  }

  // Confirm via service role that the row landed and actor_user_id is correct.
  const { data: svcRows, error: svcErr } = await svc
    .from("audit_log")
    .select("id, actor_user_id, action, target_session_id, metadata")
    .eq("metadata->>marker", MARKER);
  if (svcErr) throw svcErr;
  const insertedRow = svcRows?.[0];
  record(
    2.1 as unknown as number,
    "row exists with actor_user_id = student-1",
    !!insertedRow
      && insertedRow.actor_user_id === student1Id
      && insertedRow.action === "share_view"
      && insertedRow.target_session_id === targetSessionId,
    `row=${JSON.stringify(insertedRow ?? null)}`,
  );

  // CHECK 3: student-1 cannot SELECT the row.
  {
    const { data, error } = await s1
      .from("audit_log")
      .select("id, actor_user_id, metadata")
      .eq("metadata->>marker", MARKER);
    record(
      3,
      "student-1 SELECT audit_log returns 0 rows",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`,
    );
  }

  // CHECK 4: admin (app_admin) CAN SELECT it, with correct actor_user_id.
  {
    const { data, error } = await adminClient
      .from("audit_log")
      .select("id, actor_user_id, action, target_session_id, metadata")
      .eq("metadata->>marker", MARKER);
    const row = data?.[0];
    record(
      4,
      "admin SELECT audit_log returns the row with correct actor",
      !error
        && (data?.length ?? 0) >= 1
        && row?.actor_user_id === student1Id
        && row?.action === "share_view"
        && row?.target_session_id === targetSessionId,
      `rows=${data?.length ?? "?"} actor=${row?.actor_user_id ?? "?"} err=${error?.message ?? ""}`,
    );
  }

  // CHECK 5: service-role DELETE cleanup.
  {
    const { data, error } = await svc
      .from("audit_log")
      .delete()
      .eq("metadata->>marker", MARKER)
      .select("id");
    record(
      5,
      "service-role DELETE cleans up test rows",
      !error && (data?.length ?? 0) >= 1,
      `deleted=${data?.length ?? "?"} err=${error?.message ?? ""}`,
    );
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\nSummary: ${passed}/${results.length} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test harness error:", err);
  process.exit(1);
});
