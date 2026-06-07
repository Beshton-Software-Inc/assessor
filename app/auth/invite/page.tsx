import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/getUser";
import { getLandingPath, type OrgRole } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<OrgRole, string> = {
  org_admin: "organization admin",
  assessor: "assessor",
  enduser: "student",
};

const ROLE_ARTICLE: Record<OrgRole, string> = {
  org_admin: "an",
  assessor: "an",
  enduser: "a",
};

const ROLE_BADGE: Record<OrgRole, string> = {
  org_admin: "bg-violet-50 text-violet-700 border border-violet-200",
  assessor: "bg-blue-50 text-blue-700 border border-blue-200",
  enduser: "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OrgRow {
  id: string;
  name: string;
  slug: string;
}

/**
 * Post-magic-link landing page. Reached AFTER /auth/callback has already
 * invoked acceptInviteOnAuth() and the user is now a member of the org.
 *
 * We look up the org by slug (preferred) or id (fallback for legacy
 * callers), confirm the signed-in user actually has a membership in that
 * org, and render a friendly "welcome to <Org>" card with a continue
 * button to the appropriate dashboard.
 *
 * If no membership is found (the invite acceptance failed silently or
 * someone hit this URL directly) we fall back gracefully by routing
 * them to their natural landing page.
 */
export default async function InviteLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; next?: string }>;
}) {
  const params = await searchParams;
  const orgKey = params?.org?.trim() ?? "";
  const nextParam = params?.next;

  const user = await getUser();
  if (!user) {
    // Middleware doesn't gate /auth/* but the welcome screen is meaningless
    // without an identity. Bounce to login and bring them back here.
    const back = new URLSearchParams();
    if (orgKey) back.set("org", orgKey);
    if (nextParam) back.set("next", nextParam);
    const qs = back.toString();
    const next = `/auth/invite${qs ? `?${qs}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(next)}` as Route);
  }

  // Resolve org. We accept either a slug (preferred) or a UUID id.
  let org: OrgRow | null = null;
  if (orgKey) {
    const supa = supabaseAdmin();
    const isUuid = UUID_RE.test(orgKey);
    const query = supa
      .from("organizations")
      .select("id, name, slug")
      .limit(1);
    const { data } = isUuid
      ? await query.eq("id", orgKey).maybeSingle()
      : await query.eq("slug", orgKey).maybeSingle();
    org = (data as OrgRow | null) ?? null;
  }

  // Find the membership for this user in this org, if any.
  const resolvedOrgId = org?.id ?? null;
  const membership =
    resolvedOrgId !== null
      ? user.memberships.find((m) => m.org_id === resolvedOrgId) ?? null
      : null;

  // Decide where the continue button should point.
  const safeNext =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : null;
  const continueHref = (safeNext ?? (await getLandingPath(user.id))) as Route;

  // Fallback when we couldn't resolve the org or the user isn't a member of
  // it. We still render a helpful card rather than 404 — this URL is the
  // user's first impression after clicking an invite, and a hard error here
  // would feel broken.
  if (!org || !membership) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-neutral-50 px-4 py-12">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm border border-neutral-200">
          <p className="text-xs uppercase tracking-wide text-neutral-500">
            Invite
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
            You&rsquo;re signed in
          </h1>
          <p className="mt-3 text-sm text-neutral-600">
            {org
              ? `We couldn't find a seat for you in ${org.name}. If you just accepted an invitation, your administrator may need to resend it.`
              : "We couldn't find that invitation. It may have been revoked, or the link may be out of date."}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Link
              href={continueHref}
              className="block w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-neutral-800"
            >
              Continue
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const role = membership.role;
  const roleLabel = ROLE_LABEL[role] ?? role;
  const article = ROLE_ARTICLE[role] ?? "a";
  const badgeClass =
    ROLE_BADGE[role] ?? "bg-neutral-100 text-neutral-700 border border-neutral-200";

  return (
    <main className="min-h-dvh flex items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm border border-neutral-200">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Welcome
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
          You&rsquo;re in, {user.profile?.display_name ?? user.email}.
        </h1>
        <p className="mt-3 text-sm text-neutral-600">
          You&rsquo;ve joined{" "}
          <span className="font-medium text-neutral-900">{org.name}</span> as{" "}
          {article}{" "}
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium align-baseline ${badgeClass}`}
          >
            {roleLabel}
          </span>
          .
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          Your seat is active. You can come back to this organization any time
          from your dashboard.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href={continueHref}
            className="block w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-neutral-800"
          >
            Continue to dashboard
          </Link>
          <p className="text-center text-xs text-neutral-400">
            Signed in as {user.email}
          </p>
        </div>
      </div>
    </main>
  );
}
