import { NextResponse } from "next/server";
import {
  getActiveLeadRun,
  getLeadOrgId,
  updateLeadRun,
} from "@/lib/lead/run";
import { createLeadSession } from "@/lib/lead/sessions";
import type { LeadSessionResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/lead/runs/:id/presentation
 *
 * Mints (or returns) the sessions row used for the page-4 one-way
 * presentation recording. Idempotent — calling twice returns the same id.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const lead = await getActiveLeadRun();
  if (!lead) {
    return NextResponse.json({ error: "No active lead run" }, { status: 401 });
  }
  const { id } = await params;
  if (id !== lead.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (lead.presentation_session_id) {
    return NextResponse.json<LeadSessionResponse>({
      sessionId: lead.presentation_session_id,
    });
  }

  const orgId = await getLeadOrgId();
  const userAgent = req.headers.get("user-agent");
  const { sessionId } = await createLeadSession({ orgId, userAgent });
  await updateLeadRun(lead.id, { presentationSessionId: sessionId });
  return NextResponse.json<LeadSessionResponse>({ sessionId });
}
