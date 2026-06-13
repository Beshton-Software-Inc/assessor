-- supabase/migrations/0007_lead_runs.sql
--
-- The /lead funnel: anonymous students walk pages 1–8 before signing in.
-- A lead_runs row is keyed by a signed cookie (id + cookie_token); after
-- the student signs in on page 5 we "claim" the row, set user_id, and link
-- the two sessions rows (presentation + qa) to that user as enduser.

create extension if not exists "pgcrypto";

create table if not exists public.lead_runs (
  id uuid primary key default gen_random_uuid(),
  -- Random secret stored in the cookie alongside id; avoids needing a
  -- separate signing key. Validation = (cookie.id, cookie.token) match a row.
  cookie_token uuid not null default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '24 hours'),
  claimed_at  timestamptz,

  age_band              text check (age_band in ('over_18','under_18')),
  parental_signature_url text,
  consent_recorded_at   timestamptz,
  consent_terms_version text,

  first_name           text,
  grade                text,
  share_with_advisers  boolean,

  presentation_session_id uuid references public.sessions(id) on delete set null,
  qa_session_id           uuid references public.sessions(id) on delete set null,

  user_id uuid references auth.users(id) on delete set null
);

create index if not exists lead_runs_user_id_idx    on public.lead_runs (user_id);
create index if not exists lead_runs_created_at_idx on public.lead_runs (created_at desc);

alter table public.lead_runs enable row level security;

drop policy if exists lead_runs_select_own on public.lead_runs;
create policy lead_runs_select_own on public.lead_runs
  for select to authenticated
  using (user_id = auth.uid() or public.is_app_admin());

-- INSERT/UPDATE/DELETE only via service role from server routes.
