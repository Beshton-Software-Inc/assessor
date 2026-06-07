-- Analyses table: one row per LLM analysis run on a session's recording.
-- A session can be analyzed multiple times (re-runs with different prompts /
-- models), so this is a 1:N child of sessions, keyed by session_id.

create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  model text not null,
  prompt_hash text not null,
  pdf_path text,
  -- Full structured/raw output from the LLM. Stored as jsonb so callers can
  -- query specific fields (scores, tags) without re-parsing the PDF.
  result jsonb not null,
  -- Free-text status for failures: 'ok', or an error message if the run partially failed
  -- after the LLM call but before PDF/Storage write completed.
  status text not null default 'ok'
);

create index if not exists analyses_session_id_idx on public.analyses (session_id, created_at desc);
create index if not exists analyses_created_at_idx on public.analyses (created_at desc);

-- Same RLS posture as sessions: server-only access via the service role key.
alter table public.analyses disable row level security;
