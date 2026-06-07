import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GrantScope } from "@/lib/sharing/tokens";

export interface GrantRow {
  id: string;
  session_id: string;
  grantee_user_id: string | null;
  granted_by_user_id: string;
  scope: GrantScope;
  share_token: string | null;
  share_label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface CreateGrantInput {
  sessionId: string;
  granteeUserId: string;
  grantedByUserId: string;
  scope: GrantScope;
  expiresAt?: string | null;
  label?: string | null;
}

/**
 * Inserts a per-user grant (grantee_user_id set, share_token NULL).
 * Caller-supplied client decides whether RLS gates the insert
 * (supabaseServer() — the common path for the enduser-driven flow) or
 * whether we trust an upstream check (supabaseAdmin() — only for
 * server-side test harnesses).
 */
export async function createGrant(
  supa: SupabaseClient,
  input: CreateGrantInput,
): Promise<GrantRow> {
  const { data, error } = await supa
    .from("session_grants")
    .insert({
      session_id: input.sessionId,
      grantee_user_id: input.granteeUserId,
      granted_by_user_id: input.grantedByUserId,
      scope: input.scope,
      expires_at: input.expiresAt ?? null,
      share_label: input.label ?? null,
      share_token: null,
    })
    .select(
      "id, session_id, grantee_user_id, granted_by_user_id, scope, share_token, share_label, expires_at, revoked_at, created_at",
    )
    .single();
  if (error || !data) {
    throw new Error(`createGrant failed: ${error?.message ?? "unknown"}`);
  }
  return data as GrantRow;
}

/**
 * Lists every grant on a given session that is visible to the supplied
 * client (RLS-scoped). Includes revoked rows so the caller can render a
 * history; filter on revoked_at is null in the UI if you want active-only.
 */
export async function listGrantsForSession(
  supa: SupabaseClient,
  sessionId: string,
): Promise<GrantRow[]> {
  const { data, error } = await supa
    .from("session_grants")
    .select(
      "id, session_id, grantee_user_id, granted_by_user_id, scope, share_token, share_label, expires_at, revoked_at, created_at",
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`listGrantsForSession failed: ${error.message}`);
  }
  return (data ?? []) as GrantRow[];
}

/**
 * Soft-revokes a grant (per-user OR share-token) by setting revoked_at.
 * Idempotent: re-revoking a revoked row is a no-op as far as the caller
 * is concerned (the row is already invisible to has_session_access).
 */
export async function revokeGrant(
  supa: SupabaseClient,
  grantId: string,
): Promise<void> {
  const { error } = await supa
    .from("session_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId);
  if (error) {
    throw new Error(`revokeGrant failed: ${error.message}`);
  }
}

/**
 * Fetches a single grant by id (RLS-scoped via the supplied client).
 * Returns null if not visible or absent.
 */
export async function getGrantById(
  supa: SupabaseClient,
  grantId: string,
): Promise<GrantRow | null> {
  const { data, error } = await supa
    .from("session_grants")
    .select(
      "id, session_id, grantee_user_id, granted_by_user_id, scope, share_token, share_label, expires_at, revoked_at, created_at",
    )
    .eq("id", grantId)
    .maybeSingle();
  if (error) return null;
  return (data as GrantRow | null) ?? null;
}
