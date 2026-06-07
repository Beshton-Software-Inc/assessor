import { NextResponse } from "next/server";
import { runAnalysis } from "@/lib/analysis/analyze";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";
import { assertCanRunAnalysis, meterOverageIfNeeded } from "@/lib/billing/quota";
import { QuotaExceededError } from "@/lib/billing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // up to 10 minutes; Gemini video calls can be slow

/**
 * Triggers a Gemini video analysis for a recorded session.
 *
 * Auth: requires a signed-in user who is either the assessor on the session
 * row (RLS-visible AND assessor_id matches) or an app admin. We RLS-check
 * via supabaseServer() to fail fast with 403 before kicking off a 10-minute
 * Gemini job — the analyses_insert policy would also stop a bad caller, but
 * we don't want to spend Gemini quota to find out.
 *
 * Quota: phase C adds a billing gate. We resolve the session's org_id and
 * call the SQL helper org_can_run_analysis(). If it returns false (trial
 * exhausted, canceled, etc.) we return 402 with structured detail.
 *
 * runAnalysis() then continues to use supabaseAdmin() internally because it
 * writes a PDF to Storage and inserts an analyses row that the
 * analyses_insert policy would also accept (server-side execution path).
 *
 * After a successful analysis we log a usage_event ('analysis_run') and,
 * for paid plans in overage, post a Stripe meter event keyed on the
 * analysis id (idempotent against replays).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const serverSupa = await supabaseServer();
  const { data: row } = await serverSupa
    .from("sessions")
    .select("id, assessor_id, org_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { error: "Forbidden: session not visible" },
      { status: 403 },
    );
  }

  // Analyze is expensive — we don't want students triggering it. Gate to
  // the session's assessor or an app_admin.
  const sessionRow = row as {
    assessor_id: string | null;
    org_id: string | null;
  };
  const isAppAdmin = Boolean(user.profile?.is_app_admin);
  const isAssessorOnRow = sessionRow.assessor_id === user.id;
  if (!isAppAdmin && !isAssessorOnRow) {
    return NextResponse.json(
      { error: "Forbidden: only the session's assessor or an admin may analyze" },
      { status: 403 },
    );
  }

  // Quota gate (phase C). If the session has no org_id we permit it for
  // back-compat with phase A sessions; only orgs with a subscription row
  // get gated.
  const orgId = sessionRow.org_id;
  if (orgId) {
    try {
      await assertCanRunAnalysis(orgId);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          {
            error: "quota_exceeded",
            currentCount: err.currentCount,
            quota: err.quota,
            planCode: err.planCode,
            status: err.status,
          },
          { status: 402 },
        );
      }
      return NextResponse.json(
        { error: "quota_check_failed", detail: (err as Error).message },
        { status: 500 },
      );
    }
  }

  try {
    const { analysis } = await runAnalysis(supabaseAdmin(), id);

    // Log the usage event. This is best-effort; we don't fail the whole
    // request if the ledger insert errors (the analysis already succeeded
    // and the customer should not be punished for our metering bug).
    if (orgId) {
      const admin = supabaseAdmin();
      try {
        await admin.rpc("log_usage_event", {
          p_kind: "analysis_run",
          p_target_session_id: id,
          p_target_analysis_id: analysis.id,
          p_metadata: {},
        });
      } catch {
        // best-effort; the analysis already succeeded.
      }
      try {
        await meterOverageIfNeeded({ orgId, analysisId: analysis.id });
      } catch {
        // best-effort; meter events are idempotent and can be replayed.
      }
    }

    return NextResponse.json({ analysis });
  } catch (err) {
    return NextResponse.json(
      { error: "Analysis failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
