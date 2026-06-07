-- supabase/migrations/0004_sharing_audit.sql
--
-- Phase B: per-session sharing (per-user grants and tokenised share links)
-- plus an append-only audit log for app-admin reads, share-link views, and
-- grant lifecycle events.
--
-- Idempotent: re-running this migration is a no-op on a database that
-- already has it applied. We use IF NOT EXISTS / DO blocks / DROP POLICY
-- IF EXISTS so partial application is recoverable.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. session_grants
--
-- A grant is the canonical "you may see this session" record. There are two
-- shapes:
--   * per-user grant: grantee_user_id set, share_token NULL.
--   * share-token grant: grantee_user_id NULL, share_token set. ANY signed-in
--     user that knows the token can resolve it; the token IS the secret.
--
-- scope is 'analysis' (analyses + PDF only) or 'full' (recording + analyses).
-- Forward-compat: grantee_user_id is nullable so phase C can pre-create grants
-- by email before signup completes.
-- ---------------------------------------------------------------------------

create table if not exists public.session_grants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  grantee_user_id uuid null references auth.users(id) on delete cascade,
  granted_by_user_id uuid not null references auth.users(id) on delete restrict,
  scope text not null check (scope in ('analysis', 'full')),
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  revoked_at timestamptz null,
  share_token text null,
  share_label text null
);

create index if not exists session_grants_session_id_idx
  on public.session_grants (session_id);
create index if not exists session_grants_grantee_user_id_idx
  on public.session_grants (grantee_user_id) where grantee_user_id is not null;
create unique index if not exists session_grants_share_token_unique
  on public.session_grants (share_token) where share_token is not null;

-- ---------------------------------------------------------------------------
-- 2. audit_log
--
-- Append-only. Direct INSERT is denied by RLS; the SECURITY DEFINER helper
-- log_audit() is the only path. UPDATE/DELETE restricted to app_admin (we
-- rarely want to mutate audit rows; admin retains the ability to redact).
-- ---------------------------------------------------------------------------

create table if not exists public.audit_log (
  id bigserial primary key,
  actor_user_id uuid null references auth.users(id) on delete set null,
  action text not null check (action in (
    'admin_session_read',
    'admin_analysis_read',
    'share_view',
    'grant_created',
    'grant_revoked',
    'share_token_created',
    'share_token_used'
  )),
  target_session_id uuid null,
  target_grant_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at desc);
create index if not exists audit_log_target_session_idx
  on public.audit_log (target_session_id, created_at desc)
  where target_session_id is not null;
create index if not exists audit_log_action_idx
  on public.audit_log (action, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Helper functions (SECURITY DEFINER, search_path = public)
--
-- These are the only callable interface to the audit log and to share-token
-- resolution. Keeping them small + auditable is the whole point.
-- ---------------------------------------------------------------------------

-- has_session_access: true if the *current* user (auth.uid()) holds an active
-- grant on session_id at the requested scope or higher.
create or replace function public.has_session_access(
  p_session_id uuid,
  p_required_scope text default 'analysis'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.session_grants g
    where g.session_id = p_session_id
      and g.grantee_user_id = auth.uid()
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
      and (
        g.scope = p_required_scope
        or (g.scope = 'full' and p_required_scope = 'analysis')
      )
  );
$$;

-- log_audit: bypasses RLS to write a single audit_log row attributed to the
-- current auth.uid(). Callable by authenticated users AND service_role.
create or replace function public.log_audit(
  p_action text,
  p_target_session_id uuid default null,
  p_target_grant_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (
    actor_user_id, action, target_session_id, target_grant_id, metadata
  ) values (
    auth.uid(), p_action, p_target_session_id, p_target_grant_id, coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- resolve_share_token: returns the (session_id, scope) for an active token,
-- or raises 'invalid_share_token' if missing/revoked/expired. SECURITY
-- DEFINER so unauthenticated callers (the /share/[token] server component
-- before redirecting to login) can resolve a token's existence.
create or replace function public.resolve_share_token(p_token text)
returns table (session_id uuid, scope text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select g.session_id, g.scope
    from public.session_grants g
    where g.share_token = p_token
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
    limit 1;

  if not found then
    raise exception 'invalid_share_token' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.has_session_access(uuid, text)        from public;
revoke all on function public.log_audit(text, uuid, uuid, jsonb)    from public;
revoke all on function public.resolve_share_token(text)             from public;

grant execute on function public.has_session_access(uuid, text)     to authenticated;
grant execute on function public.log_audit(text, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.resolve_share_token(text)          to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. RLS on the new tables
-- ---------------------------------------------------------------------------

alter table public.session_grants enable row level security;
alter table public.audit_log      enable row level security;

-- session_grants ------------------------------------------------------------
-- SELECT: the grantee themselves, the granter, the session's enduser, or app_admin.
-- (Assessors do NOT see grants by default; phase C may relax.)
drop policy if exists session_grants_select on public.session_grants;
create policy session_grants_select on public.session_grants
  for select to authenticated
  using (
    grantee_user_id = auth.uid()
    or granted_by_user_id = auth.uid()
    or session_id in (select s.id from public.sessions s where s.enduser_id = auth.uid())
    or public.is_app_admin()
  );

-- INSERT: granted_by_user_id must be the caller AND the caller must be the
-- session's enduser (or an app_admin). Assessors cannot create grants.
drop policy if exists session_grants_insert on public.session_grants;
create policy session_grants_insert on public.session_grants
  for insert to authenticated
  with check (
    granted_by_user_id = auth.uid()
    and (
      exists (
        select 1 from public.sessions s
        where s.id = session_id and s.enduser_id = auth.uid()
      )
      or public.is_app_admin()
    )
  );

-- UPDATE: same predicate as INSERT. The application layer is expected to
-- only mutate revoked_at (revocation); this policy doesn't pin which
-- columns are touched, so the app should set only revoked_at.
drop policy if exists session_grants_update on public.session_grants;
create policy session_grants_update on public.session_grants
  for update to authenticated
  using (
    granted_by_user_id = auth.uid()
    or session_id in (select s.id from public.sessions s where s.enduser_id = auth.uid())
    or public.is_app_admin()
  )
  with check (
    granted_by_user_id = auth.uid()
    or session_id in (select s.id from public.sessions s where s.enduser_id = auth.uid())
    or public.is_app_admin()
  );

drop policy if exists session_grants_delete on public.session_grants;
create policy session_grants_delete on public.session_grants
  for delete to authenticated
  using (public.is_app_admin());

-- audit_log -----------------------------------------------------------------
-- SELECT: app_admin only.
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_app_admin());

-- INSERT: deliberately no policy. RLS denies all direct INSERTs from
-- authenticated; log_audit() is SECURITY DEFINER and bypasses RLS to write.
-- (Service-role bypasses RLS unconditionally and may write directly.)

drop policy if exists audit_log_update on public.audit_log;
create policy audit_log_update on public.audit_log
  for update to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists audit_log_delete on public.audit_log;
create policy audit_log_delete on public.audit_log
  for delete to authenticated
  using (public.is_app_admin());

-- ---------------------------------------------------------------------------
-- 5. Augment sessions / analyses SELECT to honor active grants
--
-- We DROP and recreate so the grant-aware predicate is the single source of
-- truth. INSERT/UPDATE/DELETE policies from migration 0003 are unchanged
-- (grants intentionally do not confer write access).
-- ---------------------------------------------------------------------------

drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
  for select to authenticated
  using (
    enduser_id = auth.uid()
    or (assessor_id = auth.uid() and not student_revoked)
    or public.is_app_admin()
    or public.has_session_access(id, 'analysis')
  );

drop policy if exists analyses_select on public.analyses;
create policy analyses_select on public.analyses
  for select to authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = analyses.session_id
        and (
          s.enduser_id = auth.uid()
          or (s.assessor_id = auth.uid() and not s.student_revoked)
          or public.is_app_admin()
          or public.has_session_access(s.id, 'analysis')
        )
    )
  );

-- No row seeds: tests programmatically create grants.
