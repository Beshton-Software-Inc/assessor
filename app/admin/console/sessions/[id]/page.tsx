import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { requireUser } from "@/lib/auth/requireRole";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { signRecordingUrl } from "@/lib/sessions/download";
import type { AnalysisResult } from "@/lib/analysis/pdf";
import { logAudit } from "@/lib/audit/log";
import { SignOutButton } from "../../SignOutButton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

interface AuditRow {
  id: number;
  created_at: string;
  action: string;
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
}

/**
 * App-admin session detail.
 *
 * Render-time side effect: emits an `admin_session_read` audit row via the
 * SECURITY DEFINER `log_audit()` function. This is the entire point of the
 * surface — every privileged read is observable.
 *
 * Data sources:
 *  - sessions/analyses: admin client (cross-org) — page is already gated.
 *  - audit_log: server client (RLS audit_log_select) so the row IS our admin.
 *  - storage signed URLs: 5-minute admin-signed URLs (matches the assessor
 *    detail view's posture).
 */
export default async function AdminSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await requireUser();
  if (!user.profile?.is_app_admin) {
    redirect("/" as Route);
  }

  const admin = supabaseAdmin();

  const { data: rawSession } = await admin
    .from("sessions")
    .select(
      "id, created_at, completed_at, duration_ms, stage, recording_path, enduser_id, assessor_id, org_id, student_revoked",
    )
    .eq("id", id)
    .maybeSingle();

  if (!rawSession) notFound();
  const session = rawSession as SessionRow;

  // Fire the audit log entry. Awaited so a failure surfaces in dev logs;
  // logAudit() itself swallows errors. We also log a separate
  // admin_analysis_read entry below if an analysis row is rendered.
  await logAudit("admin_session_read", { targetSessionId: session.id });

  // Org / actor display lookups.
  const [orgRes, assessorProfRes, enduserProfRes] = await Promise.all([
    session.org_id
      ? admin
          .from("organizations")
          .select("id, name, slug")
          .eq("id", session.org_id)
          .maybeSingle()
      : Promise.resolve({ data: null as { id: string; name: string; slug: string } | null }),
    session.assessor_id
      ? admin
          .from("profiles")
          .select("display_name")
          .eq("user_id", session.assessor_id)
          .maybeSingle()
      : Promise.resolve({ data: null as { display_name: string | null } | null }),
    session.enduser_id
      ? admin
          .from("profiles")
          .select("display_name")
          .eq("user_id", session.enduser_id)
          .maybeSingle()
      : Promise.resolve({ data: null as { display_name: string | null } | null }),
  ]);

  const org = orgRes.data as { name: string; slug: string } | null;
  const assessorName =
    (assessorProfRes.data as { display_name: string | null } | null)?.display_name ?? null;
  const enduserName =
    (enduserProfRes.data as { display_name: string | null } | null)?.display_name ?? null;

  // Best-effort email lookup; bounded to two users.
  let assessorEmail: string | null = null;
  let enduserEmail: string | null = null;
  try {
    if (session.assessor_id) {
      const { data } = await admin.auth.admin.getUserById(session.assessor_id);
      assessorEmail = data?.user?.email ?? null;
    }
    if (session.enduser_id) {
      const { data } = await admin.auth.admin.getUserById(session.enduser_id);
      enduserEmail = data?.user?.email ?? null;
    }
  } catch {
    // Don't fail the page on auth.admin hiccups.
  }

  // Latest analysis (newest first).
  const { data: rawAnalyses } = await admin
    .from("analyses")
    .select("id, created_at, status, pdf_path, result")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const analysis: AnalysisRow | null =
    (rawAnalyses as AnalysisRow[] | null)?.[0] ?? null;

  if (analysis) {
    await logAudit("admin_analysis_read", {
      targetSessionId: session.id,
      metadata: { analysis_id: analysis.id },
    });
  }

  // Sign storage URLs (5 min) — same pattern the assessor view uses.
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

  // Audit-log entries for this session. Goes through supabaseServer() so
  // audit_log_select RLS gates it (we are app_admin).
  const supa = await supabaseServer();
  const { data: auditRowsRaw } = await supa
    .from("audit_log")
    .select("id, created_at, action, actor_user_id, metadata")
    .eq("target_session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const auditRows = (auditRowsRaw ?? []) as AuditRow[];

  // Resolve audit-actor display names in one pass.
  const actorIds = Array.from(
    new Set(auditRows.map((r) => r.actor_user_id).filter((v): v is string => Boolean(v))),
  );
  const actorNames = new Map<string, string | null>();
  if (actorIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", actorIds);
    for (const p of (profiles ?? []) as { user_id: string; display_name: string | null }[]) {
      actorNames.set(p.user_id, p.display_name);
    }
  }

  return (
    <main className="min-h-dvh bg-neutral-50">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href={"/admin/console?tab=sessions" as Route}
              className="text-sm text-neutral-500 hover:text-neutral-900"
            >
              ← Back to console
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-neutral-900">
              Session {session.id.slice(0, 8)}…
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              {formatDate(session.created_at)} · Stage: {session.stage} ·
              Duration: {formatDuration(session.duration_ms)}
              {session.student_revoked && (
                <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 border border-rose-200">
                  Student revoked
                </span>
              )}
            </p>
          </div>
          <SignOutButton />
        </div>

        <section className="mt-6 grid gap-3 rounded-2xl border border-neutral-200 bg-white p-5 sm:grid-cols-3">
          <Field label="Org">
            {org ? (
              <span>
                {org.name}{" "}
                <span className="font-mono text-xs text-neutral-500">
                  ({org.slug})
                </span>
              </span>
            ) : (
              <span className="text-neutral-400">—</span>
            )}
          </Field>
          <Field label="Assessor">
            <UserDisplay name={assessorName} email={assessorEmail} />
          </Field>
          <Field label="Student">
            <UserDisplay name={enduserName} email={enduserEmail} />
          </Field>
        </section>

        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5">
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
          </div>

          {analysis && analysis.status === "ok" ? (
            <AnalysisView result={analysis.result} pdfUrl={pdfUrl} />
          ) : analysis ? (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Last run did not complete cleanly: {analysis.status}.
            </p>
          ) : (
            <p className="mt-4 text-sm text-neutral-500">
              No analysis has been generated for this session.
            </p>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-700">
            Audit history
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            All audit_log entries that target this session. The current view
            itself was logged as <code className="font-mono">admin_session_read</code>.
          </p>
          {auditRows.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">No entries yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    <th className="py-2 pr-4">When</th>
                    <th className="py-2 pr-4">Actor</th>
                    <th className="py-2 pr-4">Action</th>
                    <th className="py-2 pr-4">Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-neutral-100 last:border-b-0 align-top"
                    >
                      <td className="py-2 pr-4 whitespace-nowrap text-neutral-700">
                        {formatDate(r.created_at)}
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {r.actor_user_id ? (
                          <span className="text-neutral-700">
                            {actorNames.get(r.actor_user_id) ?? (
                              <span className="font-mono text-xs text-neutral-500">
                                {r.actor_user_id.slice(0, 8)}…
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-neutral-400">(anonymous)</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {r.action}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-neutral-600">
                        {Object.keys(r.metadata ?? {}).length > 0 ? (
                          <code>{JSON.stringify(r.metadata)}</code>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-sm text-neutral-900">{children}</div>
    </div>
  );
}

function UserDisplay({
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
      {name && <div className="text-neutral-900">{name}</div>}
      {email && <div className="text-xs text-neutral-500">{email}</div>}
    </div>
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
        <ListBlock
          title="Follow-up questions"
          items={result.follow_up_questions}
        />
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
