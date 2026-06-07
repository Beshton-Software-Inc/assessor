import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveShareToken } from "@/lib/sharing/tokens";
import { logAuditAdmin } from "@/lib/audit/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/share/resolve?token=...
 *
 * Resolves a share token to (sessionId, scope). Public endpoint: the
 * /share/[token] page may call this before a user is signed in. The SQL
 * helper resolve_share_token is SECURITY DEFINER and EXECUTE-granted to
 * anon, so this works without a JWT.
 *
 * On invalid/expired/revoked: 404 { error: 'invalid_share_token' } with
 * NO disclosure of which token was tried.
 *
 * Logs share_token_used so we have a record of every successful resolve.
 * The companion 'share_view' audit row is written from the page itself
 * once we know who is consuming the link.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "invalid_share_token" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const resolved = await resolveShareToken(admin, token);
  if (!resolved) {
    return NextResponse.json({ error: "invalid_share_token" }, { status: 404 });
  }

  // Fire-and-forget audit. We use the admin path because the caller may be
  // unauthenticated; actor_user_id will be NULL in that case.
  await logAuditAdmin("share_token_used", {
    targetSessionId: resolved.sessionId,
    metadata: { token_prefix: token.slice(0, 6) },
  });

  return NextResponse.json({
    sessionId: resolved.sessionId,
    scope: resolved.scope,
  });
}
