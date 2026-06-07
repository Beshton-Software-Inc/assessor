import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export type AuditAction =
  | "admin_session_read"
  | "admin_analysis_read"
  | "share_view"
  | "grant_created"
  | "grant_revoked"
  | "share_token_created"
  | "share_token_used";

export interface LogAuditOpts {
  targetSessionId?: string | null;
  targetGrantId?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Optional explicit Supabase client. If omitted we use supabaseServer()
   * so auth.uid() inside the SQL function picks up the calling user. Pass
   * supabaseAdmin() for unauthenticated paths (e.g., a share-resolve call
   * before login) — actor_user_id will be NULL in that case.
   */
  client?: SupabaseClient;
}

/**
 * Append-only audit log writer. Routes through the SECURITY DEFINER SQL
 * function `public.log_audit(...)` which is the only way to insert (the
 * audit_log table has no INSERT policy for authenticated callers).
 *
 * Failures are swallowed and logged to console — audit logging must never
 * break the user-visible flow. Callers fire-and-forget.
 */
export async function logAudit(
  action: AuditAction,
  opts: LogAuditOpts = {},
): Promise<void> {
  const client = opts.client ?? (await supabaseServer());
  const { error } = await client.rpc("log_audit", {
    p_action: action,
    p_target_session_id: opts.targetSessionId ?? null,
    p_target_grant_id: opts.targetGrantId ?? null,
    p_metadata: opts.metadata ?? {},
  });
  if (error) {
    console.warn("[audit] log_audit failed", { action, error: error.message });
  }
}

/**
 * Convenience for unauthenticated paths (e.g., resolving a share token
 * before redirecting to login). Uses the service-role client so the row
 * is written even with no JWT; actor_user_id will be NULL.
 */
export async function logAuditAdmin(
  action: AuditAction,
  opts: Omit<LogAuditOpts, "client"> = {},
): Promise<void> {
  return logAudit(action, { ...opts, client: supabaseAdmin() });
}
