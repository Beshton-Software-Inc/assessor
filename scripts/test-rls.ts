/**
 * Adversarial RLS bypass tests.
 *
 * Signs in as each demo role with the ANON key and tries to read/write rows
 * that the policies in 0003_multi_tenant.sql should reject. Uses the
 * service-role key only for SETUP (creating revoked rows, second org).
 *
 * Exit 0 if every attack is rejected; 1 otherwise.
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
const results: { n: number; desc: string; pass: boolean; detail: string }[] = [];

function record(n: number, desc: string, pass: boolean, detail = "") {
  results.push({ n, desc, pass, detail });
  console.log(`[ATTACK ${n}] ${desc}: ${pass ? "PASS" : "FAIL"}${detail ? " " + detail : ""}`);
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
  // Service-role lookup. listUsers is paginated; demo set is tiny.
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  if (!u) throw new Error(`user not found: ${email}`);
  return u.id;
}

async function main() {
  // ---- IDs we'll need throughout ----
  const student1Id = await getUserId("student-1@example.com");
  const student2Id = await getUserId("student-2@example.com");
  const assessorId = await getUserId("assessor@example.com");
  const orgAdminId = await getUserId("org-admin@example.com");
  const adminId = await getUserId("admin@example.com");

  const { data: demoOrg } = await svc.from("organizations").select("id").eq("slug", "demo").single();
  const demoOrgId = demoOrg!.id as string;

  // ---- SETUP: ensure each student has at least one session row ----
  // student-1 already has backfilled sessions; ensure student-2 has one.
  const { data: s2existing } = await svc
    .from("sessions").select("id").eq("enduser_id", student2Id).limit(1);
  let student2SessionId: string;
  if (s2existing && s2existing.length > 0) {
    student2SessionId = s2existing[0].id;
  } else {
    const { data: ins, error: insErr } = await svc
      .from("sessions")
      .insert({ org_id: demoOrgId, assessor_id: assessorId, enduser_id: student2Id, stage: "completed" })
      .select("id").single();
    if (insErr) throw insErr;
    student2SessionId = ins!.id;
  }

  // student-1 session for revoke test
  const { data: s1existing } = await svc
    .from("sessions").select("id").eq("enduser_id", student1Id).limit(1);
  let student1SessionId: string;
  if (s1existing && s1existing.length > 0) {
    student1SessionId = s1existing[0].id;
  } else {
    const { data: ins, error: insErr } = await svc
      .from("sessions")
      .insert({ org_id: demoOrgId, assessor_id: assessorId, enduser_id: student1Id, stage: "completed" })
      .select("id").single();
    if (insErr) throw insErr;
    student1SessionId = ins!.id;
  }

  // SETUP: second org "Test Org Alpha" with its own assessor and one session.
  const alphaSlug = "test-org-alpha";
  let { data: alphaOrg } = await svc.from("organizations").select("id").eq("slug", alphaSlug).single();
  if (!alphaOrg) {
    const { data: created, error } = await svc
      .from("organizations").insert({ name: "Test Org Alpha", slug: alphaSlug, plan: "trial" })
      .select("id").single();
    if (error) throw error;
    alphaOrg = created;
  }
  const alphaOrgId = alphaOrg!.id as string;

  // Ensure an alpha-assessor user (use admin@example.com? no — create dedicated)
  const alphaEmail = "alpha-assessor@example.com";
  let alphaAssessorId: string;
  try {
    alphaAssessorId = await getUserId(alphaEmail);
  } catch {
    const { data: created, error } = await svc.auth.admin.createUser({
      email: alphaEmail, password: PASSWORD, email_confirm: true,
      user_metadata: { display_name: "Alpha Assessor" },
    });
    if (error) throw error;
    alphaAssessorId = created.user!.id;
  }
  await svc.from("org_members")
    .upsert({ org_id: alphaOrgId, user_id: alphaAssessorId, role: "assessor" }, { onConflict: "org_id,user_id" });

  // Ensure an alpha session exists
  const { data: alphaSess } = await svc.from("sessions").select("id").eq("org_id", alphaOrgId).limit(1);
  let alphaSessionId: string;
  if (alphaSess && alphaSess.length > 0) {
    alphaSessionId = alphaSess[0].id;
  } else {
    const { data: created, error } = await svc.from("sessions")
      .insert({ org_id: alphaOrgId, assessor_id: alphaAssessorId, enduser_id: alphaAssessorId, stage: "completed" })
      .select("id").single();
    if (error) throw error;
    alphaSessionId = created!.id;
  }

  // Ensure a revoked session exists (student-2's session, set student_revoked=true)
  await svc.from("sessions").update({ student_revoked: true }).eq("id", student2SessionId);

  // ---- Sign-in clients ----
  const s1 = await signInAs("student-1@example.com");
  const assessor = await signInAs("assessor@example.com");
  const orgAdmin = await signInAs("org-admin@example.com");

  // ATTACK 1: student-1 SELECT student-2's sessions → 0 rows
  {
    const { data, error } = await s1.from("sessions").select("id").eq("enduser_id", student2Id);
    record(1, "student-1 SELECT student-2 sessions",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 2: student-1 UPDATE student-2's sessions → 0 rows or error
  {
    const { data, error } = await s1.from("sessions")
      .update({ stage: "aborted" }).eq("enduser_id", student2Id).select("id");
    record(2, "student-1 UPDATE student-2 sessions",
      !!error || (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 3: student-1 INSERT sessions row with enduser_id=student-2 → reject
  {
    const { data, error } = await s1.from("sessions")
      .insert({ org_id: demoOrgId, assessor_id: student1Id, enduser_id: student2Id, stage: "started" })
      .select("id");
    record(3, "student-1 INSERT session as student-2",
      !!error || (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 4: assessor SELECT a session whose assessor_id is alpha-assessor → 0 rows
  {
    const { data, error } = await assessor.from("sessions").select("id").eq("id", alphaSessionId);
    record(4, "assessor SELECT alpha-org session",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 5: assessor SELECT a session that is revoked → 0 rows
  {
    const { data, error } = await assessor.from("sessions").select("id").eq("id", student2SessionId);
    record(5, "assessor SELECT revoked session",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 6: org_admin SELECT raw session rows → 0 rows
  {
    const { data, error } = await orgAdmin.from("sessions").select("id");
    record(6, "org_admin SELECT raw sessions",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 7: student-1 UPDATE student_revoked=true on student-2's session → 0 rows
  {
    const { data, error } = await s1.from("sessions")
      .update({ student_revoked: true }).eq("enduser_id", student2Id).select("id");
    record(7, "student-1 UPDATE revoke student-2 session",
      !!error || (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 8: student-1 INSERT into organizations → reject
  {
    const { data, error } = await s1.from("organizations")
      .insert({ name: "Hacker Org", slug: "hacker-" + Date.now(), plan: "trial" })
      .select("id");
    record(8, "student-1 INSERT organizations",
      !!error || (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 9: assessor INSERT org_members self-promote to org_admin → reject
  {
    const { data, error } = await assessor.from("org_members")
      .insert({ org_id: demoOrgId, user_id: assessorId, role: "org_admin" })
      .select("user_id");
    record(9, "assessor self-promote to org_admin",
      !!error || (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 10: cross-org leak — demo assessor cannot see Test Org Alpha sessions
  {
    const { data, error } = await assessor.from("sessions").select("id").eq("org_id", alphaOrgId);
    record(10, "demo assessor SELECT alpha-org sessions",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ---- Cleanup phase A: un-revoke student-2's session so re-runs are deterministic ----
  await svc.from("sessions").update({ student_revoked: false }).eq("id", student2SessionId);

  // =========================================================================
  // PHASE B: session_grants, audit_log, share-token semantics
  // =========================================================================

  console.log("\n--- Phase B attacks (session_grants / audit_log / share-tokens) ---");

  const s2 = await signInAs("student-2@example.com");
  const admin = await signInAs("admin@example.com");

  // Wipe any pre-existing test grants on the two student sessions so we have
  // a clean slate. Service-role bypasses RLS.
  await svc.from("session_grants").delete().in("session_id", [student1SessionId, student2SessionId]);

  // ATTACK 11: student-1 INSERT a grant on student-2's session → reject
  {
    const { data, error } = await s1.from("session_grants")
      .insert({
        session_id: student2SessionId,
        grantee_user_id: student1Id,
        granted_by_user_id: student1Id,
        scope: "analysis",
      })
      .select("id");
    record(11, "student-1 INSERT grant on student-2 session",
      !!error || (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // SETUP for ATTACK 12: a legitimate grant on student-1's session, granted
  // by student-1, with grantee=student-2.
  const { data: grantForS2 } = await svc.from("session_grants")
    .insert({
      session_id: student1SessionId,
      grantee_user_id: student2Id,
      granted_by_user_id: student1Id,
      scope: "analysis",
    })
    .select("id, revoked_at").single();
  const someoneElsesGrantId = grantForS2!.id as string;

  // ATTACK 12: student-1 (NOT the granter and NOT the enduser) attempts to
  // UPDATE a grant whose granted_by is student-2 on student-2's session.
  // We need a grant where student-1 is neither granter nor enduser. Build one
  // with service-role: granter=assessor, session=student-2's, grantee=assessor.
  const { data: foreignGrant } = await svc.from("session_grants")
    .insert({
      session_id: student2SessionId,
      grantee_user_id: assessorId,
      granted_by_user_id: assessorId,  // service-role bypasses INSERT policy
      scope: "analysis",
    })
    .select("id").single();
  const foreignGrantId = foreignGrant!.id as string;
  {
    const { data, error } = await s1.from("session_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", foreignGrantId)
      .select("id");
    record(12, "student-1 UPDATE someone else's grant",
      !!error || (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 13: student-1 SELECT audit_log → 0 rows
  {
    const { data, error } = await s1.from("audit_log").select("id");
    record(13, "student-1 SELECT audit_log",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 14: assessor SELECT audit_log → 0 rows
  {
    const { data, error } = await assessor.from("audit_log").select("id");
    record(14, "assessor SELECT audit_log",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 15: org_admin SELECT audit_log → 0 rows
  {
    const { data, error } = await orgAdmin.from("audit_log").select("id");
    record(15, "org_admin SELECT audit_log",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 16: app_admin CAN SELECT audit_log (no error, any row count is fine)
  {
    // Seed at least one audit row so we can prove read works
    await svc.rpc("log_audit", {
      p_action: "admin_session_read",
      p_target_session_id: student1SessionId,
      p_target_grant_id: null,
      p_metadata: { src: "test-rls" },
    });
    const { data, error } = await admin.from("audit_log").select("id").limit(5);
    record(16, "app_admin SELECT audit_log",
      !error && Array.isArray(data),
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 17: anon cannot SELECT a share-token grant or session row, but
  // resolve_share_token RPC succeeds with the right token.
  const shareToken = "shrtok_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  const { data: stGrant, error: stErr } = await svc.from("session_grants")
    .insert({
      session_id: student1SessionId,
      grantee_user_id: null,
      granted_by_user_id: adminId,
      scope: "analysis",
      share_token: shareToken,
      share_label: "test phase-b token",
    })
    .select("id, session_id, scope").single();
  if (stErr) throw stErr;
  const shareGrantId = stGrant!.id as string;

  const anon = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  {
    const { data: g, error: gErr } = await anon.from("session_grants")
      .select("id").eq("id", shareGrantId);
    const { data: s, error: sErr } = await anon.from("sessions")
      .select("id").eq("id", student1SessionId);
    const grantHidden = !gErr && (g?.length ?? 0) === 0;
    const sessionHidden = !sErr && (s?.length ?? 0) === 0;

    const { data: rpc, error: rpcErr } = await anon.rpc("resolve_share_token", { p_token: shareToken });
    // PostgREST returns the table-returning function as an array of rows
    const row = Array.isArray(rpc) ? rpc[0] : rpc;
    const rpcOk = !rpcErr && !!row && row.session_id === student1SessionId && row.scope === "analysis";

    record(17, "anon: hidden table rows but resolve_share_token works",
      grantHidden && sessionHidden && rpcOk,
      `grantHidden=${grantHidden} sessionHidden=${sessionHidden} rpcOk=${rpcOk} rpcErr=${rpcErr?.message ?? ""}`);
  }

  // ATTACK 18: EXPIRED share_token grant → student-2 (no relation to session)
  // cannot SELECT the underlying session.
  //
  // Wipe any prior grants on this (session, grantee) pair so the only thing
  // backing the SELECT decision is the expired grant we are about to insert.
  // Earlier setup (ATTACK 12, ATTACK 17) leaves valid grants in place that
  // would mask an expired-grant regression here.
  await svc
    .from("session_grants")
    .delete()
    .eq("session_id", student1SessionId)
    .eq("grantee_user_id", student2Id);
  const expiredToken = "shrtok_exp_" + Math.random().toString(36).slice(2, 10);
  await svc.from("session_grants").insert({
    session_id: student1SessionId,
    grantee_user_id: student2Id,
    granted_by_user_id: adminId,
    scope: "analysis",
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    share_token: expiredToken,
  });
  {
    const { data, error } = await s2.from("sessions").select("id").eq("id", student1SessionId);
    record(18, "student-2 SELECT session via EXPIRED grant",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 19: REVOKED share_token grant → student-2 still cannot SELECT.
  // Wipe again so the only backing grant is the revoked one we insert.
  await svc
    .from("session_grants")
    .delete()
    .eq("session_id", student1SessionId)
    .eq("grantee_user_id", student2Id);
  const revokedToken = "shrtok_rev_" + Math.random().toString(36).slice(2, 10);
  await svc.from("session_grants").insert({
    session_id: student1SessionId,
    grantee_user_id: student2Id,
    granted_by_user_id: adminId,
    scope: "analysis",
    revoked_at: new Date().toISOString(),
    share_token: revokedToken,
  });
  {
    const { data, error } = await s2.from("sessions").select("id").eq("id", student1SessionId);
    record(19, "student-2 SELECT session via REVOKED grant",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 20: VALID 'analysis' grant → student-2 CAN SELECT session and
  // analyses but cannot UPDATE. We also need an analyses row to test against.
  await svc
    .from("session_grants")
    .delete()
    .eq("session_id", student1SessionId)
    .eq("grantee_user_id", student2Id);
  const validToken = "shrtok_ok_" + Math.random().toString(36).slice(2, 10);
  await svc.from("session_grants").insert({
    session_id: student1SessionId,
    grantee_user_id: student2Id,
    granted_by_user_id: adminId,
    scope: "analysis",
    share_token: validToken,
  });
  // Ensure an analyses row exists for student1SessionId
  const { data: existingA } = await svc.from("analyses")
    .select("id").eq("session_id", student1SessionId).limit(1);
  if (!existingA || existingA.length === 0) {
    await svc.from("analyses").insert({
      session_id: student1SessionId,
      status: "completed",
      summary_md: "phase-b test analysis",
      result: {},
    });
  }
  {
    const { data: sRows, error: sErr2 } = await s2.from("sessions")
      .select("id").eq("id", student1SessionId);
    const { data: aRows, error: aErr } = await s2.from("analyses")
      .select("id").eq("session_id", student1SessionId);
    const { data: upd, error: updErr } = await s2.from("sessions")
      .update({ stage: "aborted" }).eq("id", student1SessionId).select("id");

    const canRead = !sErr2 && (sRows?.length ?? 0) === 1
                  && !aErr && (aRows?.length ?? 0) >= 1;
    const cannotWrite = !!updErr || (upd?.length ?? 0) === 0;

    record(20, "valid 'analysis' grant: SELECT yes, UPDATE no",
      canRead && cannotWrite,
      `sRows=${sRows?.length ?? "?"} aRows=${aRows?.length ?? "?"} updRows=${upd?.length ?? "?"} updErr=${updErr?.message ?? ""}`);
  }

  // ---- Cleanup: remove all test grants on the two sessions ----
  await svc.from("session_grants").delete().in("session_id", [student1SessionId, student2SessionId]);

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\nSummary: ${passed}/${results.length} passed, ${failed} failed.`);
  // Suppress unused vars warning for IDs only used in setup
  void orgAdminId; void someoneElsesGrantId;
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test harness error:", err);
  process.exit(1);
});
