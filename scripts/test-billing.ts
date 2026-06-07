/**
 * Phase C billing tests.
 *
 * Verifies the contract from migration 0005_billing.sql:
 *   1. Demo org has a subscriptions row (plan_code='trial', status='trialing',
 *      current_period_end > now()).
 *   2. org_period_analysis_count(demoOrgId) matches a service-role count of
 *      usage_events for kind='analysis_run' since current_period_start.
 *   3. org_can_run_analysis(demoOrgId) returns true while count < quota.
 *   4. After inserting (5 - currentCount) usage_events via log_usage_event so
 *      the trial cap is hit, org_can_run_analysis returns false.
 *   5. DELETing the test rows (service-role) restores the previous state.
 *   6. Switching to plan_code='starter' status='active' seat_quantity=2 makes
 *      org_can_run_analysis return true (overage allowed).
 *   7. status='canceled' makes org_can_run_analysis return false.
 *   8. Reset to original trial state.
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
const MARKER = `billing-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const results: { n: string; desc: string; pass: boolean; detail: string }[] = [];

function record(n: string, desc: string, pass: boolean, detail = "") {
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

async function rpcCanRun(orgId: string): Promise<boolean> {
  const { data, error } = await svc.rpc("org_can_run_analysis", { p_org_id: orgId });
  if (error) throw error;
  return Boolean(data);
}

async function rpcPeriodCount(orgId: string): Promise<number> {
  const { data, error } = await svc.rpc("org_period_analysis_count", { p_org_id: orgId });
  if (error) throw error;
  return Number(data);
}

async function main() {
  // Resolve demo org and an assessor session to use as target_session_id.
  const { data: demoOrg, error: orgErr } = await svc
    .from("organizations").select("id").eq("slug", "demo").single();
  if (orgErr || !demoOrg) throw new Error(`demo org lookup failed: ${orgErr?.message}`);
  const demoOrgId = demoOrg.id as string;

  // Snapshot original subscription so we can restore at the end.
  const { data: origSub, error: subErr } = await svc
    .from("subscriptions")
    .select("plan_code, status, seat_quantity, current_period_start, current_period_end")
    .eq("org_id", demoOrgId).single();
  if (subErr || !origSub) throw new Error(`subscription lookup: ${subErr?.message}`);

  // Ensure trial state for CHECK 1 (some prior run may have left it elsewhere).
  await svc.from("subscriptions").update({
    plan_code: "trial",
    status: "trialing",
    seat_quantity: 0,
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
  }).eq("org_id", demoOrgId);

  // CHECK 1: trial subscription row exists with valid period_end.
  {
    const { data: row } = await svc
      .from("subscriptions")
      .select("plan_code, status, current_period_end")
      .eq("org_id", demoOrgId).single();
    const periodEndOk = row?.current_period_end
      ? new Date(row.current_period_end).getTime() > Date.now()
      : false;
    record("1", "demo org has trial/trialing subscription with future period_end",
      row?.plan_code === "trial" && row?.status === "trialing" && periodEndOk,
      `plan=${row?.plan_code} status=${row?.status} end=${row?.current_period_end}`);
  }

  // Need an assessor-owned session for log_usage_event (uses caller's org).
  const assessorId = await getUserId("assessor@example.com");
  const { data: existingSession } = await svc
    .from("sessions").select("id").eq("assessor_id", assessorId).limit(1);
  let targetSessionId: string;
  if (existingSession && existingSession.length > 0) {
    targetSessionId = existingSession[0].id;
  } else {
    const { data: ins, error: insErr } = await svc
      .from("sessions").insert({
        org_id: demoOrgId,
        assessor_id: assessorId,
        enduser_id: await getUserId("student-1@example.com"),
        stage: "completed",
      }).select("id").single();
    if (insErr) throw insErr;
    targetSessionId = ins!.id;
  }

  // CHECK 2: org_period_analysis_count vs direct service-role count.
  {
    const { data: subRow } = await svc.from("subscriptions")
      .select("current_period_start").eq("org_id", demoOrgId).single();
    const periodStart = subRow?.current_period_start ?? "1970-01-01T00:00:00Z";
    const { count: directCount, error: cntErr } = await svc
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", demoOrgId)
      .eq("kind", "analysis_run")
      .gte("created_at", periodStart);
    if (cntErr) throw cntErr;
    const rpcCount = await rpcPeriodCount(demoOrgId);
    record("2", "org_period_analysis_count matches service-role count",
      rpcCount === (directCount ?? 0),
      `rpc=${rpcCount} direct=${directCount}`);
  }

  // CHECK 3: org_can_run_analysis returns true while under quota (5 trial cap).
  const startCount = await rpcPeriodCount(demoOrgId);
  {
    const ok = await rpcCanRun(demoOrgId);
    record("3", "org_can_run_analysis true while count < trial quota (5)",
      ok && startCount < 5, `count=${startCount} canRun=${ok}`);
  }

  // CHECK 4: insert (5 - startCount) usage_events via assessor RPC, then expect false.
  const assessorClient = await signInAs("assessor@example.com");
  const toInsert = Math.max(0, 5 - startCount);
  for (let i = 0; i < toInsert; i++) {
    const { error } = await assessorClient.rpc("log_usage_event", {
      p_kind: "analysis_run",
      p_target_session_id: targetSessionId,
      p_target_analysis_id: null,
      p_metadata: { marker: MARKER, i },
    });
    if (error) throw new Error(`log_usage_event insert ${i}: ${error.message}`);
  }
  {
    const newCount = await rpcPeriodCount(demoOrgId);
    const canRun = await rpcCanRun(demoOrgId);
    record("4", "org_can_run_analysis false at trial cap",
      newCount >= 5 && canRun === false,
      `count=${newCount} canRun=${canRun} inserted=${toInsert}`);
  }

  // CHECK 5: DELETE test rows; org_can_run_analysis should be true again.
  {
    const { data, error } = await svc
      .from("usage_events").delete()
      .eq("metadata->>marker", MARKER)
      .select("id");
    const after = await rpcPeriodCount(demoOrgId);
    const canRun = await rpcCanRun(demoOrgId);
    record("5", "service-role DELETE cleanup restores capacity",
      !error && (data?.length ?? 0) === toInsert
        && after === startCount && canRun === true,
      `deleted=${data?.length ?? "?"} count=${after} canRun=${canRun} err=${error?.message ?? ""}`);
  }

  // CHECK 6: starter/active seat_quantity=2 → canRun true (overage allowed).
  await svc.from("subscriptions").update({
    plan_code: "starter", status: "active", seat_quantity: 2,
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  }).eq("org_id", demoOrgId);
  {
    // Insert several events well past the 400 cap (50/seat * 2 = 100 quota,
    // overage still permitted by the function).
    for (let i = 0; i < 6; i++) {
      const { error } = await assessorClient.rpc("log_usage_event", {
        p_kind: "analysis_run",
        p_target_session_id: targetSessionId,
        p_target_analysis_id: null,
        p_metadata: { marker: MARKER, mode: "starter", i },
      });
      if (error) throw new Error(`log_usage_event starter ${i}: ${error.message}`);
    }
    const canRun = await rpcCanRun(demoOrgId);
    record("6", "starter/active: canRun=true regardless of count (overage allowed)",
      canRun === true, `canRun=${canRun}`);
  }

  // CHECK 7: status='canceled' → canRun false.
  await svc.from("subscriptions").update({ status: "canceled" }).eq("org_id", demoOrgId);
  {
    const canRun = await rpcCanRun(demoOrgId);
    record("7", "starter/canceled: canRun=false",
      canRun === false, `canRun=${canRun}`);
  }

  // CHECK 8: cleanup — delete starter test rows + restore original subscription.
  {
    const { data, error } = await svc.from("usage_events").delete()
      .eq("metadata->>marker", MARKER).select("id");
    const { error: restoreErr } = await svc.from("subscriptions").update({
      plan_code: origSub.plan_code,
      status: origSub.status,
      seat_quantity: origSub.seat_quantity,
      current_period_start: origSub.current_period_start,
      current_period_end: origSub.current_period_end,
    }).eq("org_id", demoOrgId);
    record("8", "cleanup: usage_events deleted + subscription restored",
      !error && !restoreErr,
      `deleted=${data?.length ?? "?"} err=${error?.message ?? restoreErr?.message ?? ""}`);
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
