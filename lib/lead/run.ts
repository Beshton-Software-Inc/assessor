import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { LeadRunRow, LeadRunPublic } from "@/lib/types";
import {
  readLeadCookie,
  writeLeadCookie,
  type LeadCookieValue,
} from "./cookie";

const LEAD_ORG_SLUG = process.env.LEAD_ORG_SLUG ?? "demo";
let cachedLeadOrgId: string | null = null;

export async function getLeadOrgId(): Promise<string> {
  if (cachedLeadOrgId) return cachedLeadOrgId;
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", LEAD_ORG_SLUG)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `getLeadOrgId: organization with slug "${LEAD_ORG_SLUG}" not found. ` +
        `Set LEAD_ORG_SLUG or seed the org.`,
    );
  }
  cachedLeadOrgId = data.id as string;
  return cachedLeadOrgId;
}

export async function createLeadRun(): Promise<{
  row: LeadRunRow;
  cookie: LeadCookieValue;
}> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("lead_runs")
    .insert({})
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`createLeadRun failed: ${error?.message ?? "unknown"}`);
  }
  const row = data as LeadRunRow & { cookie_token: string };
  const cookie: LeadCookieValue = { id: row.id, token: row.cookie_token };
  await writeLeadCookie(cookie);
  return { row, cookie };
}

/**
 * Verify the caller's lead cookie matches a row and return it. The cookie
 * carries (id, token); we require both to match the row's cookie_token —
 * a stolen id alone is not enough.
 */
export async function getActiveLeadRun(): Promise<LeadRunRow | null> {
  const cookie = await readLeadCookie();
  if (!cookie) return null;
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("lead_runs")
    .select("*")
    .eq("id", cookie.id)
    .eq("cookie_token", cookie.token)
    .maybeSingle();
  if (!data) return null;
  const row = data as LeadRunRow & { expires_at: string };
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export async function requireLeadRun(): Promise<LeadRunRow> {
  const row = await getActiveLeadRun();
  if (!row) throw new Error("No active lead run");
  return row;
}

export interface UpdateLeadRunInput {
  ageBand?: "over_18" | "under_18";
  parentalSignatureUrl?: string | null;
  consentRecorded?: boolean;
  consentTermsVersion?: string;
  firstName?: string;
  grade?: string;
  shareWithAdvisers?: boolean;
  presentationSessionId?: string;
  qaSessionId?: string;
}

export async function updateLeadRun(
  id: string,
  patch: UpdateLeadRunInput,
): Promise<LeadRunRow> {
  const admin = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.ageBand !== undefined) update.age_band = patch.ageBand;
  if (patch.parentalSignatureUrl !== undefined)
    update.parental_signature_url = patch.parentalSignatureUrl;
  if (patch.consentRecorded) update.consent_recorded_at = new Date().toISOString();
  if (patch.consentTermsVersion !== undefined)
    update.consent_terms_version = patch.consentTermsVersion;
  if (patch.firstName !== undefined) update.first_name = patch.firstName;
  if (patch.grade !== undefined) update.grade = patch.grade;
  if (patch.shareWithAdvisers !== undefined)
    update.share_with_advisers = patch.shareWithAdvisers;
  if (patch.presentationSessionId !== undefined)
    update.presentation_session_id = patch.presentationSessionId;
  if (patch.qaSessionId !== undefined) update.qa_session_id = patch.qaSessionId;

  const { data, error } = await admin
    .from("lead_runs")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`updateLeadRun failed: ${error?.message ?? "unknown"}`);
  }
  return data as LeadRunRow;
}

/**
 * Link a freshly authenticated user to an in-flight lead run. Idempotent.
 * Also flips the linked sessions' enduser_id over so the downstream
 * pipeline (analyses, sharing, dashboards) sees them as belonging to this user.
 */
export async function claimLeadRun(
  leadRunId: string,
  userId: string,
): Promise<LeadRunRow> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("lead_runs")
    .update({ user_id: userId, claimed_at: new Date().toISOString() })
    .eq("id", leadRunId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`claimLeadRun failed: ${error?.message ?? "unknown"}`);
  }
  const row = data as LeadRunRow;

  const sessionIds = [row.presentation_session_id, row.qa_session_id].filter(
    (s): s is string => Boolean(s),
  );
  if (sessionIds.length > 0) {
    await admin
      .from("sessions")
      .update({ enduser_id: userId })
      .in("id", sessionIds);
  }
  return row;
}

export function toPublic(row: LeadRunRow): LeadRunPublic {
  return {
    id: row.id,
    ageBand: row.age_band,
    consentRecordedAt: row.consent_recorded_at,
    firstName: row.first_name,
    grade: row.grade,
    shareWithAdvisers: row.share_with_advisers,
    presentationSessionId: row.presentation_session_id,
    qaSessionId: row.qa_session_id,
    claimed: row.claimed_at !== null,
  };
}
