import "server-only";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";
import { getActiveLeadRun } from "./run";

export type SessionAccessResult =
  | { ok: true; via: "user" | "lead"; userId?: string; leadRunId?: string }
  | { ok: false; status: 401 | 403; reason: string };

/**
 * Authorize a request to act on a session row. Two paths:
 *   1. Authenticated user with RLS visibility (existing assessor / enduser flow).
 *   2. Anonymous lead-flow caller whose lead-cookie matches a lead_run row
 *      that owns this session (presentation_session_id or qa_session_id).
 *
 * Returning a precise reason lets the route emit the right status code while
 * keeping the gate logic in one place.
 */
export async function authorizeSessionAccess(
  sessionId: string,
): Promise<SessionAccessResult> {
  const user = await getUser();
  if (user) {
    const supa = await supabaseServer();
    const { data } = await supa
      .from("sessions")
      .select("id")
      .eq("id", sessionId)
      .maybeSingle();
    if (data) return { ok: true, via: "user", userId: user.id };
  }

  const lead = await getActiveLeadRun();
  if (lead) {
    if (
      lead.presentation_session_id === sessionId ||
      lead.qa_session_id === sessionId
    ) {
      return { ok: true, via: "lead", leadRunId: lead.id };
    }
    return { ok: false, status: 403, reason: "Session not in lead run" };
  }

  if (!user) return { ok: false, status: 401, reason: "Unauthorized" };
  return { ok: false, status: 403, reason: "Session not visible" };
}

/**
 * Service-role update bridge. Used by the lead-authorized path because
 * lead callers don't have an RLS-capable JWT. The auth decision was already
 * made in authorizeSessionAccess, so this is safe.
 */
export function adminSessionUpdate() {
  return supabaseAdmin().from("sessions");
}
