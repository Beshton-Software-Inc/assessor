import { NextResponse } from "next/server";
import { runAnalysis } from "@/lib/analysis/analyze";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";

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
 * runAnalysis() then continues to use supabaseAdmin() internally because it
 * writes a PDF to Storage and inserts an analyses row that the
 * analyses_insert policy would also accept (server-side execution path).
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
    .select("id, assessor_id")
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
  const isAppAdmin = Boolean(user.profile?.is_app_admin);
  const isAssessorOnRow = (row as { assessor_id: string | null }).assessor_id === user.id;
  if (!isAppAdmin && !isAssessorOnRow) {
    return NextResponse.json(
      { error: "Forbidden: only the session's assessor or an admin may analyze" },
      { status: 403 },
    );
  }

  try {
    const { analysis } = await runAnalysis(supabaseAdmin(), id);
    return NextResponse.json({ analysis });
  } catch (err) {
    return NextResponse.json(
      { error: "Analysis failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
