import Link from "next/link";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireUser } from "@/lib/auth/requireRole";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { UserMenu } from "@/components/UserMenu";
import { Tabs } from "./Tabs";
import {
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE,
  AuditLogTable,
  type AuditAction,
  type AuditFilters,
  type AuditRow,
} from "./AuditLogTable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * App-admin console.
 *
 * Gated on profiles.is_app_admin (NOT an org_members row), so we use
 * requireUser() and a manual check rather than requireRole('app_admin').
 * Any non-admin caller is silently sent to '/' so we don't leak the
 * existence of this surface.
 *
 * Sections rendered as tabs:
 *   1. Overview     — aggregate counts
 *   2. Audit log    — paginated audit_log table (RLS-gated via supabaseServer)
 *   3. Sessions     — every session across all orgs
 *
 * The audit-log SELECT goes through supabaseServer() so the audit_log_select
 * policy gates it (we are app_admin); everything else uses supabaseAdmin()
 * because the spec calls for cross-org visibility and is_app_admin() on RLS
 * already permits it — using the admin client just keeps the SQL simpler.
 */
export default async function AppAdminConsolePage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    action?: string;
    from?: string;
    to?: string;
    page?: string;
    org?: string;
    stage?: string;
    q?: string;
  }>;
}) {
  const user = await requireUser();
  if (!user.profile?.is_app_admin) {
    // Non-admin user reached this URL directly. Send them home; do NOT
    // redirect to /login because they ARE signed in.
    redirect("/" as Route);
  }

  const params = await searchParams;
  const initialTab = params.tab === "audit" || params.tab === "sessions" || params.tab === "overview" ? params.tab : "overview";

  const overview = await loadOverview();
  const auditFilters = parseAuditFilters(params);
  const auditView = await loadAuditPage(auditFilters);
  const sessionsFilter = parseSessionsFilter(params);
  const sessionsView = await loadSessionsPage(sessionsFilter);

  return (
    <main className="min-h-dvh bg-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              App admin
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
              Console
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              Signed in as{" "}
              <span className="font-medium text-neutral-700">
                {user.profile?.display_name ?? user.email}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={"/admin/org" as Route}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Org admin
            </Link>
            <UserMenu
              displayName={user.profile?.display_name}
              email={user.email}
            />
          </div>
        </div>

        <div className="mt-8">
          <Tabs
            defaultTab={initialTab}
            tabs={[
              {
                id: "overview",
                label: "Overview",
                content: <OverviewSection data={overview} />,
              },
              {
                id: "audit",
                label: "Audit log",
                content: (
                  <AuditLogTable
                    rows={auditView.rows}
                    totalCount={auditView.total}
                    filters={auditFilters}
                  />
                ),
              },
              {
                id: "sessions",
                label: "Sessions",
                content: (
                  <SessionsSection
                    rows={sessionsView.rows}
                    totalCount={sessionsView.total}
                    filter={sessionsFilter}
                  />
                ),
              },
            ]}
          />
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

interface OverviewData {
  orgsCount: number;
  membersCount: number;
  sessionsCount: number;
  analysesCount: number;
  activeGrantsCount: number;
  shareViews7d: number;
  shareViewsByDay: { day: string; count: number }[];
}

async function loadOverview(): Promise<OverviewData> {
  const supa = supabaseAdmin();
  const sevenDaysAgoIso = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // All count queries use head:true + count:'exact' so no row data is
  // materialised in this server component — only counts.
  const [
    { count: orgsCount },
    { count: membersCount },
    { count: sessionsCount },
    { count: analysesCount },
    { count: activeGrantsCount },
    shareViewsRes,
  ] = await Promise.all([
    supa.from("organizations").select("*", { count: "exact", head: true }),
    supa.from("org_members").select("*", { count: "exact", head: true }),
    supa.from("sessions").select("*", { count: "exact", head: true }),
    supa.from("analyses").select("*", { count: "exact", head: true }),
    supa
      .from("session_grants")
      .select("*", { count: "exact", head: true })
      .is("revoked_at", null),
    // For "share views by day" we need the actual rows; cap to last 7 days.
    supa
      .from("audit_log")
      .select("created_at")
      .eq("action", "share_view")
      .gte("created_at", sevenDaysAgoIso),
  ]);

  // Bucket share_view rows by yyyy-mm-dd in UTC.
  const buckets = new Map<string, number>();
  const rows = (shareViewsRes.data ?? []) as { created_at: string }[];
  for (const r of rows) {
    const d = new Date(r.created_at);
    const key = isNaN(d.getTime())
      ? "unknown"
      : d.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  // Build a contiguous 7-day timeline so "no views today" still shows.
  const days: { day: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    days.push({ day: key, count: buckets.get(key) ?? 0 });
  }

  return {
    orgsCount: orgsCount ?? 0,
    membersCount: membersCount ?? 0,
    sessionsCount: sessionsCount ?? 0,
    analysesCount: analysesCount ?? 0,
    activeGrantsCount: activeGrantsCount ?? 0,
    shareViews7d: rows.length,
    shareViewsByDay: days,
  };
}

function OverviewSection({ data }: { data: OverviewData }) {
  const cards: { label: string; value: number; tone: string }[] = [
    { label: "Organizations", value: data.orgsCount, tone: "text-violet-700" },
    { label: "Members", value: data.membersCount, tone: "text-blue-700" },
    { label: "Sessions", value: data.sessionsCount, tone: "text-neutral-900" },
    { label: "Analyses", value: data.analysesCount, tone: "text-emerald-700" },
    { label: "Active grants", value: data.activeGrantsCount, tone: "text-amber-700" },
    { label: "Share views (7d)", value: data.shareViews7d, tone: "text-blue-700" },
  ];

  const maxDay = Math.max(...data.shareViewsByDay.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
          Counts
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {cards.map((c) => (
            <div
              key={c.label}
              className="rounded-2xl border border-neutral-200 bg-white p-4"
            >
              <dt className="text-xs text-neutral-500">{c.label}</dt>
              <dd
                className={`mt-1 text-2xl font-semibold tabular-nums ${c.tone}`}
              >
                {c.value.toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
          Share views — last 7 days
        </h2>
        <div className="mt-4 flex h-32 items-end gap-2">
          {data.shareViewsByDay.map((d) => {
            const heightPct = Math.round((d.count / maxDay) * 100);
            return (
              <div
                key={d.day}
                className="flex flex-1 flex-col items-center gap-1"
              >
                <div className="text-xs tabular-nums text-neutral-600">
                  {d.count}
                </div>
                <div className="relative w-full flex-1 rounded-md bg-neutral-100">
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-md bg-blue-500"
                    style={{ height: `${Math.max(heightPct, d.count > 0 ? 8 : 0)}%` }}
                  />
                </div>
                <div className="text-[10px] uppercase tracking-wide text-neutral-400">
                  {d.day.slice(5)}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-neutral-400">
          Counts every entry in audit_log with action=&apos;share_view&apos; over the
          last 7 days, bucketed by UTC day.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

function parseAuditFilters(params: {
  action?: string;
  from?: string;
  to?: string;
  page?: string;
}): AuditFilters {
  const action = AUDIT_ACTIONS.includes(params.action as AuditAction)
    ? (params.action as AuditAction)
    : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const from = sanitizeDate(params.from);
  const to = sanitizeDate(params.to);
  return { action, from, to, page };
}

function sanitizeDate(v: string | undefined): string {
  if (!v) return "";
  // Accept yyyy-mm-dd from <input type="date">. Anything else: drop.
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

interface AuditView {
  rows: AuditRow[];
  total: number;
}

async function loadAuditPage(filters: AuditFilters): Promise<AuditView> {
  // Use supabaseServer() so audit_log_select RLS gates the read (we are
  // app_admin; non-admin callers were rejected at the page guard).
  const supa = await supabaseServer();
  const offset = (filters.page - 1) * AUDIT_PAGE_SIZE;

  let query = supa
    .from("audit_log")
    .select(
      "id, created_at, action, actor_user_id, target_session_id, target_grant_id, metadata",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + AUDIT_PAGE_SIZE - 1);

  if (filters.action) query = query.eq("action", filters.action);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
  if (filters.to) {
    // Inclusive end-of-day.
    const next = new Date(filters.to + "T00:00:00.000Z");
    next.setUTCDate(next.getUTCDate() + 1);
    query = query.lt("created_at", next.toISOString());
  }

  const { data, count } = await query;
  const rawRows = (data ?? []) as Omit<AuditRow, "actor_display_name" | "actor_email">[];

  if (rawRows.length === 0) {
    return { rows: [], total: count ?? 0 };
  }

  // Resolve actors. profiles.display_name + auth.users.email come from the
  // admin client (RLS would also let app_admin see profiles, but we want
  // emails too which only the admin client surfaces).
  const actorIds = Array.from(
    new Set(rawRows.map((r) => r.actor_user_id).filter((v): v is string => Boolean(v))),
  );

  const admin = supabaseAdmin();
  const nameByUser = new Map<string, string | null>();
  const emailByUser = new Map<string, string | null>();

  if (actorIds.length > 0) {
    const { data: profileRows } = await admin
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", actorIds);
    for (const p of profileRows ?? []) {
      const row = p as { user_id: string; display_name: string | null };
      nameByUser.set(row.user_id, row.display_name);
    }

    // Fetch emails one-by-one because auth.admin.getUserById is the only
    // reliable shape; in practice these batches are bounded by the page
    // size (50). For larger pages this would warrant a JOIN-shaped helper.
    await Promise.all(
      actorIds.map(async (uid) => {
        try {
          const { data } = await admin.auth.admin.getUserById(uid);
          emailByUser.set(uid, data?.user?.email ?? null);
        } catch {
          emailByUser.set(uid, null);
        }
      }),
    );
  }

  const rows: AuditRow[] = rawRows.map((r) => ({
    ...r,
    actor_display_name: r.actor_user_id ? nameByUser.get(r.actor_user_id) ?? null : null,
    actor_email: r.actor_user_id ? emailByUser.get(r.actor_user_id) ?? null : null,
  }));

  return { rows, total: count ?? rows.length };
}

// ---------------------------------------------------------------------------
// Sessions browser
// ---------------------------------------------------------------------------

interface SessionsFilter {
  org: string;
  stage: string;
  q: string;
  page: number;
}

const VALID_STAGES = new Set([
  "started",
  "recording",
  "completed",
  "aborted",
]);

function parseSessionsFilter(params: {
  org?: string;
  stage?: string;
  q?: string;
  page?: string;
}): SessionsFilter {
  return {
    org: typeof params.org === "string" ? params.org.trim() : "",
    stage: VALID_STAGES.has(params.stage ?? "") ? (params.stage as string) : "",
    q: typeof params.q === "string" ? params.q.trim().slice(0, 100) : "",
    page: Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1),
  };
}

const SESSIONS_PAGE_SIZE = 50;

interface AdminSessionRow {
  id: string;
  created_at: string;
  stage: string;
  duration_ms: number | null;
  recording_path: string | null;
  org_id: string | null;
  assessor_id: string | null;
  enduser_id: string | null;
  org_slug: string | null;
  org_name: string | null;
  assessor_name: string | null;
  assessor_email: string | null;
  enduser_name: string | null;
  enduser_email: string | null;
  has_analysis: boolean;
}

interface SessionsView {
  rows: AdminSessionRow[];
  total: number;
}

async function loadSessionsPage(filter: SessionsFilter): Promise<SessionsView> {
  const supa = supabaseAdmin();
  const offset = (filter.page - 1) * SESSIONS_PAGE_SIZE;

  // Base query against sessions. is_app_admin() RLS would also permit this
  // through supabaseServer, but using the admin client keeps the response
  // shape simple and is safe here because we already gated the page.
  let query = supa
    .from("sessions")
    .select(
      "id, created_at, stage, duration_ms, recording_path, org_id, assessor_id, enduser_id",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (filter.org) query = query.eq("org_id", filter.org);
  if (filter.stage) query = query.eq("stage", filter.stage);
  if (filter.q && /^[0-9a-f-]{1,36}$/i.test(filter.q)) {
    // Treat the search box as an id-prefix match when it looks like a uuid
    // fragment. The display_name search path needs a name-resolved join,
    // which we do client-side post-fetch below.
    query = query.ilike("id", `${filter.q}%`);
  }

  query = query.range(offset, offset + SESSIONS_PAGE_SIZE - 1);

  const { data, count } = await query;
  const baseRows = (data ?? []) as Omit<
    AdminSessionRow,
    "org_slug" | "org_name" | "assessor_name" | "assessor_email" | "enduser_name" | "enduser_email" | "has_analysis"
  >[];

  if (baseRows.length === 0) {
    return { rows: [], total: count ?? 0 };
  }

  const orgIds = Array.from(
    new Set(baseRows.map((r) => r.org_id).filter((v): v is string => Boolean(v))),
  );
  const userIds = Array.from(
    new Set(
      baseRows
        .flatMap((r) => [r.assessor_id, r.enduser_id])
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const sessionIds = baseRows.map((r) => r.id);

  const [{ data: orgs }, { data: profiles }, { data: analyses }] =
    await Promise.all([
      orgIds.length > 0
        ? supa.from("organizations").select("id, slug, name").in("id", orgIds)
        : Promise.resolve({ data: [] as { id: string; slug: string; name: string }[] }),
      userIds.length > 0
        ? supa.from("profiles").select("user_id, display_name").in("user_id", userIds)
        : Promise.resolve({ data: [] as { user_id: string; display_name: string | null }[] }),
      sessionIds.length > 0
        ? supa.from("analyses").select("session_id").in("session_id", sessionIds)
        : Promise.resolve({ data: [] as { session_id: string }[] }),
    ]);

  const orgById = new Map<string, { slug: string; name: string }>();
  for (const o of (orgs ?? []) as { id: string; slug: string; name: string }[]) {
    orgById.set(o.id, { slug: o.slug, name: o.name });
  }
  const nameByUser = new Map<string, string | null>();
  for (const p of (profiles ?? []) as { user_id: string; display_name: string | null }[]) {
    nameByUser.set(p.user_id, p.display_name);
  }
  const sessionsWithAnalysis = new Set<string>();
  for (const a of (analyses ?? []) as { session_id: string }[]) {
    sessionsWithAnalysis.add(a.session_id);
  }

  // Fetch emails for actor users (best-effort, bounded by page size).
  const emailByUser = new Map<string, string | null>();
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const { data } = await supa.auth.admin.getUserById(uid);
        emailByUser.set(uid, data?.user?.email ?? null);
      } catch {
        emailByUser.set(uid, null);
      }
    }),
  );

  let rows: AdminSessionRow[] = baseRows.map((r) => {
    const org = r.org_id ? orgById.get(r.org_id) ?? null : null;
    return {
      ...r,
      org_slug: org?.slug ?? null,
      org_name: org?.name ?? null,
      assessor_name: r.assessor_id ? nameByUser.get(r.assessor_id) ?? null : null,
      assessor_email: r.assessor_id ? emailByUser.get(r.assessor_id) ?? null : null,
      enduser_name: r.enduser_id ? nameByUser.get(r.enduser_id) ?? null : null,
      enduser_email: r.enduser_id ? emailByUser.get(r.enduser_id) ?? null : null,
      has_analysis: sessionsWithAnalysis.has(r.id),
    };
  });

  // Free-text q matches against names/emails only after we have the join.
  // (id-prefix search was already applied at the SQL level above.)
  if (filter.q && !/^[0-9a-f-]{1,36}$/i.test(filter.q)) {
    const needle = filter.q.toLowerCase();
    rows = rows.filter((r) => {
      const haystack = [
        r.assessor_name,
        r.assessor_email,
        r.enduser_name,
        r.enduser_email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  return { rows, total: count ?? rows.length };
}

function SessionsSection({
  rows,
  totalCount,
  filter,
}: {
  rows: AdminSessionRow[];
  totalCount: number;
  filter: SessionsFilter;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / SESSIONS_PAGE_SIZE));
  const currentPage = Math.max(1, filter.page);

  const baseParams: Record<string, string> = { tab: "sessions" };
  if (filter.org) baseParams.org = filter.org;
  if (filter.stage) baseParams.stage = filter.stage;
  if (filter.q) baseParams.q = filter.q;

  return (
    <div>
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4"
      >
        <input type="hidden" name="tab" value="sessions" />
        <div className="flex flex-col">
          <label className="text-xs text-neutral-500" htmlFor="sess-org">
            Org id
          </label>
          <input
            id="sess-org"
            name="org"
            defaultValue={filter.org}
            placeholder="uuid"
            className="mt-1 w-56 rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-neutral-500" htmlFor="sess-stage">
            Stage
          </label>
          <select
            id="sess-stage"
            name="stage"
            defaultValue={filter.stage}
            className="mt-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">Any</option>
            <option value="started">started</option>
            <option value="recording">recording</option>
            <option value="completed">completed</option>
            <option value="aborted">aborted</option>
          </select>
        </div>
        <div className="flex flex-col flex-1 min-w-[180px]">
          <label className="text-xs text-neutral-500" htmlFor="sess-q">
            Search
          </label>
          <input
            id="sess-q"
            name="q"
            defaultValue={filter.q}
            placeholder="id prefix or name/email"
            className="mt-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Filter
        </button>
        {(filter.org || filter.stage || filter.q) && (
          <Link
            href={"/admin/console?tab=sessions" as Route}
            className="text-xs text-neutral-500 hover:text-neutral-900"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs font-medium uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2">Org</th>
              <th className="px-4 py-2">Assessor</th>
              <th className="px-4 py-2">Student</th>
              <th className="px-4 py-2">Stage</th>
              <th className="px-4 py-2">Duration</th>
              <th className="px-4 py-2">Recording</th>
              <th className="px-4 py-2">Analysis</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-6 text-center text-sm text-neutral-500"
                >
                  No sessions match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-neutral-100 last:border-b-0 align-top"
                >
                  <td className="px-4 py-3 whitespace-nowrap text-neutral-700">
                    {formatDate(r.created_at)}
                  </td>
                  <td className="px-4 py-3 text-neutral-700">
                    {r.org_slug ? (
                      <span className="font-mono text-xs">{r.org_slug}</span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <UserCell name={r.assessor_name} email={r.assessor_email} />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <UserCell name={r.enduser_name} email={r.enduser_email} />
                  </td>
                  <td className="px-4 py-3 text-neutral-700 capitalize">
                    {r.stage}
                  </td>
                  <td className="px-4 py-3 text-neutral-700 tabular-nums">
                    {formatDuration(r.duration_ms)}
                  </td>
                  <td className="px-4 py-3 text-neutral-700">
                    {r.recording_path ? (
                      <span className="text-emerald-600">yes</span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-700">
                    {r.has_analysis ? (
                      <span className="text-emerald-600">yes</span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <Link
                      href={`/admin/console/sessions/${r.id}` as Route}
                      className="rounded-md border border-neutral-300 bg-white px-2 py-1 font-medium text-neutral-700 hover:bg-neutral-50"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-neutral-600">
        <p>
          Page {currentPage} of {totalPages} · {totalCount}{" "}
          {totalCount === 1 ? "session" : "sessions"}
        </p>
        <div className="flex items-center gap-2">
          {currentPage > 1 ? (
            <Link
              href={
                buildHref("/admin/console", {
                  ...baseParams,
                  page: currentPage - 1,
                }) as Route
              }
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              ← Previous
            </Link>
          ) : (
            <span className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-300">
              ← Previous
            </span>
          )}
          {currentPage < totalPages ? (
            <Link
              href={
                buildHref("/admin/console", {
                  ...baseParams,
                  page: currentPage + 1,
                }) as Route
              }
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Next →
            </Link>
          ) : (
            <span className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-300">
              Next →
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function UserCell({
  name,
  email,
}: {
  name: string | null;
  email: string | null;
}) {
  if (!name && !email) {
    return <span className="text-neutral-400">—</span>;
  }
  return (
    <div>
      <div className="text-neutral-900">
        {name ?? <span className="text-neutral-400">(no name)</span>}
      </div>
      {email && <div className="text-neutral-500">{email}</div>}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function buildHref(
  base: string,
  params: Record<string, string | number>,
): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = String(v);
    if (s !== "" && s !== "0") search.set(k, s);
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}
