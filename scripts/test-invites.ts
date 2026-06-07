/**
 * Phase C seat-invite flow tests.
 *
 * Verifies the seat_invites RLS policies + the lib/billing/invites.ts
 * createInvite() helper end-to-end against a real Supabase project. Each
 * actual access check goes through the supabase-js anon-key client signed
 * in as the relevant user, so RLS is the thing under test.
 *
 *   1) org_admin (anon-key + signInWithPassword) INSERTs a seat_invites row
 *      (status='pending') against the demo org. Verify the row exists.
 *   2) Same org_admin tries to INSERT a seat_invite for a DIFFERENT org →
 *      RLS rejects (insert returns no rows / errors).
 *   3) Service-role flips invite.status='accepted' (auth-callback hook sim).
 *   4) lib/billing/invites.ts createInvite() is callable from a Node script.
 *      The lib uses supabaseAdmin() so it bypasses RLS by design.
 *   5) Cleanup: delete every test invite the script created.
 *
 * Usage:  npm run test:invites
 *
 * Notes:
 *   * lib files are marked `import "server-only"`. A noop shim at
 *     node_modules/server-only/index.js makes them importable from tsx.
 *   * The Supabase auth admin email send is best-effort inside createInvite()
 *     and swallows its own error, so we don't actually need to stub it.
 *     Test emails go to the project's dev inbox; we don't spam by reusing
 *     a single deterministic address.
 */
import { config as loadEnv } from "dotenv";
import Module from "node:module";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

loadEnv({ path: ".env.local" });
loadEnv();

// `lib/billing/invites.ts` is marked `import "server-only"`. Outside the
// Next build that package isn't installed; install a no-op resolver shim
// so tsx can import the lib for testing. Same pattern as test-stripe-webhook.ts.
{
  const stubPath = require("node:path").join(
    require("node:os").tmpdir(),
    "server-only-stub.js",
  );
  require("node:fs").writeFileSync(stubPath, "module.exports = {};");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const M = Module as any;
  const origResolve = M._resolveFilename;
  M._resolveFilename = function (
    request: string,
    ...rest: unknown[]
  ): string {
    if (request === "server-only") return stubPath;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return origResolve.call(this, request, ...(rest as any));
  };
}

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
  console.error(
    "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in env.",
  );
  process.exit(1);
}

const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = "DemoPass123!";
const RUN_TAG = randomBytes(4).toString("hex"); // unique per run, used in emails
const createdInviteIds: string[] = [];

const results: { n: number; desc: string; pass: boolean; detail: string }[] = [];
function record(n: number, desc: string, pass: boolean, detail = "") {
  results.push({ n, desc, pass, detail });
  console.log(`[CHECK ${n}] ${desc}: ${pass ? "PASS" : "FAIL"}${detail ? " — " + detail : ""}`);
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
  // ---- IDs we'll need ----
  const orgAdminId = await getUserId("org-admin@example.com");

  const { data: demoOrg } = await svc
    .from("organizations").select("id").eq("slug", "demo").single();
  const demoOrgId = demoOrg!.id as string;

  // Make sure a SECOND org exists so check #2 has somewhere to attempt to
  // write against. test-rls.ts already creates "test-org-alpha"; reuse it
  // if present, otherwise create.
  let { data: alphaOrg } = await svc
    .from("organizations").select("id").eq("slug", "test-org-alpha").single();
  if (!alphaOrg) {
    const { data, error } = await svc
      .from("organizations")
      .insert({ name: "Test Org Alpha", slug: "test-org-alpha", plan: "trial" })
      .select("id").single();
    if (error) throw error;
    alphaOrg = data;
  }
  const alphaOrgId = alphaOrg!.id as string;

  // ---- Sign in as org_admin (anon-key path the browser uses) ----
  const orgAdmin = await signInAs("org-admin@example.com");

  // ============================================================
  // 1) org_admin INSERTs a seat_invite row (status='pending') for own org.
  //    Policy seat_invites_insert: invited_by = auth.uid()
  //    AND is_org_member(org_id, 'org_admin') OR is_app_admin().
  // ============================================================
  const email1 = `invite-self-${RUN_TAG}@example.com`;
  const token1 = randomBytes(24).toString("base64url");
  let invite1Id: string | null = null;
  {
    const { data, error } = await orgAdmin
      .from("seat_invites")
      .insert({
        org_id: demoOrgId,
        invited_by: orgAdminId,
        email: email1,
        role: "assessor",
        token: token1,
        status: "pending",
      })
      .select("id, status")
      .single();
    invite1Id = data?.id ?? null;
    if (invite1Id) createdInviteIds.push(invite1Id);

    // Verify via service-role read (RLS-bypass) that the row really exists.
    const { data: check } = await svc
      .from("seat_invites").select("id, status, email")
      .eq("id", invite1Id ?? "00000000-0000-0000-0000-000000000000")
      .maybeSingle();

    const ok = !error
      && !!invite1Id
      && data?.status === "pending"
      && check?.id === invite1Id
      && check?.email === email1;
    record(1, "org_admin INSERT seat_invite (own org) → pending row exists",
      ok,
      `id=${invite1Id ?? "?"} status=${data?.status ?? "?"} err=${error?.message ?? ""}`);
  }

  // ============================================================
  // 2) Same org_admin attempts to INSERT a seat_invite for ALPHA org
  //    (where they are NOT a member). RLS WITH CHECK predicate must reject.
  // ============================================================
  {
    const email2 = `invite-cross-${RUN_TAG}@example.com`;
    const token2 = randomBytes(24).toString("base64url");
    const { data, error } = await orgAdmin
      .from("seat_invites")
      .insert({
        org_id: alphaOrgId,        // <-- different org
        invited_by: orgAdminId,
        email: email2,
        role: "assessor",
        token: token2,
        status: "pending",
      })
      .select("id");

    // Defensive: if the row somehow snuck in, capture its id for cleanup so
    // the failed assertion doesn't leak a row.
    if (data && data.length > 0) {
      for (const r of data) createdInviteIds.push(r.id as string);
    }
    const rejected = !!error || (data?.length ?? 0) === 0;
    record(2, "org_admin INSERT seat_invite for DIFFERENT org → rejected",
      rejected,
      `rows=${data?.length ?? "?"} err=${error?.message ?? ""}`);
  }

  // ============================================================
  // 3) Service-role flips invite.status to 'accepted'
  //    (simulating the /auth/callback hook in acceptInviteOnAuth()).
  // ============================================================
  {
    if (!invite1Id) {
      record(3, "service-role UPDATE invite to accepted", false, "no invite1Id");
    } else {
      const { data, error } = await svc
        .from("seat_invites")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", invite1Id)
        .select("id, status, accepted_at")
        .single();
      const ok = !error && data?.status === "accepted" && !!data?.accepted_at;
      record(3, "service-role UPDATE invite.status='accepted'",
        ok,
        `status=${data?.status ?? "?"} accepted_at=${data?.accepted_at ?? "?"} err=${error?.message ?? ""}`);
    }
  }

  // ============================================================
  // 4) lib/billing/invites.ts createInvite() is callable from a Node script.
  //    The helper internally uses supabaseAdmin() (service-role) and is
  //    idempotent: a second call with the same (org_id, email) returns the
  //    same pending row instead of inserting a duplicate.
  //
  //    We use a fresh test email per run so we don't collide with the
  //    accepted invite from check 1. Supabase auth.admin.inviteUserByEmail
  //    is called inside createInvite(); the lib wraps it in try/catch so
  //    SMTP failures don't fail the row insert. In a Supabase project with
  //    no SMTP configured, the call typically logs a warning and returns
  //    an error which the helper swallows. No spam.
  // ============================================================
  {
    // Dynamic import so the module-graph cost (and any side effects of
    // `import "server-only"` / Stripe lazy init) stays scoped to this check.
    const { createInvite } = await import("../lib/billing/invites");
    const email4 = `invite-lib-${RUN_TAG}@example.com`;
    try {
      const { invite } = await createInvite({
        orgId: demoOrgId,
        email: email4,
        role: "assessor",
        invitedByUserId: orgAdminId,
      });
      if (invite?.id) createdInviteIds.push(invite.id);

      // Idempotency: second call returns the same row.
      const { invite: invite2 } = await createInvite({
        orgId: demoOrgId,
        email: email4,
        role: "assessor",
        invitedByUserId: orgAdminId,
      });

      const ok = !!invite?.id
        && invite.status === "pending"
        && invite.email.toLowerCase() === email4.toLowerCase()
        && invite2?.id === invite.id;
      record(4, "lib/billing/invites.ts createInvite() callable + idempotent",
        ok,
        `id=${invite?.id ?? "?"} status=${invite?.status ?? "?"} idempotent=${invite2?.id === invite?.id}`);
    } catch (err) {
      record(4, "lib/billing/invites.ts createInvite() callable + idempotent",
        false, `threw: ${(err as Error).message}`);
    }
  }

  // ============================================================
  // 5) Cleanup: delete every invite this script created. Service-role
  //    bypasses RLS so a single batch delete suffices. We also wipe any
  //    leftover invites with our RUN_TAG in case a partial failure
  //    above left orphans not tracked in `createdInviteIds`.
  // ============================================================
  if (createdInviteIds.length > 0) {
    await svc.from("seat_invites").delete().in("id", createdInviteIds);
  }
  await svc.from("seat_invites").delete().ilike("email", `%${RUN_TAG}@example.com`);

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\nSummary: ${passed}/${results.length} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test harness error:", err);
  // Best-effort cleanup on hard failure too.
  if (createdInviteIds.length > 0) {
    void svc.from("seat_invites").delete().in("id", createdInviteIds).then(() => {
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});
