-- Sessions table: one row per interview attempt.
create extension if not exists "pgcrypto";

create type session_stage as enum ('started', 'recording', 'completed', 'aborted');

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  stage session_stage not null default 'started',
  recording_path text,
  duration_ms integer,
  user_agent text
);

create index if not exists sessions_created_at_idx on public.sessions (created_at desc);
create index if not exists sessions_stage_idx on public.sessions (stage);

-- We use the service role key from server routes only, so RLS is left disabled
-- on this table for the MVP. When we open this up to direct browser writes,
-- enable RLS and add per-session policies.
alter table public.sessions disable row level security;

-- Recordings bucket: created via Supabase dashboard or `storage.create_bucket`.
-- Run once after the table migration:
--   select storage.create_bucket('recordings', public := false);
-- Browsers receive one-time signed upload URLs from the server route, so no
-- bucket-level policy is required for the MVP.
