import Link from "next/link";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getUser } from "@/lib/auth/getUser";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { RunAnalysisButton } from "./RunAnalysisButton";
import { SignOutButton } from "./SignOutButton";

export const dynamic = "force-dynamic";

interface SessionRow {
  id: string;
  created_at: string;
  duration_ms: number | null;
  stage: string;
  enduser_id: string | null;
  org_id: string | null;
  recording_path: string | null;
}

interface ProfileRow {
  user_id: string;
  display_name: string | null;
}

/**
 * Assessor dashboard.
 *
 * Auth model: an authenticated user is authorised to see this page if they
 * are an "assessor" or "org_admin" member of at least one org. Otherwise we
 * render a no-access screen with a sign-out (rather than redirecting to a
 * different dashboard, to avoid loops if requireRole's landing logic ever
 * disagrees on the same user).
 *
 * Data:
 *   1. sessions WHERE assessor_id = auth.uid() (RLS does the filter; we just
 *      run the query through supabaseServer()).
 *   2. profiles for every distinct enduser_id we saw, joined client-side
 *      because PostgREST embedding requires a declared FK and we have one
 *      via auth.users which the public schema can't traverse directly.
 *   3. analyses with session_id IN (...) so we know which sessions already
 *      have a completed analysis.
 *
 * Both (2) and (3) read via supabaseAdmin() because the assessor's RLS
 * scope on profiles is "same-org members" and on analyses is "sessions you
 * can see" — both of which would work, but the admin client is simpler
 * and avoids an extra join through org_members at render time. The SECURITY
 * predicate is already enforced on (1); (2)/(3) only fan out from those ids.
 */
export default async function AssessorPage() {
  const user = await getUser();
  if (!user) redirect("/login" as Route);

  const isAssessor = user.memberships.some(
    (m) => m.role === "assessor" || m.role === "org_admin",
  );
  if (!isAssessor) {
    return <NoAccess displayName={user.profile?.display_name ?? user.email} />;
  }

  const supa = await supabaseServer();
  const { data: rawSessions, error: sessErr } = await supa
    .from("sessions")
    .select("id, created_at, duration_ms, stage, enduser_id, org_id, recording_path")
    .eq("assessor_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const sessions: SessionRow[] = (rawSessions as SessionRow[] | null) ?? [];

  // Sidecar lookups via the admin client. Both queries are scoped to ids
  // we already proved the user can see, so privilege escalation isn't a risk.
  const admin = supabaseAdmin();

  const enduserIds = Array.from(
    new Set(sessions.map((s) => s.enduser_id).filter((v): v is string => !!v)),
  );
  const sessionIds = sessions.map((s) => s.id);

  const [profilesRes, analysesRes] = await Promise.all([
    enduserIds.length
      ? admin
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", enduserIds)
      : Promise.resolve({ data: [] as ProfileRow[], error: null }),
    sessionIds.length
      ? admin
          .from("analyses")
          .select("session_id, status")
          .in("session_id", sessionIds)
      : Promise.resolve({ data: [] as { session_id: string; status: string }[], error: null }),
  ]);

  const profileById = new Map<string, string>();
  for (const p of (profilesRes.data ?? []) as ProfileRow[]) {
    if (p.display_name) profileById.set(p.user_id, p.display_name);
  }
  const analyzedSessionIds = new Set<string>();
  for (const a of (analysesRes.data ?? []) as { session_id: string; status: string }[]) {
    // Only count "ok" analyses as completed; partial/failed runs should still
    // expose a Run button so the assessor can retry.
    if (a.status === "ok") analyzedSessionIds.add(a.session_id);
  }

  const displayName = user.profile?.display_name ?? user.email ?? "Assessor";

  return (
    <main className="min-h-dvh bg-neutral-50">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-neutral-500">Assessor dashboard</p>
            <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
              Welcome, {displayName}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={"/assessor/start" as Route}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Start new interview
            </Link>
            <SignOutButton />
          </div>
        </div>

        {sessErr && (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Failed to load sessions: {sessErr.message}
          </p>
        )}

        <section className="mt-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 px-5 py-3">
            <h2 className="text-sm font-medium text-neutral-700">
              Your interviews{" "}
              <span className="text-neutral-400">({sessions.length})</span>
            </h2>
          </div>

          {sessions.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-neutral-500">
              No interviews yet. Use “Start new interview” above to begin.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <Th>Date</Th>
                    <Th>Student</Th>
                    <Th>Duration</Th>
                    <Th>Stage</Th>
                    <Th>Analysis</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {sessions.map((s) => {
                    const studentName =
                      (s.enduser_id && profileById.get(s.enduser_id)) ||
                      (s.enduser_id ? `Student ${s.enduser_id.slice(0, 8)}…` : "—");
                    const analysed = analyzedSessionIds.has(s.id);
                    const canAnalyse = s.stage === "completed" && !!s.recording_path;

                    return (
                      <tr key={s.id} className="hover:bg-neutral-50">
                        <Td>{formatDate(s.created_at)}</Td>
                        <Td className="font-medium text-neutral-900">{studentName}</Td>
                        <Td>{formatDuration(s.duration_ms)}</Td>
                        <Td>
                          <StageBadge stage={s.stage} />
                        </Td>
                        <Td>
                          {analysed ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                              Completed
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-200">
                              Not run
                            </span>
                          )}
                        </Td>
                        <Td className="text-right">
                          <div className="inline-flex items-center gap-2">
                            <Link
                              href={`/assessor/sessions/${s.id}` as Route}
                              className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                            >
                              View
                            </Link>
                            {!analysed && (
                              <RunAnalysisButton
                                sessionId={s.id}
                                disabled={!canAnalyse}
                              />
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function NoAccess({ displayName }: { displayName: string | null }) {
  return (
    <main className="min-h-dvh flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">No access</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {displayName
            ? `${displayName}, your account is not an assessor in any organization.`
            : "Your account is not an assessor in any organization."}{" "}
          Contact your org admin if you believe this is a mistake.
        </p>
        <div className="mt-6 flex justify-center">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-left font-medium ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-4 py-3 text-neutral-700 ${className ?? ""}`}>{children}</td>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const tone =
    stage === "completed"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : stage === "recording"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : stage === "aborted"
      ? "bg-red-50 text-red-700 ring-red-200"
      : "bg-neutral-100 text-neutral-600 ring-neutral-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}
    >
      {stage}
    </span>
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
