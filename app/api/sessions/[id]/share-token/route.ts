import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";
import { createShareToken, type GrantScope } from "@/lib/sharing/tokens";
import { logAudit } from "@/lib/audit/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sessions/[id]/share-token
 * body: { scope: 'analysis'|'full', expiresAt?: ISOstring, label?: string }
 *
 * Mints a tokenised share-link grant (grantee_user_id NULL, share_token set).
 * Auth: enduser of the session OR app_admin. Uses supabaseServer() so the
 * session_grants_insert RLS policy is the second gate.
 *
 * Response includes the absolute URL ready to copy.
 */

interface ShareTokenBody {
  scope: GrantScope;
  expiresAt?: string;
  label?: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: sessionId } = await params;
  const body = (await req.json().catch(() => ({}))) as ShareTokenBody;

  if (!body.scope || (body.scope !== "analysis" && body.scope !== "full")) {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }

  const supa = await supabaseServer();
  const { data: row } = await supa
    .from("sessions")
    .select("id, enduser_id")
    .eq("id", sessionId)
    .maybeSingle();
  const isAppAdmin = Boolean(user.profile?.is_app_admin);
  const isEnduser = (row as { enduser_id: string | null } | null)?.enduser_id === user.id;
  if (!row || (!isAppAdmin && !isEnduser)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let token;
  try {
    token = await createShareToken(supa, {
      sessionId,
      grantedByUserId: user.id,
      scope: body.scope,
      expiresAt: body.expiresAt ?? null,
      label: body.label ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to mint share token", detail: (err as Error).message },
      { status: 500 },
    );
  }

  await logAudit("share_token_created", {
    targetSessionId: sessionId,
    targetGrantId: token.id,
    metadata: { scope: body.scope, label: body.label ?? null },
  });

  const origin = absoluteOrigin(req);
  const url = `${origin}/share/${token.share_token}`;

  return NextResponse.json({
    grantId: token.id,
    token: token.share_token,
    url,
    scope: token.scope,
    expiresAt: token.expires_at,
  });
}

function absoluteOrigin(req: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // Fall back to the request URL's origin.
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}
