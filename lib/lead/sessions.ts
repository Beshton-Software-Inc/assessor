import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

export interface CreateLeadSessionInput {
  orgId: string;
  enduserId?: string | null;
  userAgent?: string | null;
}

/**
 * Anonymous lead flow: no assessor, possibly no enduser yet. Service-role
 * insert because the sessions_insert RLS policy requires assessor_id =
 * auth.uid(), which doesn't apply here. The caller has already been
 * authorized by a valid lead cookie.
 */
export async function createLeadSession(
  input: CreateLeadSessionInput,
): Promise<{ sessionId: string }> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("sessions")
    .insert({
      stage: "started",
      user_agent: input.userAgent ?? null,
      org_id: input.orgId,
      assessor_id: null,
      enduser_id: input.enduserId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`createLeadSession failed: ${error?.message ?? "unknown"}`);
  }
  return { sessionId: data.id as string };
}
