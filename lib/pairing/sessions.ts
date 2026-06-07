import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

export interface StartSessionInput {
  assessorUserId: string;
  enduserUserId: string;
  orgId: string;
  userAgent?: string | null;
}

export interface StartSessionResult {
  sessionId: string;
}

/**
 * Pre-creates a session row (stage='started') with the proper enduser_id,
 * for the canonical Phase B assessor-initiated interview flow. Validates
 * that the assessor and the chosen enduser are both members of `orgId`
 * before inserting; refuses cross-org pairing.
 *
 * Uses the service-role admin client deliberately: the existing
 * sessions_insert RLS policy requires assessor_id = auth.uid(), but we
 * also need to set enduser_id != caller's id, which the policy permits
 * but we want the membership cross-check to live in JS so the error
 * messages are precise and we can audit the pairing.
 */
export async function startSession(
  input: StartSessionInput,
): Promise<StartSessionResult> {
  const admin = supabaseAdmin();

  const [{ data: assessorRow }, { data: enduserRow }] = await Promise.all([
    admin
      .from("org_members")
      .select("role")
      .eq("org_id", input.orgId)
      .eq("user_id", input.assessorUserId)
      .eq("role", "assessor")
      .maybeSingle(),
    admin
      .from("org_members")
      .select("role")
      .eq("org_id", input.orgId)
      .eq("user_id", input.enduserUserId)
      .eq("role", "enduser")
      .maybeSingle(),
  ]);

  if (!assessorRow) {
    throw new Error("startSession: caller is not an assessor of orgId");
  }
  if (!enduserRow) {
    throw new Error("startSession: enduser is not a member of orgId");
  }

  const { data, error } = await admin
    .from("sessions")
    .insert({
      stage: "started",
      user_agent: input.userAgent ?? null,
      org_id: input.orgId,
      assessor_id: input.assessorUserId,
      enduser_id: input.enduserUserId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`startSession insert failed: ${error?.message ?? "unknown"}`);
  }
  return { sessionId: data.id as string };
}
