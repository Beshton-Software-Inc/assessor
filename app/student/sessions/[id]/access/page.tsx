import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { listGrantsForSession, type GrantRow } from "@/lib/sharing/grants";
import { UserMenu } from "@/components/UserMenu";
import { RevokeButton } from "./RevokeButton";
import { CreateShareLinkForm } from "./CreateShareLinkForm";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface SessionRow {
  id: string;
  enduser_id: string;
  created_at: string;
  stage: string;
}

interface GranteeInfo {
  email: string | null;
  display_name: string | null;
}

/**
 * Student "Manage access" surface.
 *
 * Auth: requireRole('enduser') — also asserts enduser_id = auth.uid() on the
 * session row via supabaseServer() (RLS-scoped). If the session isn't visible
 * (or the caller isn't the enduser), notFound() — never leak existence.
 *
 * Rendered cards:
 *   1. Active grants — per-user grants (grantee_user_id NOT NULL).
 *   2. Share links — token-based grants (share_token NOT NULL).
 *   3. Create share link form.
 *
 * Per the architect plan we never re-render existing share-link tokens after
 * creation: the table shows label/scope/expiry/revoke only; the URL appears
 * exactly once, in the create-flow toast. Students who lose a token must
 * revoke and recreate.
 */
export default async function StudentAccessPage({ params }: PageProps) {
  const { id: sessionId } = await params;
  const user = await requireRole("enduser");

  const supa = await supabaseServer();

  // RLS-scoped read: enduser-only or app_admin. We then additionally require
  // enduser_id = me so an app_admin who happens to land here doesn't get a
  // student-flavoured UI for someone else's session.
  const { data: session } = await supa
    .from("sessions")
    .select("id, enduser_id, created_at, stage")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    notFound();
  }
  const sessionRow = session as SessionRow;
  if (sessionRow.enduser_id !== user.id) {
    notFound();
  }

  // List every grant on this session (RLS-scoped; the enduser policy returns
  // them all). Filter to active rows for display — revoked rows are kept out
  // to keep the UI focused. Audit log retains the history.
  const allGrants = await listGrantsForSession(supa, sessionId);
  const activeGrants = allGrants.filter((g) => g.revoked_at == null);

  const userGrants = activeGrants.filter(
    (g) => g.grantee_user_id != null && g.share_token == null,
  );
  const shareGrants = activeGrants.filter((g) => g.share_token != null);

  // Resolve grantee email + display_name for the per-user grants. We use the
  // service-role client because profiles is RLS'd to is_app_admin OR self,
  // and auth.users is never client-readable. The grantee user_ids came from
  // RLS-scoped grants we already loaded, so this is just a lookup hop.
  const granteeMap = await loadGrantees(
    userGrants.map((g) => g.grantee_user_id!).filter(Boolean),
  );

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex items-start justify-between gap-4">
          <div>
            <Link
              href={{ pathname: `/student/sessions/${sessionRow.id}` }}
              className="text-xs text-neutral-400 hover:text-neutral-200"
            >
              &larr; Back to interview
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Manage access
            </h1>
            <p className="mt-1 text-xs text-neutral-500">
              Session{" "}
              <code className="font-mono text-[11px]">
                {sessionRow.id.slice(0, 8)}
              </code>{" "}
              · created {formatDate(sessionRow.created_at)}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Signed in as{" "}
              <span className="text-neutral-300">
                {user.profile?.display_name ?? user.email}
              </span>
            </p>
          </div>
          <UserMenu
            displayName={user.profile?.display_name}
            email={user.email}
          />
        </header>

        <p className="mt-6 max-w-2xl text-sm text-neutral-300">
          Choose who can view your interview analysis or recording. You can
          revoke any grant at any time — access is removed immediately.
        </p>

        {/* ------------------------------ People with access ------------------ */}
        <section className="mt-10">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              People with access
            </h2>
            <span className="text-xs text-neutral-500">
              {userGrants.length} active
            </span>
          </div>

          {userGrants.length === 0 ? (
            <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-400">
              You haven&apos;t shared this interview with anyone individually.
              Use the share-link form below to create a copy-paste link.
            </div>
          ) : (
            <div className="mt-3 overflow-hidden rounded-lg border border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-900/60 text-[11px] uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Person</th>
                    <th className="px-4 py-2 font-medium">Scope</th>
                    <th className="px-4 py-2 font-medium">Expires</th>
                    <th className="px-4 py-2 font-medium">Granted</th>
                    <th className="px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800 bg-neutral-950/40">
                  {userGrants.map((g) => {
                    const info = granteeMap.get(g.grantee_user_id!) ?? null;
                    const display =
                      info?.display_name ?? info?.email ?? "Unknown user";
                    return (
                      <tr key={g.id}>
                        <td className="px-4 py-3 align-top">
                          <div className="text-neutral-100">{display}</div>
                          {info?.email && info.email !== display ? (
                            <div className="text-xs text-neutral-500">
                              {info.email}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <ScopeBadge scope={g.scope} />
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-neutral-400">
                          {formatExpiry(g.expires_at)}
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-neutral-400">
                          {formatDate(g.created_at)}
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <RevokeButton
                            sessionId={sessionId}
                            grantId={g.id}
                            kind="user"
                            label={info?.email ?? info?.display_name}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ------------------------------ Share links ------------------------- */}
        <section className="mt-10">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Share links
            </h2>
            <span className="text-xs text-neutral-500">
              {shareGrants.length} active
            </span>
          </div>

          {shareGrants.length === 0 ? (
            <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-400">
              No share links yet. Create one below to get a URL you can paste
              into a message.
            </div>
          ) : (
            <div className="mt-3 overflow-hidden rounded-lg border border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-900/60 text-[11px] uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Label</th>
                    <th className="px-4 py-2 font-medium">Scope</th>
                    <th className="px-4 py-2 font-medium">Expires</th>
                    <th className="px-4 py-2 font-medium">Created</th>
                    <th className="px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800 bg-neutral-950/40">
                  {shareGrants.map((g) => (
                    <tr key={g.id}>
                      <td className="px-4 py-3 align-top">
                        <div className="text-neutral-100">
                          {g.share_label ?? (
                            <span className="text-neutral-500">
                              (no label)
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-neutral-600">
                          token …{g.share_token!.slice(-6)}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <ScopeBadge scope={g.scope} />
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-neutral-400">
                        {formatExpiry(g.expires_at)}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-neutral-400">
                        {formatDate(g.created_at)}
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <RevokeButton
                          sessionId={sessionId}
                          grantId={g.id}
                          kind="share"
                          label={g.share_label}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-neutral-800 bg-neutral-900/40 px-4 py-2 text-[11px] text-neutral-500">
                Live tokens are not shown here for security — they are only
                displayed once when you create them.
              </p>
            </div>
          )}
        </section>

        {/* ------------------------------ Create share link ------------------- */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Create share link
          </h2>
          <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
            <CreateShareLinkForm sessionId={sessionId} />
          </div>
        </section>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function loadGrantees(userIds: string[]): Promise<Map<string, GranteeInfo>> {
  const map = new Map<string, GranteeInfo>();
  if (userIds.length === 0) return map;

  const admin = supabaseAdmin();
  const unique = Array.from(new Set(userIds));

  // profiles for display_name (no email column there)
  const { data: profileRows } = await admin
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", unique);
  for (const row of (profileRows ?? []) as Array<{
    user_id: string;
    display_name: string | null;
  }>) {
    map.set(row.user_id, {
      email: null,
      display_name: row.display_name ?? null,
    });
  }

  // auth.users for email — admin.listUsers paginates, so look each up directly.
  // Small N (the page caps at a few grants); a sequential loop is fine.
  await Promise.all(
    unique.map(async (uid) => {
      const { data, error } = await admin.auth.admin.getUserById(uid);
      if (error || !data?.user) return;
      const existing = map.get(uid) ?? { email: null, display_name: null };
      map.set(uid, {
        email: data.user.email ?? null,
        display_name: existing.display_name,
      });
    }),
  );

  return map;
}

function ScopeBadge({ scope }: { scope: GrantRow["scope"] }) {
  if (scope === "full") {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-800/60 bg-amber-950/40 px-2 py-0.5 text-[11px] font-medium text-amber-200">
        Full (recording)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-indigo-800/60 bg-indigo-950/40 px-2 py-0.5 text-[11px] font-medium text-indigo-200">
      Analysis only
    </span>
  );
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (d.getTime() < Date.now()) return "Expired";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
