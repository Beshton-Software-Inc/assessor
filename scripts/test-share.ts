/**
 * Phase B share-link flow tests (API layer, no browser).
 *
 * Exercises the session_grants table + resolve_share_token RPC across the
 * three actor surfaces:
 *   - student-1 (granter / session enduser)
 *   - student-2 (per-user grantee)
 *   - anon  (share-token resolver)
 *
 * Service-role client is used ONLY for setup (creating an analyses row,
 * cleaning up grants between checks). Every actual access check goes through
 * the supabase-js anon-key client signed in as the relevant user, so RLS is
 * the thing under test.
 *
 * Exit 0 if every check passes; 1 otherwise.
 */
import { config as loadEnv } from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

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
  console.log(`[CHECK ${n}] ${desc}: ${pass ? "PASS" : "FAIL"}${detail ? " — " + detail : ""}`);
}

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signInAs(email: string): Promise<SupabaseClient> {
  const c = anonClient();
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

async function ensureSessionFor(orgId: string, assessorId: string, enduserId: string): Promise<string> {
  const { data: existing } = await svc
    .from("sessions").select("id").eq("enduser_id", enduserId).limit(1);
  if (existing && existing.length > 0) return existing[0].id as string;
  const { data, error } = await svc
    .from("sessions")
    .insert({ org_id: orgId, assessor_id: assessorId, enduser_id: enduserId, stage: "completed" })
    .select("id").single();
  if (error) throw error;
  return data!.id as string;
}

async function ensureAnalysisFor(sessionId: string): Promise<string> {
  const { data: existing } = await svc
    .from("analyses").select("id").eq("session_id", sessionId).limit(1);
  if (existing && existing.length > 0) return existing[0].id as string;
  const { data, error } = await svc.from("analyses").insert({
    session_id: sessionId,
    model: "test-model",
    prompt_hash: "test-hash",
    result: { test: true },
    status: "ok",
  }).select("id").single();
  if (error) throw error;
  return data!.id as string;
}

async function deleteGrantsFor(sessionId: string) {
  await svc.from("session_grants").delete().eq("session_id", sessionId);
}

async function main() {
  // ---- Bootstrap IDs and rows ----
  const student1Id = await getUserId("student-1@example.com");
  const student2Id = await getUserId("student-2@example.com");
  const assessorId = await getUserId("assessor@example.com");

  const { data: demoOrg } = await svc.from("organizations").select("id").eq("slug", "demo").single();
  const demoOrgId = demoOrg!.id as string;

  // student-1 owns this session (enduser_id = student-1)
  const sessionId = await ensureSessionFor(demoOrgId, assessorId, student1Id);
  // ensure there is an analysis on that session for check 8
  await ensureAnalysisFor(sessionId);

  // ensure student-2 has a separate session row so demo signins/etc work — we
  // don't actually use it here, but the user must exist in auth.users.
  void student2Id;

  // Clean any leftover grants from prior runs so checks are deterministic.
  await deleteGrantsFor(sessionId);

  // ---- Sign in clients ----
  const s1 = await signInAs("student-1@example.com");

  // ============================================================
  // 1) student-1 INSERTs a per-user grant for student-2 (scope=analysis).
  //    Tests the session_grants_insert WITH CHECK clause: granted_by=auth.uid()
  //    AND caller is the session enduser.
  // ============================================================
  let perUserGrantId: string | null = null;
  {
    const { data, error } = await s1
      .from("session_grants")
      .insert({
        session_id: sessionId,
        grantee_user_id: student2Id,
        granted_by_user_id: student1Id,
        scope: "analysis",
      })
      .select("id")
      .single();
    perUserGrantId = data?.id ?? null;
    record(1, "student-1 INSERT per-user grant for student-2",
      !error && !!perUserGrantId,
      `id=${perUserGrantId ?? "?"} err=${error?.message ?? ""}`);
  }

  // ============================================================
  // 2) student-2 (fresh signin) can SELECT the underlying sessions row,
  //    proving has_session_access() resolves grantee_user_id = auth.uid().
  // ============================================================
  {
    const s2 = await signInAs("student-2@example.com");
    const { data, error } = await s2.from("sessions").select("id").eq("id", sessionId);
    record(2, "student-2 SELECT session via per-user grant",
      !error && (data?.length ?? 0) === 1,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ============================================================
  // 3) student-1 revokes by UPDATE revoked_at = now(); student-2 can no
  //    longer SELECT the session.
  // ============================================================
  {
    const { data: upd, error: updErr } = await s1
      .from("session_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", perUserGrantId!)
      .select("id");
    const revokedOk = !updErr && (upd?.length ?? 0) === 1;

    const s2 = await signInAs("student-2@example.com");
    const { data, error } = await s2.from("sessions").select("id").eq("id", sessionId);
    const blocked = !error && (data?.length ?? 0) === 0;

    record(3, "student-1 revoke → student-2 can no longer SELECT session",
      revokedOk && blocked,
      `revokedOk=${revokedOk} blockedRows=${data?.length ?? "?"} err=${error?.message ?? ""} updErr=${updErr?.message ?? ""}`);
  }

  // ============================================================
  // 4) student-1 INSERTs a share_token grant (grantee_user_id NULL).
  // ============================================================
  const shareToken = randomBytes(24).toString("base64url");
  let shareGrantId: string | null = null;
  {
    const { data, error } = await s1
      .from("session_grants")
      .insert({
        session_id: sessionId,
        grantee_user_id: null,
        granted_by_user_id: student1Id,
        scope: "analysis",
        share_token: shareToken,
        share_label: "test-share",
      })
      .select("id")
      .single();
    shareGrantId = data?.id ?? null;
    record(4, "student-1 INSERT share_token grant",
      !error && !!shareGrantId,
      `id=${shareGrantId ?? "?"} err=${error?.message ?? ""}`);
  }

  // ============================================================
  // 5) Anon client (no signInWithPassword) calls resolve_share_token and
  //    gets back session_id + scope. RPC is SECURITY DEFINER so anon role
  //    has execute (granted in migration 0004).
  // ============================================================
  {
    const anon = anonClient();
    const { data, error } = await anon.rpc("resolve_share_token", { p_token: shareToken });
    const row = Array.isArray(data) ? data[0] : data;
    const ok = !error && row?.session_id === sessionId && row?.scope === "analysis";
    record(5, "anon resolve_share_token returns (session_id, scope)",
      ok, `data=${JSON.stringify(data)} err=${error?.message ?? ""}`);
  }

  // ============================================================
  // 6) student-2 (fresh signin) — even with the share_token grant existing
  //    in the DB — CANNOT SELECT the session via RLS, because
  //    has_session_access() requires grantee_user_id = auth.uid() and the
  //    share-token grant has grantee_user_id = NULL. The /share/[token]
  //    flow is server-side via supabaseAdmin() after RPC resolution.
  // ============================================================
  {
    const s2 = await signInAs("student-2@example.com");
    const { data, error } = await s2.from("sessions").select("id").eq("id", sessionId);
    const blocked = !error && (data?.length ?? 0) === 0;
    record(6, "share_token grant does NOT auto-grant RLS access to arbitrary user",
      blocked,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ============================================================
  // 7) Mark the share_token grant expired; resolve_share_token errors / no rows.
  //    The RPC raises 'invalid_share_token' (P0001) when no active row matches.
  // ============================================================
  {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { error: updErr } = await svc
      .from("session_grants")
      .update({ expires_at: past })
      .eq("id", shareGrantId!);

    const anon = anonClient();
    const { data, error } = await anon.rpc("resolve_share_token", { p_token: shareToken });
    const row = Array.isArray(data) ? data[0] : data;
    // We accept either: (a) error returned, or (b) no rows.
    const rejected = !!error || !row;
    record(7, "expired share_token cannot be resolved",
      !updErr && rejected,
      `updErr=${updErr?.message ?? ""} err=${error?.message ?? ""} data=${JSON.stringify(data)}`);
  }

  // ============================================================
  // 8) student-1 creates a per-user 'full' scope grant for student-2;
  //    student-2 can SELECT the analyses row (RLS on analyses joins
  //    through sessions and calls has_session_access()).
  // ============================================================
  {
    // Clean previous grants on this session for a clean slate.
    await deleteGrantsFor(sessionId);

    const { data: ins, error: insErr } = await s1
      .from("session_grants")
      .insert({
        session_id: sessionId,
        grantee_user_id: student2Id,
        granted_by_user_id: student1Id,
        scope: "full",
      })
      .select("id")
      .single();

    const s2 = await signInAs("student-2@example.com");
    const { data, error } = await s2
      .from("analyses").select("id, session_id").eq("session_id", sessionId);
    const ok = !insErr && !error && (data?.length ?? 0) >= 1;
    record(8, "student-2 SELECT analyses via 'full' per-user grant",
      ok,
      `grantId=${ins?.id ?? "?"} rows=${data?.length ?? "?"} err=${error?.message ?? ""} insErr=${insErr?.message ?? ""}`);
  }

  // ---- Cleanup grants so reruns are deterministic ----
  await deleteGrantsFor(sessionId);

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\nSummary: ${passed}/${results.length} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test harness error:", err);
  process.exit(1);
});
