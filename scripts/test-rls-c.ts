/**
 * Phase C adversarial RLS bypass tests for billing tables:
 * plans, subscriptions, seat_invites, usage_events.
 *
 * Signs in as each demo role with the ANON key and tries to read/write rows
 * that the policies in 0005_billing.sql should reject. Uses the service-role
 * key for SETUP only.
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
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  if (!u) throw new Error(`user not found: ${email}`);
  return u.id;
}

async function main() {
  // ---- IDs ----
  const student1Id = await getUserId("student-1@example.com");
  const assessorId = await getUserId("assessor@example.com");
  const orgAdminId = await getUserId("org-admin@example.com");

  const { data: demoOrg } = await svc.from("organizations").select("id").eq("slug", "demo").single();
  const demoOrgId = demoOrg!.id as string;

  // Ensure a second org "test-org-alpha" exists, with its own org_admin.
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

  // Make sure demo org and alpha org both have a subscriptions row.
  await svc.from("subscriptions").upsert({
    org_id: demoOrgId, plan_code: "trial", status: "trialing", seat_quantity: 0,
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 14 * 86400_000).toISOString(),
  }, { onConflict: "org_id" });
  await svc.from("subscriptions").upsert({
    org_id: alphaOrgId, plan_code: "trial", status: "trialing", seat_quantity: 0,
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 14 * 86400_000).toISOString(),
  }, { onConflict: "org_id" });

  // Ensure demo session exists for student-1 (used in usage_event RPC tests).
  let demoSessionId: string;
  const { data: s1existing } = await svc
    .from("sessions").select("id").eq("enduser_id", student1Id).eq("org_id", demoOrgId).limit(1);
  if (s1existing && s1existing.length > 0) {
    demoSessionId = s1existing[0].id;
  } else {
    const { data: ins, error: insErr } = await svc.from("sessions")
      .insert({ org_id: demoOrgId, assessor_id: assessorId, enduser_id: student1Id, stage: "completed" })
      .select("id").single();
    if (insErr) throw insErr;
    demoSessionId = ins!.id;
  }

  // Ensure alpha session exists.
  let alphaSessionId: string;
  const { data: aExisting } = await svc.from("sessions").select("id").eq("org_id", alphaOrgId).limit(1);
  if (aExisting && aExisting.length > 0) {
    alphaSessionId = aExisting[0].id;
  } else {
    // Use orgAdminId as a placeholder enduser_id; works because the column is unconstrained re: role.
    const { data: ins, error: insErr } = await svc.from("sessions")
      .insert({ org_id: alphaOrgId, assessor_id: orgAdminId, enduser_id: orgAdminId, stage: "completed" })
      .select("id").single();
    if (insErr) throw insErr;
    alphaSessionId = ins!.id;
  }

  // Seed a couple of usage_events for demo org via service-role so org_admin
  // SELECT in attack 11 has rows to observe.
  await svc.from("usage_events").insert([
    { org_id: demoOrgId, kind: "session_started", target_session_id: demoSessionId, actor_user_id: assessorId },
    { org_id: demoOrgId, kind: "analysis_run",   target_session_id: demoSessionId, actor_user_id: assessorId },
  ]);

  // Wipe any pre-existing seat_invites we'll create so the test is deterministic.
  await svc.from("seat_invites").delete().in("org_id", [demoOrgId, alphaOrgId]).like("email", "phasec-%");

  // ---- Sign-in clients ----
  const s1 = await signInAs("student-1@example.com");
  const assessor = await signInAs("assessor@example.com");
  const orgAdmin = await signInAs("org-admin@example.com");
  const anon = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ATTACK 1: student-1 SELECT subscriptions of any org → 0 rows
  {
    const { data, error } = await s1.from("subscriptions").select("id");
    record(1, "student-1 SELECT subscriptions",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 2: assessor SELECT subscriptions of own org → 0 rows
  {
    const { data, error } = await assessor.from("subscriptions").select("id").eq("org_id", demoOrgId);
    record(2, "assessor SELECT own-org subscriptions",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 3: org_admin SELECT subscriptions of OTHER org → 0 rows
  {
    const { data, error } = await orgAdmin.from("subscriptions").select("id").eq("org_id", alphaOrgId);
    record(3, "org_admin SELECT cross-org subscriptions",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 4: org_admin SELECT subscriptions of own org → 1 row
  {
    const { data, error } = await orgAdmin.from("subscriptions").select("id").eq("org_id", demoOrgId);
    record(4, "org_admin SELECT own-org subscriptions (allowed)",
      !error && (data?.length ?? 0) === 1,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 5: org_admin INSERT into subscriptions → REJECTED
  {
    const { data, error } = await orgAdmin.from("subscriptions")
      .insert({ org_id: demoOrgId, plan_code: "pro", status: "active", seat_quantity: 999 })
      .select("id");
    record(5, "org_admin INSERT subscriptions (rejected)",
      !!error || (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 6: student-1 SELECT seat_invites → 0 rows (unless email matches)
  {
    const { data, error } = await s1.from("seat_invites").select("id");
    record(6, "student-1 SELECT seat_invites",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 7: assessor INSERT seat_invites → REJECTED
  {
    const token = "phasec-tok-assessor-" + Math.random().toString(36).slice(2, 10);
    const { data, error } = await assessor.from("seat_invites")
      .insert({
        org_id: demoOrgId, invited_by: assessorId,
        email: "phasec-victim@example.com", role: "assessor",
        token,
      })
      .select("id");
    record(7, "assessor INSERT seat_invites (rejected)",
      !!error || (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 8: org_admin INSERT seat_invite for OTHER org → REJECTED
  {
    const token = "phasec-tok-cross-" + Math.random().toString(36).slice(2, 10);
    const { data, error } = await orgAdmin.from("seat_invites")
      .insert({
        org_id: alphaOrgId, invited_by: orgAdminId,
        email: "phasec-cross@example.com", role: "assessor",
        token,
      })
      .select("id");
    record(8, "org_admin INSERT seat_invite for OTHER org (rejected)",
      !!error || (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 9: org_admin INSERT seat_invite for OWN org → ALLOWED
  {
    const token = "phasec-tok-own-" + Math.random().toString(36).slice(2, 10);
    const { data, error } = await orgAdmin.from("seat_invites")
      .insert({
        org_id: demoOrgId, invited_by: orgAdminId,
        email: "phasec-own@example.com", role: "assessor",
        token,
      })
      .select("id");
    record(9, "org_admin INSERT seat_invite for OWN org (allowed)",
      !error && (data?.length ?? 0) === 1,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 10: student-1 SELECT usage_events of any org → 0 rows
  {
    const { data, error } = await s1.from("usage_events").select("id");
    record(10, "student-1 SELECT usage_events",
      !error && (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 11: org_admin SELECT usage_events of OWN org → multiple rows
  {
    const { data, error } = await orgAdmin.from("usage_events").select("id").eq("org_id", demoOrgId);
    record(11, "org_admin SELECT own-org usage_events (allowed)",
      !error && (data?.length ?? 0) >= 2,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 12: Direct INSERT into usage_events from any user → REJECTED
  // Try as org_admin (the strongest non-admin role).
  {
    const { data, error } = await orgAdmin.from("usage_events")
      .insert({
        org_id: demoOrgId, kind: "analysis_run",
        target_session_id: demoSessionId, actor_user_id: orgAdminId,
      })
      .select("id");
    record(12, "org_admin direct INSERT usage_events (rejected)",
      !!error || (data?.length ?? 0) === 0,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ATTACK 13: rpc('log_usage_event') for a session in own org → succeeds
  {
    const before = await svc.from("usage_events").select("id", { count: "exact", head: true })
      .eq("org_id", demoOrgId).eq("kind", "analysis_run");
    const beforeCount = before.count ?? 0;
    const { error } = await assessor.rpc("log_usage_event", {
      p_kind: "analysis_run",
      p_target_session_id: demoSessionId,
      p_target_analysis_id: null,
      p_metadata: { src: "test-rls-c-13" },
    });
    const after = await svc.from("usage_events").select("id", { count: "exact", head: true })
      .eq("org_id", demoOrgId).eq("kind", "analysis_run");
    const afterCount = after.count ?? 0;
    record(13, "assessor rpc log_usage_event own-org (allowed)",
      !error && afterCount === beforeCount + 1,
      `before=${beforeCount} after=${afterCount} err=${error?.message ?? ""}`);
  }

  // ATTACK 14: rpc('log_usage_event') for a session in OTHER org → either
  // errors, or stamps actor and silently uses the session's real org_id.
  // The function we have looks up org_id from the session row, so it should
  // succeed but the row should belong to alphaOrgId, not demoOrgId.
  {
    const beforeAlpha = await svc.from("usage_events").select("id", { count: "exact", head: true })
      .eq("org_id", alphaOrgId);
    const beforeDemo = await svc.from("usage_events").select("id", { count: "exact", head: true })
      .eq("org_id", demoOrgId);
    const { error } = await assessor.rpc("log_usage_event", {
      p_kind: "analysis_run",
      p_target_session_id: alphaSessionId,
      p_target_analysis_id: null,
      p_metadata: { src: "test-rls-c-14-cross-org" },
    });
    const afterAlpha = await svc.from("usage_events").select("id", { count: "exact", head: true })
      .eq("org_id", alphaOrgId);
    const afterDemo = await svc.from("usage_events").select("id", { count: "exact", head: true })
      .eq("org_id", demoOrgId);

    // Acceptable outcomes:
    //  (a) RPC errored and no rows changed in either org, OR
    //  (b) RPC succeeded, alpha row count went up by 1, demo did NOT.
    const erroredAndNoLeak = !!error
      && (afterAlpha.count ?? 0) === (beforeAlpha.count ?? 0)
      && (afterDemo.count ?? 0) === (beforeDemo.count ?? 0);
    const succeededAndStampedAlpha = !error
      && (afterAlpha.count ?? 0) === (beforeAlpha.count ?? 0) + 1
      && (afterDemo.count ?? 0) === (beforeDemo.count ?? 0);

    // Verify actor stamp on the new row when path (b)
    let actorOk = true;
    if (succeededAndStampedAlpha) {
      const { data: latest } = await svc.from("usage_events")
        .select("actor_user_id, org_id, metadata")
        .eq("org_id", alphaOrgId)
        .order("created_at", { ascending: false })
        .limit(1);
      actorOk = !!latest && latest[0]?.actor_user_id === assessorId;
    }
    record(14, "assessor rpc log_usage_event cross-org (errors OR stamps real org)",
      erroredAndNoLeak || (succeededAndStampedAlpha && actorOk),
      `err=${error?.message ?? ""} alpha=${beforeAlpha.count}->${afterAlpha.count} demo=${beforeDemo.count}->${afterDemo.count}`);
  }

  // ATTACK 15: plans SELECT — both anon and authenticated read all rows.
  {
    const { data: anonRows, error: anonErr } = await anon.from("plans").select("code");
    const { data: authedRows, error: authedErr } = await s1.from("plans").select("code");
    const expectedCodes = ["trial", "starter", "pro"].sort();
    const anonCodes = (anonRows ?? []).map((r: { code: string }) => r.code).sort();
    const authedCodes = (authedRows ?? []).map((r: { code: string }) => r.code).sort();
    const anonOk = !anonErr && JSON.stringify(anonCodes) === JSON.stringify(expectedCodes);
    const authedOk = !authedErr && JSON.stringify(authedCodes) === JSON.stringify(expectedCodes);
    record(15, "plans SELECT public (anon + authenticated)",
      anonOk && authedOk,
      `anonRows=${anonRows?.length ?? "?"} authedRows=${authedRows?.length ?? "?"} anonErr=${anonErr?.message ?? ""} authedErr=${authedErr?.message ?? ""}`);
  }

  // ---- Cleanup ----
  await svc.from("seat_invites").delete().in("org_id", [demoOrgId, alphaOrgId]).like("email", "phasec-%");

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\nSummary: ${passed}/${results.length} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test harness error:", err);
  process.exit(1);
});
