import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/requireRole";
import { supabaseAdmin } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";
import { OrgPicker, type OrgPickerOption } from "./OrgPicker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
  trial_ends_at: string | null;
}

interface MemberRow {
  user_id: string;
  role: string;
  created_at: string;
  display_name: string | null;
}

const ROLE_BADGE: Record<string, string> = {
  org_admin: "bg-violet-50 text-violet-700 border border-violet-200",
  assessor: "bg-blue-50 text-blue-700 border border-blue-200",
  enduser: "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

const ROLE_LABEL: Record<string, string> = {
  org_admin: "Org admin",
  assessor: "Assessor",
  enduser: "Student",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Phase A org-admin dashboard.
 *
 * Org_admins see ONLY aggregate counts (no PII): no student names beyond
 * member display_names, no recording paths, no transcripts, no analyses
 * content. We use supabaseAdmin() inside this server component because
 * RLS sessions/analyses policies do not grant read to org_admin (by
 * design); we therefore manually constrain every query to the resolved
 * org_id and never SELECT a content column. See migration 0003 for the
 * "no PII for org_admin" rationale.
 */
export default async function OrgAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const user = await requireUser();
  const orgAdminMemberships = user.memberships.filter(
    (m) => m.role === "org_admin",
  );

  if (orgAdminMemberships.length === 0) {
    return (
      <main className="min-h-dvh bg-neutral-50 px-6 py-12">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-neutral-900">
              Organization Admin
            </h1>
            <div className="flex items-center gap-3">
              {user.profile?.is_app_admin && (
                <Link
                  href={"/admin/console" as Route}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Console
                </Link>
              )}
              <SignOutButton />
            </div>
          </div>
          <div className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6">
            <h2 className="text-base font-medium text-neutral-900">
              No access
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              You are signed in as{" "}
              <span className="font-medium">
                {user.profile?.display_name ?? user.email}
              </span>
              , but you don&apos;t have org-admin access to any organization.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const supa = supabaseAdmin();

  // Resolve which org we are viewing.
  const eligibleOrgIds = orgAdminMemberships.map((m) => m.org_id);
  const params = await searchParams;
  const requested = params?.org;
  const selectedOrgId =
    requested && eligibleOrgIds.includes(requested)
      ? requested
      : eligibleOrgIds[0];

  // If the requested org isn't one of theirs, send them back to the default.
  if (requested && !eligibleOrgIds.includes(requested)) {
    redirect(`/admin/org?org=${eligibleOrgIds[0]}`);
  }

  // Fetch all eligible orgs (for the picker) + the selected org details.
  const { data: orgRows } = await supa
    .from("organizations")
    .select("id, name, slug, plan, trial_ends_at")
    .in("id", eligibleOrgIds);
  const orgs = (orgRows ?? []) as OrgRow[];
  const selectedOrg = orgs.find((o) => o.id === selectedOrgId) ?? null;

  if (!selectedOrg) {
    return (
      <main className="min-h-dvh bg-neutral-50 px-6 py-12">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-neutral-900">
              Organization Admin
            </h1>
            <div className="flex items-center gap-3">
              {user.profile?.is_app_admin && (
                <Link
                  href={"/admin/console" as Route}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Console
                </Link>
              )}
              <SignOutButton />
            </div>
          </div>
          <div className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6">
            <p className="text-sm text-neutral-600">
              The organization you tried to view is not available.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Members: org_members JOIN profiles. We do this in two steps because
  // PostgREST embedded resource selection requires a foreign-key hint and
  // org_members.user_id -> profiles.user_id is not a hard FK in the schema.
  const { data: memberRows } = await supa
    .from("org_members")
    .select("user_id, role, created_at")
    .eq("org_id", selectedOrg.id);
  const members = memberRows ?? [];

  let memberDisplay: MemberRow[] = [];
  if (members.length > 0) {
    const userIds = members.map((m) => m.user_id);
    const { data: profileRows } = await supa
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);
    const nameByUser = new Map<string, string | null>();
    for (const p of profileRows ?? []) {
      nameByUser.set(
        (p as { user_id: string }).user_id,
        (p as { display_name: string | null }).display_name ?? null,
      );
    }
    memberDisplay = members
      .map((m) => ({
        user_id: m.user_id as string,
        role: m.role as string,
        created_at: m.created_at as string,
        display_name: nameByUser.get(m.user_id as string) ?? null,
      }))
      .sort((a, b) => {
        // org_admins first, then assessors, then endusers; ties broken by name.
        const order: Record<string, number> = {
          org_admin: 0,
          assessor: 1,
          enduser: 2,
        };
        const ra = order[a.role] ?? 9;
        const rb = order[b.role] ?? 9;
        if (ra !== rb) return ra - rb;
        return (a.display_name ?? "").localeCompare(b.display_name ?? "");
      });
  }

  // Aggregate counts. Use head:true + count:'exact' so Postgres returns the
  // count without any rows — we never want to materialise PII columns here.
  const sevenDaysAgoIso = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    { count: totalSessions7d },
    { count: totalSessionsAll },
    { count: totalAnalyses7d },
    { count: totalAnalysesAll },
  ] = await Promise.all([
    supa
      .from("sessions")
      .select("*", { count: "exact", head: true })
      .eq("org_id", selectedOrg.id)
      .gte("created_at", sevenDaysAgoIso),
    supa
      .from("sessions")
      .select("*", { count: "exact", head: true })
      .eq("org_id", selectedOrg.id),
    // analyses doesn't carry org_id; constrain via session_id IN (sessions for this org).
    // We do this with a single nested-select via .in() against the session ids.
    (async () => {
      const { data: sIds } = await supa
        .from("sessions")
        .select("id")
        .eq("org_id", selectedOrg.id);
      const ids = (sIds ?? []).map((r) => (r as { id: string }).id);
      if (ids.length === 0) return { count: 0 };
      const { count } = await supa
        .from("analyses")
        .select("*", { count: "exact", head: true })
        .in("session_id", ids)
        .gte("created_at", sevenDaysAgoIso);
      return { count: count ?? 0 };
    })(),
    (async () => {
      const { data: sIds } = await supa
        .from("sessions")
        .select("id")
        .eq("org_id", selectedOrg.id);
      const ids = (sIds ?? []).map((r) => (r as { id: string }).id);
      if (ids.length === 0) return { count: 0 };
      const { count } = await supa
        .from("analyses")
        .select("*", { count: "exact", head: true })
        .in("session_id", ids);
      return { count: count ?? 0 };
    })(),
  ]);

  const totalMembers = memberDisplay.length;
  const sessions7d = totalSessions7d ?? 0;
  const analyses7d = totalAnalyses7d ?? 0;
  const sessionsAll = totalSessionsAll ?? 0;
  const analysesAll = totalAnalysesAll ?? 0;

  // Simple text "bar chart": pick the larger of the two as the scale.
  const barScale = Math.max(sessions7d, analyses7d, 1);
  const sessionsBarWidth = `${Math.round((sessions7d / barScale) * 100)}%`;
  const analysesBarWidth = `${Math.round((analyses7d / barScale) * 100)}%`;

  const pickerOrgs: OrgPickerOption[] = orgs.map((o) => ({
    id: o.id,
    name: o.name,
  }));

  return (
    <main className="min-h-dvh bg-neutral-50 px-6 py-12">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              Organization admin
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
              {selectedOrg.name}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              Signed in as{" "}
              <span className="font-medium text-neutral-700">
                {user.profile?.display_name ?? user.email}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {pickerOrgs.length > 1 && (
              <OrgPicker orgs={pickerOrgs} current={selectedOrg.id} />
            )}
            {user.profile?.is_app_admin && (
              <Link
                href={"/admin/console" as Route}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Console
              </Link>
            )}
            <SignOutButton />
          </div>
        </div>

        {/* Overview card */}
        <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6">
          <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
            Overview
          </h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-neutral-500">Slug</dt>
              <dd className="mt-1 font-mono text-sm text-neutral-900">
                {selectedOrg.slug}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Plan</dt>
              <dd className="mt-1 text-sm text-neutral-900 capitalize">
                {selectedOrg.plan ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Trial ends</dt>
              <dd className="mt-1 text-sm text-neutral-900">
                {formatDate(selectedOrg.trial_ends_at)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Members</dt>
              <dd className="mt-1 text-sm text-neutral-900">{totalMembers}</dd>
            </div>
          </dl>
        </section>

        {/* Usage card */}
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
              Usage
            </h2>
            <p className="text-xs text-neutral-500">
              {sessionsAll} sessions · {analysesAll} analyses all-time
            </p>
          </div>
          <p className="mt-3 text-sm text-neutral-700">
            Last 7 days:{" "}
            <span className="font-semibold text-neutral-900">
              {sessions7d} {sessions7d === 1 ? "session" : "sessions"}
            </span>
            ,{" "}
            <span className="font-semibold text-neutral-900">
              {analyses7d} {analyses7d === 1 ? "analysis" : "analyses"}
            </span>
            .
          </p>

          <div className="mt-5 space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs text-neutral-600">
                <span>Sessions</span>
                <span className="tabular-nums">{sessions7d}</span>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-neutral-100 overflow-hidden">
                <div
                  className="h-full bg-blue-500"
                  style={{ width: sessionsBarWidth }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-neutral-600">
                <span>Analyses</span>
                <span className="tabular-nums">{analyses7d}</span>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-neutral-100 overflow-hidden">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: analysesBarWidth }}
                />
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs text-neutral-400">
            Org admins see aggregate counts only. Session content, transcripts,
            and analyses are restricted by Row-Level Security.
          </p>
        </section>

        {/* Members card */}
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
              Members
            </h2>
            <span
              className="cursor-not-allowed rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-400"
              title="Coming in phase B"
              aria-disabled="true"
            >
              Invite
            </span>
          </div>

          {memberDisplay.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">No members yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {memberDisplay.map((m) => (
                    <tr
                      key={m.user_id}
                      className="border-b border-neutral-100 last:border-b-0"
                    >
                      <td className="py-3 pr-4 text-neutral-900">
                        {m.display_name ?? (
                          <span className="text-neutral-400">
                            (no name set)
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            ROLE_BADGE[m.role] ??
                            "bg-neutral-100 text-neutral-700 border border-neutral-200"
                          }`}
                        >
                          {ROLE_LABEL[m.role] ?? m.role}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-neutral-600">
                        {formatDate(m.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
