import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { getLandingPath } from "@/lib/auth/roles";
import { acceptInviteOnAuth, InviteError } from "@/lib/billing/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth code-exchange handler. Supabase redirects the user back here
 * with a `code` query param after they authenticate with Google /
 * Microsoft / Apple / magic-link. We exchange the code for a session
 * cookie, then route the user to their natural landing page.
 *
 * Phase C addition: if the URL has ?invite=<token>, after the auth
 * exchange we accept the seat invite (insert org_members row, flip
 * status to accepted) using a service-role client. On success we
 * redirect to /auth/invite?org=<slug> so the user gets a friendly
 * "welcome to <Org>" landing page before continuing into the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const inviteToken = searchParams.get("invite");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supa = await supabaseServer();
  const { error } = await supa.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=no_user`);
  }

  // Accept seat invite, if present. On success route through the
  // /auth/invite welcome page; on failure redirect with a descriptive
  // query param rather than dropping the whole login.
  if (inviteToken) {
    try {
      const { orgId } = await acceptInviteOnAuth({
        token: inviteToken,
        userId: user.id,
        email: user.email ?? null,
      });
      // Look up the org slug for a stable, human-friendly URL.
      const admin = supabaseAdmin();
      const { data: orgRow } = await admin
        .from("organizations")
        .select("slug")
        .eq("id", orgId)
        .maybeSingle();
      const orgKey = (orgRow as { slug: string | null } | null)?.slug ?? orgId;
      const inviteUrl = new URL("/auth/invite", origin);
      inviteUrl.searchParams.set("org", orgKey);
      if (nextParam && nextParam.startsWith("/")) {
        inviteUrl.searchParams.set("next", nextParam);
      }
      return NextResponse.redirect(inviteUrl.toString());
    } catch (err) {
      const failCode =
        err instanceof InviteError ? err.code : "invite_failed";
      const dest =
        nextParam && nextParam.startsWith("/") ? nextParam : "/admin/billing";
      return NextResponse.redirect(
        `${origin}${dest}?invite_error=${encodeURIComponent(failCode)}`,
      );
    }
  }

  // If the caller specified a `next` param (e.g. from a deep link), honor
  // it. Otherwise pick the user's natural landing page based on roles.
  if (nextParam && nextParam.startsWith("/")) {
    return NextResponse.redirect(`${origin}${nextParam}`);
  }

  const landing = await getLandingPath(user.id);
  return NextResponse.redirect(`${origin}${landing}`);
}
