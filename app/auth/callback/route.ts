import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getLandingPath } from "@/lib/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth code-exchange handler. Supabase redirects the user back here
 * with a `code` query param after they authenticate with Google /
 * Microsoft / Apple / magic-link. We exchange the code for a session
 * cookie, then route the user to their natural landing page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");

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

  // If the caller specified a `next` param (e.g. from a deep link), honor
  // it. Otherwise pick the user's natural landing page based on roles.
  if (nextParam && nextParam.startsWith("/")) {
    return NextResponse.redirect(`${origin}${nextParam}`);
  }

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=no_user`);
  }

  const landing = await getLandingPath(user.id);
  return NextResponse.redirect(`${origin}${landing}`);
}
