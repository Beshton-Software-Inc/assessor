import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type GrantScope = "analysis" | "full";

export interface ShareTokenRow {
  id: string;
  session_id: string;
  scope: GrantScope;
  share_token: string;
  share_label: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

/**
 * Generates a URL-safe random token. 24 bytes -> 32 base64url chars,
 * giving ~192 bits of entropy. The token IS the secret: anyone who
 * knows it can resolve it to a session via resolve_share_token().
 */
export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export interface CreateShareTokenInput {
  sessionId: string;
  grantedByUserId: string;
  scope: GrantScope;
  expiresAt?: string | null;
  label?: string | null;
}

/**
 * Inserts a new share-token grant. The supplied client must be authorized
 * to insert into session_grants for this session — usually supabaseServer()
 * with the granter signed in (the enduser of the session).
 */
export async function createShareToken(
  supa: SupabaseClient,
  input: CreateShareTokenInput,
): Promise<ShareTokenRow> {
  const token = generateShareToken();
  const { data, error } = await supa
    .from("session_grants")
    .insert({
      session_id: input.sessionId,
      granted_by_user_id: input.grantedByUserId,
      grantee_user_id: null,
      scope: input.scope,
      expires_at: input.expiresAt ?? null,
      share_token: token,
      share_label: input.label ?? null,
    })
    .select("id, session_id, scope, share_token, share_label, expires_at, created_at, revoked_at")
    .single();
  if (error || !data) {
    throw new Error(`createShareToken failed: ${error?.message ?? "unknown"}`);
  }
  return data as ShareTokenRow;
}

export interface ResolvedShareToken {
  sessionId: string;
  scope: GrantScope;
}

/**
 * Resolves a token to (sessionId, scope) by calling the SQL helper. Returns
 * null on invalid/expired/revoked. SECURITY DEFINER on the SQL side means
 * this works for both authenticated and anon callers.
 */
export async function resolveShareToken(
  supa: SupabaseClient,
  token: string,
): Promise<ResolvedShareToken | null> {
  const { data, error } = await supa.rpc("resolve_share_token", { p_token: token });
  if (error) {
    // SQL function raises 'invalid_share_token' for unknown tokens. Treat any
    // RPC error as a non-resolution; caller renders the generic error page.
    return null;
  }
  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    sessionId: row.session_id as string,
    scope: row.scope as GrantScope,
  };
}

/**
 * Soft-revokes a share-token grant. The supplied client must be authorized
 * to UPDATE session_grants under the row's policy (granter, session enduser,
 * or app_admin).
 */
export async function revokeShareToken(
  supa: SupabaseClient,
  grantId: string,
): Promise<void> {
  const { error } = await supa
    .from("session_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .not("share_token", "is", null);
  if (error) {
    throw new Error(`revokeShareToken failed: ${error.message}`);
  }
}
