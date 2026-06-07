import Link from "next/link";
import type { Route } from "next";
import { requireUser } from "@/lib/auth/requireRole";
import { supabaseServer } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";

export const dynamic = "force-dynamic";

interface SessionRow {
  id: string;
  created_at: string;
  completed_at: string | null;
  stage: "started" | "recording" | "completed" | "aborted";
  duration_ms: number | null;
}

interface AnalysisIdRow {
  session_id: string;
}

/**
 * Student dashboard.
 *
 * RLS does the heavy lifting here: `select * from sessions` is automatically
 * scoped to rows where `enduser_id = auth.uid()` by the sessions_select
 * policy. We don't add an explicit `.eq()` filter because the policy is the
 * source of truth — a bug there would silently widen visibility, and we
 * want such a bug to fail closed (zero rows) rather than silently expose
 * data because the page double-filtered.
 */
export default async function StudentPage() {
  const user = await requireUser();

  const isEnduser = user.memberships.some((m) => m.role === "enduser");

  if (!isEnduser) {
    // We landed here without an enduser role. Don't redirect (the user
    // explicitly typed /student) — show a clear "no access" message with
    // a sign-out button so they can switch accounts.
    return (
      <main className="min-h-dvh bg-neutral-950 text-neutral-100">
        <div className="mx-auto max-w-2xl px-6 py-16">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold">My Interviews</h1>
            <SignOutButton />
          </div>
          <div className="mt-10 rounded-lg border border-neutral-800 bg-neutral-900/60 p-6">
            <p className="text-sm text-neutral-300">
              You&apos;re signed in as{" "}
              <span className="font-medium text-neutral-100">
                {user.profile?.display_name ?? user.email}
              </span>
              , but this account doesn&apos;t have student access to any
              organisation.
            </p>
            <p className="mt-3 text-sm text-neutral-400">
              If you think that&apos;s a mistake, ask your assessor or org
              admin to add you to the team. Otherwise, sign out and use the
              account that has the invite.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const supa = await supabaseServer();

  const { data: sessionsData, error: sessionsErr } = await supa
    .from("sessions")
    .select("id, created_at, completed_at, stage, duration_ms")
    .order("created_at", { ascending: false })
    .limit(50);

  const sessions = (sessionsData ?? []) as SessionRow[];

  // Fetch which sessions have at least one analysis row, in a single query.
  // RLS on `analyses` mirrors `sessions`, so this is automatically scoped.
  let analysedIds = new Set<string>();
  if (sessions.length > 0) {
    const ids = sessions.map((s) => s.id);
    const { data: analysesData } = await supa
      .from("analyses")
      .select("session_id")
      .in("session_id", ids);
    if (analysesData) {
      analysedIds = new Set(
        (analysesData as AnalysisIdRow[]).map((a) => a.session_id),
      );
    }
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              My Interviews
            </h1>
            <p className="mt-1 text-sm text-neutral-400">
              Signed in as{" "}
              <span className="text-neutral-200">
                {user.profile?.display_name ?? user.email}
              </span>
            </p>
          </div>
          <SignOutButton />
        </header>

        {sessionsErr ? (
          <div className="mt-8 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-200">
            Couldn&apos;t load your interviews ({sessionsErr.message}). Try
            refreshing in a moment.
          </div>
        ) : sessions.length === 0 ? (
          <div className="mt-10 rounded-lg border border-neutral-800 bg-neutral-900/60 p-8 text-center">
            <p className="text-sm text-neutral-300">
              No interviews yet. Once you complete one with your assessor,
              it&apos;ll show up here.
            </p>
          </div>
        ) : (
          <SessionsTable sessions={sessions} analysedIds={analysedIds} />
        )}
      </div>
    </main>
  );
}

function SessionsTable({
  sessions,
  analysedIds,
}: {
  sessions: SessionRow[];
  analysedIds: Set<string>;
}) {
  return (
    <div className="mt-8">
      {/* Table on >=sm, stacked cards on mobile */}
      <div className="hidden overflow-hidden rounded-lg border border-neutral-800 sm:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Stage</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800 bg-neutral-950">
            {sessions.map((s) => (
              <tr key={s.id} className="hover:bg-neutral-900/60">
                <td className="px-4 py-3 text-neutral-200">
                  {formatDate(s.created_at)}
                </td>
                <td className="px-4 py-3 text-neutral-300">
                  {formatDuration(s.duration_ms)}
                </td>
                <td className="px-4 py-3">
                  <StageBadge stage={s.stage} />
                </td>
                <td className="px-4 py-3 text-right">
                  <ActionLink
                    sessionId={s.id}
                    hasAnalysis={analysedIds.has(s.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 sm:hidden">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-neutral-100">
                  {formatDate(s.created_at)}
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  {formatDuration(s.duration_ms)}
                </div>
              </div>
              <StageBadge stage={s.stage} />
            </div>
            <div className="mt-3">
              <ActionLink
                sessionId={s.id}
                hasAnalysis={analysedIds.has(s.id)}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActionLink({
  sessionId,
  hasAnalysis,
}: {
  sessionId: string;
  hasAnalysis: boolean;
}) {
  if (!hasAnalysis) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-500"
        title="Analysis not available yet — your assessor will run it after the interview."
      >
        No analysis yet
      </span>
    );
  }
  return (
    <Link
      href={`/student/sessions/${sessionId}` as Route}
      className="inline-flex items-center rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-neutral-950"
    >
      View analysis
    </Link>
  );
}

function StageBadge({ stage }: { stage: SessionRow["stage"] }) {
  const map: Record<SessionRow["stage"], { label: string; className: string }> =
    {
      started: {
        label: "Started",
        className: "bg-neutral-800 text-neutral-300",
      },
      recording: {
        label: "Recording",
        className: "bg-amber-900/40 text-amber-200",
      },
      completed: {
        label: "Completed",
        className: "bg-emerald-900/40 text-emerald-200",
      },
      aborted: {
        label: "Aborted",
        className: "bg-red-900/40 text-red-200",
      },
    };
  const m = map[stage] ?? map.started;
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${m.className}`}
    >
      {m.label}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
