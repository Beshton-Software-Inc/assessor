import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import type { Route } from "next";
import { getUser } from "@/lib/auth/getUser";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { signRecordingUrl } from "@/lib/sessions/download";
import type { AnalysisResult } from "@/lib/analysis/pdf";
import { RunAnalysisButton } from "../../RunAnalysisButton";
import { UserMenu } from "@/components/UserMenu";

export const dynamic = "force-dynamic";

interface SessionRow {
  id: string;
  created_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  stage: string;
  recording_path: string | null;
  enduser_id: string | null;
  assessor_id: string | null;
  org_id: string | null;
  student_revoked: boolean;
}

interface AnalysisRow {
  id: string;
  created_at: string;
  status: string;
  pdf_path: string | null;
  result: AnalysisResult;
}

/**
 * Single-session detail view for an assessor.
 *
 * Visibility is enforced by RLS sessions_select (assessor_id = auth.uid()
 * and not student_revoked, OR enduser_id = auth.uid(), OR app_admin). If
 * the row is hidden the .single() returns no row and we 404 — we do NOT
 * disclose the difference between "doesn't exist" and "you can't see it",
 * because doing so would leak the existence of sessions in other orgs.
 *
 * Storage URLs (recording webm + analysis PDF) are signed via the admin
 * client AFTER the RLS read confirmed access; that's the same pattern the
 * download/upload-url routes use.
 */
export default async function AssessorSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getUser();
  if (!user) redirect("/login" as Route);

  const isAssessor = user.memberships.some(
    (m) => m.role === "assessor" || m.role === "org_admin",
  );
  if (!isAssessor) redirect("/login" as Route);

  const supa = await supabaseServer();
  const { data: rawSession } = await supa
    .from("sessions")
    .select(
      "id, created_at, completed_at, duration_ms, stage, recording_path, enduser_id, assessor_id, org_id, student_revoked",
    )
    .eq("id", id)
    .maybeSingle();

  if (!rawSession) notFound();
  const session = rawSession as SessionRow;

  const admin = supabaseAdmin();

  // Look up the student display name (RLS on profiles would also let us
  // see same-org members, but we already filtered by RLS on sessions —
  // re-do the lookup via admin to avoid an extra org_members hop).
  let studentName: string | null = null;
  if (session.enduser_id) {
    const { data: prof } = await admin
      .from("profiles")
      .select("display_name")
      .eq("user_id", session.enduser_id)
      .maybeSingle();
    studentName = (prof as { display_name: string | null } | null)?.display_name ?? null;
  }

  // Latest analysis row, if any. Newest first; status === 'ok' is the
  // green path. Older retried rows still appear as a warning so the
  // assessor knows the run failed before retrying.
  const { data: rawAnalyses } = await admin
    .from("analyses")
    .select("id, created_at, status, pdf_path, result")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const analysis: AnalysisRow | null =
    (rawAnalyses as AnalysisRow[] | null)?.[0] ?? null;

  // Sign the recording URL (5 min) and PDF URL only after RLS approved.
  let recordingUrl: string | null = null;
  if (session.recording_path) {
    try {
      recordingUrl = await signRecordingUrl(admin, session.recording_path, 300);
    } catch {
      recordingUrl = null;
    }
  }

  let pdfUrl: string | null = null;
  if (analysis?.pdf_path) {
    try {
      pdfUrl = await signRecordingUrl(admin, analysis.pdf_path, 300);
    } catch {
      pdfUrl = null;
    }
  }

  const canAnalyse = session.stage === "completed" && !!session.recording_path;
  const studentDisplay =
    studentName ??
    (session.enduser_id ? `Student ${session.enduser_id.slice(0, 8)}…` : "—");

  return (
    <main className="min-h-dvh bg-neutral-50">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href={"/assessor" as Route}
              className="text-sm text-neutral-500 hover:text-neutral-900"
            >
              ← Back to dashboard
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-neutral-900">
              Interview with {studentDisplay}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              {formatDate(session.created_at)} · Stage: {session.stage} ·
              Duration: {formatDuration(session.duration_ms)}
            </p>
          </div>
          <UserMenu
            displayName={user.profile?.display_name}
            email={user.email}
          />
        </div>

        <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-700">Recording</h2>
          {recordingUrl ? (
            <video
              key={recordingUrl}
              src={recordingUrl}
              controls
              playsInline
              className="mt-3 w-full rounded-lg bg-black"
            />
          ) : (
            <p className="mt-3 text-sm text-neutral-500">
              {session.recording_path
                ? "Could not load recording (signed URL failed)."
                : "No recording available for this session yet."}
            </p>
          )}
          {recordingUrl && (
            <p className="mt-2 text-xs text-neutral-400">
              <Link
                href={`/api/sessions/${session.id}/mp4` as Route}
                className="hover:text-neutral-700"
              >
                Download as mp4
              </Link>
            </p>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-neutral-700">
                Gemini analysis
              </h2>
              {analysis ? (
                <p className="mt-1 text-xs text-neutral-500">
                  Run {formatDate(analysis.created_at)} · Status: {analysis.status}
                </p>
              ) : (
                <p className="mt-1 text-xs text-neutral-500">
                  No analysis run yet.
                </p>
              )}
            </div>
            {!analysis || analysis.status !== "ok" ? (
              <RunAnalysisButton
                sessionId={session.id}
                variant="block"
                disabled={!canAnalyse}
              />
            ) : null}
          </div>

          {analysis && analysis.status === "ok" ? (
            <AnalysisView
              result={analysis.result}
              pdfUrl={pdfUrl}
            />
          ) : analysis ? (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Last run did not complete cleanly: {analysis.status}. You can run
              the analysis again.
            </p>
          ) : !canAnalyse ? (
            <p className="mt-4 text-sm text-neutral-500">
              Analysis can run once the recording finishes uploading.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function AnalysisView({
  result,
  pdfUrl,
}: {
  result: AnalysisResult;
  pdfUrl: string | null;
}) {
  return (
    <div className="mt-4 space-y-4 text-sm text-neutral-800">
      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Download PDF
        </a>
      )}

      {result.student_summary && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Summary
          </h3>
          <p className="mt-1 leading-relaxed">{result.student_summary}</p>
        </div>
      )}

      {result.interview_overview && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Overview
          </h3>
          <p className="mt-1 leading-relaxed">{result.interview_overview}</p>
        </div>
      )}

      {result.strengths && result.strengths.length > 0 && (
        <ListBlock title="Strengths" items={result.strengths} />
      )}
      {result.growth_areas && result.growth_areas.length > 0 && (
        <ListBlock title="Growth areas" items={result.growth_areas} />
      )}
      {result.follow_up_questions && result.follow_up_questions.length > 0 && (
        <ListBlock title="Follow-up questions" items={result.follow_up_questions} />
      )}

      {result.scores && Object.keys(result.scores).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Scores
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {Object.entries(result.scores).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-neutral-600">{k}</dt>
                <dd className="font-medium text-neutral-900">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h3>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
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
