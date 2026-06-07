import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/getUser";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { resolveShareToken } from "@/lib/sharing/tokens";
import { logAudit } from "@/lib/audit/log";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

interface AnalysisResult {
  student_summary?: string;
  interview_overview?: string;
  scores?: Record<string, number>;
  strengths?: string[];
  growth_areas?: string[];
  key_quotes?: Array<{ quote?: string; approx_time?: string }>;
  follow_up_questions?: string[];
  topics?: string[];
  confidence?: number;
  [key: string]: unknown;
}

interface AnalysisRow {
  id: string;
  session_id: string;
  created_at: string;
  model: string;
  pdf_path: string | null;
  result: AnalysisResult;
  status: string;
}

interface SessionRow {
  id: string;
  created_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  recording_path: string | null;
  stage: "started" | "recording" | "completed" | "aborted";
}

/**
 * Public share consumer page.
 *
 * NOT gated by middleware (the /share/* prefix is intentionally outside
 * PROTECTED_PREFIXES). We do require a signed-in user before exposing any
 * content though — sharing is "I am giving access to a known account",
 * not "I am publishing publicly". The redirect-to-login pattern preserves
 * the original /share/<token> URL via the ?next= param.
 *
 * After login the resolver runs against the SECURITY DEFINER SQL helper
 * (resolve_share_token); whatever scope the grant holds determines what
 * we render:
 *   - 'analysis' : same analysis view that students/assessors see, plus
 *                  the signed PDF link. No recording.
 *   - 'full'     : analysis view plus a "Download recording" button that
 *                  hits /api/sessions/[id]/mp4. The mp4 route's session
 *                  read goes through supabaseServer() RLS, which has been
 *                  widened to honor has_session_access — the active grant
 *                  the viewer is consuming is exactly that predicate.
 *
 * Audit: every successful render writes a `share_view` row stamped with
 * the viewer's auth.uid(). Token is never echoed to the audit row in
 * full — only a 6-char prefix for debugging.
 */
export default async function SharePage({ params }: PageProps) {
  const { token } = await params;

  // Step 1: require a signed-in user. Don't even resolve the token before
  // we have an authenticated viewer; that way the share_view audit row
  // is always attributable.
  const user = await getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/share/${token}`)}`);
  }

  // Step 2: resolve the token. We call the SQL helper directly via the
  // admin client to avoid a same-host HTTP hop. The helper is SECURITY
  // DEFINER and treats invalid/expired/revoked tokens uniformly.
  const admin = supabaseAdmin();
  const resolved = await resolveShareToken(admin, token);
  if (!resolved) {
    return <InvalidShareLink />;
  }

  const { sessionId, scope } = resolved;

  // Look up the underlying grant row so we can attribute the audit entry
  // and render "shared by <granter>". This uses the admin client because
  // the viewer might not have RLS-visibility into session_grants until
  // we've actually used the grant; the resolved token already proves the
  // grant exists and is active.
  const { data: grantRow } = await admin
    .from("session_grants")
    .select("id, granted_by_user_id, share_label")
    .eq("share_token", token)
    .maybeSingle();

  const grantId = (grantRow?.id as string | undefined) ?? null;
  const granterUserId = (grantRow?.granted_by_user_id as string | undefined) ?? null;
  const shareLabel = (grantRow?.share_label as string | null | undefined) ?? null;

  // Resolve the granter's display name. Best-effort — if the lookup fails
  // we just say "a colleague".
  let granterName: string | null = null;
  if (granterUserId) {
    const { data: granterProfile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("user_id", granterUserId)
      .maybeSingle();
    granterName =
      (granterProfile?.display_name as string | null | undefined) ?? null;
  }

  // Step 3: fetch the session + latest analysis. We use supabaseServer()
  // here so the read is RLS-scoped to the viewer; the grant row above is
  // exactly what makes has_session_access(sessionId, 'analysis') true,
  // so this select returns the row.
  const supa = await supabaseServer();
  const { data: sessionData, error: sessionErr } = await supa
    .from("sessions")
    .select("id, created_at, completed_at, duration_ms, recording_path, stage")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr || !sessionData) {
    // Defensive: the token resolved but the session is invisible. This
    // shouldn't happen in practice (the grant predicate should let it
    // through), but if it does, treat it as an invalid share rather than
    // disclosing the underlying RLS failure.
    return <InvalidShareLink />;
  }
  const session = sessionData as SessionRow;

  const { data: analysesData } = await supa
    .from("analyses")
    .select("id, session_id, created_at, model, pdf_path, result, status")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = (analysesData ?? [])[0] as AnalysisRow | undefined;

  // Step 4: log the share_view. Fire-and-forget — never block render on
  // an audit failure. Using supabaseServer() so actor_user_id picks up
  // the viewer's auth.uid().
  await logAudit("share_view", {
    targetSessionId: sessionId,
    targetGrantId: grantId,
    metadata: {
      token_prefix: token.slice(0, 6),
      scope,
    },
    client: supa,
  });

  // Mint a short-lived signed URL for the analysis PDF. Storage is not
  // RLS-gated for our bucket; the signed URL is the access mechanism.
  let pdfUrl: string | null = null;
  if (latest?.pdf_path) {
    const { data: signed } = await admin.storage
      .from(serverEnv.recordingsBucket())
      .createSignedUrl(latest.pdf_path, 300);
    pdfUrl = signed?.signedUrl ?? null;
  }

  // For 'full' scope we expose the recording. We don't sign the WebM
  // directly because the canonical viewer endpoint (/api/sessions/[id]/mp4)
  // re-checks the caller's grant scope on its own and streams an mp4. The
  // download URL is just that route — the browser carries the auth cookie
  // automatically.
  const recordingDownloadUrl =
    scope === "full" && session.recording_path
      ? `/api/sessions/${session.id}/mp4`
      : null;

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-indigo-400">
            Shared interview
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Interview analysis
          </h1>
          <p className="text-xs text-neutral-500">
            {formatDate(session.created_at)} ·{" "}
            {formatDuration(session.duration_ms)} · session{" "}
            <code className="font-mono text-[11px]">
              {session.id.slice(0, 8)}
            </code>
          </p>
          <p className="text-xs text-neutral-500">
            Shared with you by{" "}
            <span className="text-neutral-300">
              {granterName ?? "a colleague"}
            </span>
            {shareLabel ? (
              <>
                {" "}
                · <span className="text-neutral-400">“{shareLabel}”</span>
              </>
            ) : null}
            {" · viewing as "}
            <span className="text-neutral-300">{user.email}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <ScopeBadge scope={scope} />
            {recordingDownloadUrl ? (
              <a
                href={recordingDownloadUrl}
                className="inline-flex items-center rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-neutral-950"
              >
                Download recording (.mp4)
              </a>
            ) : null}
          </div>
        </header>

        {!latest ? (
          <div className="mt-10 rounded-lg border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-300">
            No analysis is available for this interview yet.
          </div>
        ) : latest.status !== "ok" ? (
          <div className="mt-10 rounded-lg border border-amber-900/50 bg-amber-950/30 p-6 text-sm text-amber-100">
            <div className="font-medium">Partial result</div>
            <p className="mt-1 text-amber-200/80">{latest.status}</p>
          </div>
        ) : (
          <AnalysisView analysis={latest} pdfUrl={pdfUrl} />
        )}

        <footer className="mt-16 border-t border-neutral-800 pt-6 text-xs text-neutral-500">
          <p>
            This page is a private share link. Treat the URL as sensitive — anyone
            you forward it to who has an account will be able to view this content.
          </p>
          <p className="mt-2">
            <Link href="/" className="text-neutral-400 hover:text-neutral-200">
              ← Back to home
            </Link>
          </p>
        </footer>
      </div>
    </main>
  );
}

function ScopeBadge({ scope }: { scope: "analysis" | "full" }) {
  if (scope === "full") {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-700/60 bg-emerald-950/40 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
        Full · analysis + recording
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-indigo-700/60 bg-indigo-950/40 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-300">
      Analysis only
    </span>
  );
}

function InvalidShareLink() {
  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8 sm:px-6">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-8">
          <h1 className="text-xl font-semibold tracking-tight">
            This share link is invalid or has expired
          </h1>
          <p className="mt-3 text-sm text-neutral-400">
            The link you followed is no longer active. Ask the person who shared
            it to send you a new link.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-700"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}

function AnalysisView({
  analysis,
  pdfUrl,
}: {
  analysis: AnalysisRow;
  pdfUrl: string | null;
}) {
  const r = analysis.result ?? {};
  return (
    <div className="mt-8 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-xs text-neutral-400">
        <div>
          Generated {formatDate(analysis.created_at)} · model{" "}
          <code className="font-mono text-[11px]">{analysis.model}</code>
          {typeof r.confidence === "number" ? (
            <>
              {" "}
              · confidence{" "}
              <span className="text-neutral-200">{r.confidence.toFixed(2)}</span>
            </>
          ) : null}
        </div>
        {pdfUrl ? (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-neutral-950"
          >
            Download PDF
          </a>
        ) : (
          <span className="text-neutral-500">PDF not available</span>
        )}
      </div>

      {r.student_summary ? (
        <Section title="Summary">
          <p className="text-sm leading-relaxed text-neutral-200 whitespace-pre-wrap">
            {r.student_summary}
          </p>
        </Section>
      ) : null}

      {r.interview_overview ? (
        <Section title="Interview overview">
          <p className="text-sm leading-relaxed text-neutral-200 whitespace-pre-wrap">
            {r.interview_overview}
          </p>
        </Section>
      ) : null}

      {r.scores && Object.keys(r.scores).length > 0 ? (
        <Section title="Scores">
          <ScoresGrid scores={r.scores} />
        </Section>
      ) : null}

      {r.strengths && r.strengths.length > 0 ? (
        <Section title="Strengths">
          <ul className="space-y-2 text-sm text-neutral-200">
            {r.strengths.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {r.growth_areas && r.growth_areas.length > 0 ? (
        <Section title="Growth areas">
          <ul className="space-y-2 text-sm text-neutral-200">
            {r.growth_areas.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {r.key_quotes && r.key_quotes.length > 0 ? (
        <Section title="Key quotes">
          <ul className="space-y-3">
            {r.key_quotes.map((q, i) => (
              <li
                key={i}
                className="rounded-md border-l-2 border-indigo-500/60 bg-neutral-900/60 px-4 py-3"
              >
                <p className="text-sm italic text-neutral-200">
                  {q.quote ? `“${q.quote}”` : ""}
                </p>
                {q.approx_time ? (
                  <p className="mt-1 text-xs text-neutral-500">
                    ~ {q.approx_time}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {r.follow_up_questions && r.follow_up_questions.length > 0 ? (
        <Section title="Follow-up questions">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-neutral-200 marker:text-neutral-500">
            {r.follow_up_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </Section>
      ) : null}

      {r.topics && r.topics.length > 0 ? (
        <Section title="Topics">
          <div className="flex flex-wrap gap-2">
            {r.topics.map((t, i) => (
              <span
                key={i}
                className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-0.5 text-xs text-neutral-300"
              >
                {t}
              </span>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ScoresGrid({ scores }: { scores: Record<string, number> }) {
  const entries = Object.entries(scores);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {entries.map(([label, value]) => (
        <div
          key={label}
          className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-neutral-300">
              {humanise(label)}
            </span>
            <span className="text-sm font-semibold tabular-nums text-neutral-100">
              {formatScore(value)}
            </span>
          </div>
          <ScoreBar value={value} />
        </div>
      ))}
    </div>
  );
}

function ScoreBar({ value }: { value: number }) {
  let pct: number;
  if (value <= 1) pct = value * 100;
  else if (value <= 10) pct = value * 10;
  else if (value <= 100) pct = value;
  else pct = 100;
  pct = Math.max(0, Math.min(100, pct));
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
      <div
        className="h-full rounded-full bg-indigo-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function formatScore(v: number): string {
  if (v <= 1) return v.toFixed(2);
  if (v <= 10) return v.toFixed(1);
  return Math.round(v).toString();
}

function humanise(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
