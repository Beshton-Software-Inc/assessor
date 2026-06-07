import Link from "next/link";
import type { Route } from "next";

export type AuditAction =
  | "admin_session_read"
  | "admin_analysis_read"
  | "share_view"
  | "grant_created"
  | "grant_revoked"
  | "share_token_created"
  | "share_token_used";

export const AUDIT_ACTIONS: AuditAction[] = [
  "admin_session_read",
  "admin_analysis_read",
  "share_view",
  "grant_created",
  "grant_revoked",
  "share_token_created",
  "share_token_used",
];

const ACTION_LABEL: Record<AuditAction, string> = {
  admin_session_read: "Admin session read",
  admin_analysis_read: "Admin analysis read",
  share_view: "Share view",
  grant_created: "Grant created",
  grant_revoked: "Grant revoked",
  share_token_created: "Share token created",
  share_token_used: "Share token used",
};

const ACTION_BADGE: Record<AuditAction, string> = {
  admin_session_read: "bg-violet-50 text-violet-700 border border-violet-200",
  admin_analysis_read: "bg-violet-50 text-violet-700 border border-violet-200",
  share_view: "bg-blue-50 text-blue-700 border border-blue-200",
  grant_created: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  grant_revoked: "bg-rose-50 text-rose-700 border border-rose-200",
  share_token_created: "bg-amber-50 text-amber-700 border border-amber-200",
  share_token_used: "bg-blue-50 text-blue-700 border border-blue-200",
};

export interface AuditRow {
  id: number;
  created_at: string;
  action: AuditAction;
  actor_user_id: string | null;
  target_session_id: string | null;
  target_grant_id: string | null;
  metadata: Record<string, unknown>;
  actor_display_name: string | null;
  actor_email: string | null;
}

export interface AuditFilters {
  action: AuditAction | "";
  from: string;
  to: string;
  page: number;
}

export const AUDIT_PAGE_SIZE = 50;

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

function buildHref(base: string, params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = String(v);
    if (s !== "" && s !== "0") search.set(k, s);
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Server-rendered audit log table. Filters arrive via search params; the
 * page composes the query and passes the resulting rows + total count in.
 *
 * Pagination is offset-based (page-size 50). Forwards a ?tab=audit hint so
 * the client tabs subcomponent stays on the audit panel after navigation.
 */
export function AuditLogTable({
  rows,
  totalCount,
  filters,
}: {
  rows: AuditRow[];
  totalCount: number;
  filters: AuditFilters;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / AUDIT_PAGE_SIZE));
  const currentPage = Math.max(1, filters.page);

  const baseParams: Record<string, string> = {};
  if (filters.action) baseParams.action = filters.action;
  if (filters.from) baseParams.from = filters.from;
  if (filters.to) baseParams.to = filters.to;
  baseParams.tab = "audit";

  return (
    <div>
      {/* Filter form */}
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4"
      >
        <input type="hidden" name="tab" value="audit" />
        <div className="flex flex-col">
          <label className="text-xs text-neutral-500" htmlFor="audit-action">
            Action
          </label>
          <select
            id="audit-action"
            name="action"
            defaultValue={filters.action}
            className="mt-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-neutral-500" htmlFor="audit-from">
            From
          </label>
          <input
            id="audit-from"
            type="date"
            name="from"
            defaultValue={filters.from}
            className="mt-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-neutral-500" htmlFor="audit-to">
            To
          </label>
          <input
            id="audit-to"
            type="date"
            name="to"
            defaultValue={filters.to}
            className="mt-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Filter
        </button>
        {(filters.action || filters.from || filters.to) && (
          <Link
            href={"/admin/console?tab=audit" as Route}
            className="text-xs text-neutral-500 hover:text-neutral-900"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs font-medium uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Actor</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Session</th>
              <th className="px-4 py-2">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-sm text-neutral-500"
                >
                  No audit log entries match the current filters.
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
                  <td className="px-4 py-3">
                    {r.actor_user_id ? (
                      <div>
                        <div className="text-neutral-900">
                          {r.actor_display_name ?? (
                            <span className="text-neutral-400">
                              (no name)
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {r.actor_email ?? r.actor_user_id.slice(0, 8) + "…"}
                        </div>
                      </div>
                    ) : (
                      <span className="text-neutral-400">(anonymous)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_BADGE[r.action]}`}
                    >
                      {ACTION_LABEL[r.action] ?? r.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {r.target_session_id ? (
                      <Link
                        href={
                          `/admin/console/sessions/${r.target_session_id}` as Route
                        }
                        className="text-blue-700 hover:underline"
                      >
                        {r.target_session_id.slice(0, 8)}…
                      </Link>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <MetadataCell value={r.metadata} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between text-sm text-neutral-600">
        <p>
          Page {currentPage} of {totalPages} · {totalCount}{" "}
          {totalCount === 1 ? "entry" : "entries"}
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

/**
 * Renders a JSON object as a truncated single-line preview, with a
 * <details> expander for the full body.
 */
function MetadataCell({ value }: { value: Record<string, unknown> }) {
  const keys = Object.keys(value ?? {});
  if (keys.length === 0) {
    return <span className="text-neutral-400">—</span>;
  }
  const preview = keys
    .slice(0, 2)
    .map((k) => {
      const v = value[k];
      const s =
        typeof v === "string"
          ? v.length > 16
            ? v.slice(0, 16) + "…"
            : v
          : JSON.stringify(v);
      return `${k}=${s}`;
    })
    .join(" ");
  const more = keys.length > 2 ? ` +${keys.length - 2}` : "";
  const full = JSON.stringify(value, null, 2);
  return (
    <details className="cursor-pointer">
      <summary className="font-mono text-neutral-600 hover:text-neutral-900">
        {preview}
        {more}
      </summary>
      <pre className="mt-2 max-w-xs whitespace-pre-wrap break-words rounded-md bg-neutral-50 p-2 font-mono text-xs text-neutral-700">
        {full}
      </pre>
    </details>
  );
}
