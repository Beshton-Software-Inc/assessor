import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/requireRole";
import { supabaseServer } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { SignOutButton } from "../../SignOutButton";

export const dynamic = "force-dynamic";

interface SessionRow {
  id: string;
  created_at: string;
  completed_at: string | null;
  stage: "started" | "recording" | "completed" | "aborted";
  duration_ms: number | null;
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

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Student session detail page. Renders the latest analysis row for a given
 * session, plus a download link for the PDF.
 *
 * Visibility relies entirely on RLS:
 *   - sessions_select gates the session lookup (must be enduser_id = me).
 *   - analyses_select piggybacks on the same predicate.
 * If the session doesn't exist OR the user isn't the enduser, both reads
 * return zero rows and we render notFound() — not a 403, because surfacing
 * "this session exists but you can't see it" leaks metadata.
 */
export default async function StudentSessionPage({ params }: PageProps) {
  const { id: sessionId } = await params;
  const user = await requireUser();

  const supa = await supabaseServer();

  const { data: session } = await supa
    .from("sessions")
    .select("id, created_at, completed_at, stage, duration_ms")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    notFound();
  }
  const sessionRow = session as SessionRow;

  const { data: analyses } = await supa
    .from("analyses")
    .select("id, session_id, created_at, model, pdf_path, result, status")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1);

  const latest = (analyses ?? [])[0] as AnalysisRow | undefined;

  // Mint a short-lived signed URL for the PDF if one exists. We use
  // supabaseServer() so the storage policy decision (today: implicit via
  // service-role behind the scenes) lines up with the row read we just did.
  let pdfUrl: string | null = null;
  if (latest?.pdf_path) {
    const { data: signed } = await supa.storage
      .from(serverEnv.recordingsBucket())
      .createSignedUrl(latest.pdf_path, 300);
    pdfUrl = signed?.signedUrl ?? null;
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex items-start justify-between gap-4">
          <div>
            <Link
              href="/student"
              className="text-xs text-neutral-400 hover:text-neutral-200"
            >
              &larr; All interviews
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Interview analysis
            </h1>
            <p className="mt-1 text-xs text-neutral-500">
              {formatDate(sessionRow.created_at)} ·{" "}
              {formatDuration(sessionRow.duration_ms)} · session{" "}
              <code className="font-mono text-[11px]">
                {sessionRow.id.slice(0, 8)}
              </code>
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Signed in as{" "}
              <span className="text-neutral-300">
                {user.profile?.display_name ?? user.email}
              </span>
            </p>
          </div>
          <SignOutButton />
        </header>

        {!latest ? (
          <div className="mt-10 rounded-lg border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-300">
            No analysis has been generated for this session yet. Check back
            after your assessor runs it.
          </div>
        ) : latest.status !== "ok" ? (
          <div className="mt-10 rounded-lg border border-amber-900/50 bg-amber-950/30 p-6 text-sm text-amber-100">
            <div className="font-medium">Partial result</div>
            <p className="mt-1 text-amber-200/80">{latest.status}</p>
          </div>
        ) : (
          <AnalysisView analysis={latest} pdfUrl={pdfUrl} />
        )}
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
  // Heuristic: scale 0..1 -> 0..100, or 0..10 -> 0..100, otherwise clamp.
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
