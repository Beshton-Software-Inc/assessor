-- supabase/migrations/0003_multi_tenant.sql
--
-- Phase A multi-tenant foundation:
--   * profiles table mirroring auth.users
--   * organizations + org_members (flat, three roles)
--   * sessions extended with org_id / assessor_id / enduser_id / student_revoked
--   * SECURITY DEFINER helper functions (is_org_member, is_app_admin, get_user_orgs)
--   * Row-Level Security enabled on every public table that holds tenant data
--   * Demo Org seed row (users get inserted by scripts/seed-demo-users.ts)
--
-- Idempotent: re-running this migration should be a no-op on a database that
-- already has it applied. We use IF NOT EXISTS / DO blocks / DROP POLICY IF
-- EXISTS so partial application is recoverable.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. profiles  (mirror of auth.users we can JOIN against and add columns to)
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_app_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists profiles_is_app_admin_idx
  on public.profiles (is_app_admin) where is_app_admin;

-- Auto-insert a profile row whenever an auth.users row is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. organizations + org_members
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'trial',
  trial_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists organizations_slug_idx on public.organizations (slug);

do $$ begin
  create type org_role as enum ('org_admin', 'assessor', 'enduser');
exception when duplicate_object then null; end $$;

create table if not exists public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- We store role as text+CHECK rather than the enum so we can extend roles
  -- without a migration churn. Keep both in sync if you ever switch.
  role text not null check (role in ('org_admin', 'assessor', 'enduser')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists org_members_user_id_idx on public.org_members (user_id);
create index if not exists org_members_role_idx on public.org_members (org_id, role);

-- ---------------------------------------------------------------------------
-- 3. Extend sessions with tenant + privacy columns
-- ---------------------------------------------------------------------------

alter table public.sessions
  add column if not exists org_id uuid references public.organizations(id) on delete restrict,
  add column if not exists assessor_id uuid references auth.users(id) on delete set null,
  add column if not exists enduser_id  uuid references auth.users(id) on delete set null,
  add column if not exists student_revoked boolean not null default false;

create index if not exists sessions_org_id_idx       on public.sessions (org_id);
create index if not exists sessions_assessor_id_idx  on public.sessions (assessor_id);
create index if not exists sessions_enduser_id_idx   on public.sessions (enduser_id);

-- NOTE: org_id / assessor_id / enduser_id are NULL-able for now. After the
-- backfill (see bottom of this file) runs they should be made NOT NULL in a
-- follow-up migration 0004_tenant_required.sql.

-- ---------------------------------------------------------------------------
-- 4. Helper functions  (SECURITY DEFINER, immutable wrt session vars)
--
-- These are the *only* functions the RLS policies call. Keeping the policy
-- predicates small and centralised makes them auditable.
-- ---------------------------------------------------------------------------

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_app_admin from public.profiles p where p.user_id = auth.uid()),
    false
  );
$$;

create or replace function public.is_org_member(org uuid, required_role text default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = org
      and m.user_id = auth.uid()
      and (required_role is null or m.role = required_role)
  );
$$;

create or replace function public.get_user_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.org_id from public.org_members m where m.user_id = auth.uid();
$$;

revoke all on function public.is_app_admin()                   from public;
revoke all on function public.is_org_member(uuid, text)        from public;
revoke all on function public.get_user_orgs()                  from public;
grant execute on function public.is_app_admin()                to authenticated;
grant execute on function public.is_org_member(uuid, text)     to authenticated;
grant execute on function public.get_user_orgs()               to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Enable RLS
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.organizations enable row level security;
alter table public.org_members   enable row level security;
alter table public.sessions      enable row level security;
alter table public.analyses      enable row level security;

-- ---------------------------------------------------------------------------
-- 6. Policies
--
-- We write SELECT / INSERT / UPDATE / DELETE separately rather than FOR ALL,
-- because (a) the read predicate and the write predicate diverge on sessions
-- and (b) splitting them is what makes adversarial test cases legible.
-- ---------------------------------------------------------------------------

-- profiles ------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_app_admin()
    or user_id in (
      select m2.user_id
      from public.org_members m1
      join public.org_members m2 on m1.org_id = m2.org_id
      where m1.user_id = auth.uid()
    )
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_app_admin = (select is_app_admin from public.profiles where user_id = auth.uid()));
  -- ^ a user cannot self-promote to app_admin via UPDATE; the bool is
  --   pinned to its current server-side value.

-- INSERT/DELETE on profiles is reserved for the trigger / app_admin tooling.
drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (public.is_app_admin());

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (public.is_app_admin());

-- organizations -------------------------------------------------------------

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_org_member(id) or public.is_app_admin());

drop policy if exists organizations_insert on public.organizations;
create policy organizations_insert on public.organizations
  for insert to authenticated
  with check (public.is_app_admin());

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists organizations_delete on public.organizations;
create policy organizations_delete on public.organizations
  for delete to authenticated
  using (public.is_app_admin());

-- org_members ---------------------------------------------------------------

drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members
  for select to authenticated
  using (
    org_id in (select public.get_user_orgs())
    or public.is_app_admin()
  );

-- org_admins can add assessors/endusers (NOT other org_admins) in their org.
-- app_admin can do anything.
drop policy if exists org_members_insert on public.org_members;
create policy org_members_insert on public.org_members
  for insert to authenticated
  with check (
    public.is_app_admin()
    or (
      public.is_org_member(org_id, 'org_admin')
      and role <> 'org_admin'
    )
  );

drop policy if exists org_members_update on public.org_members;
create policy org_members_update on public.org_members
  for update to authenticated
  using (
    public.is_app_admin()
    or public.is_org_member(org_id, 'org_admin')
  )
  with check (
    public.is_app_admin()
    or (
      public.is_org_member(org_id, 'org_admin')
      and role <> 'org_admin'
    )
  );

drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members
  for delete to authenticated
  using (
    public.is_app_admin()
    or (
      public.is_org_member(org_id, 'org_admin')
      and role <> 'org_admin'
    )
  );

-- sessions ------------------------------------------------------------------
--
-- Read predicate is the canonical "who can see this session" rule. Keep it
-- in one place; analyses re-uses it by joining through sessions.

drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
  for select to authenticated
  using (
    enduser_id = auth.uid()
    or (assessor_id = auth.uid() and not student_revoked)
    or public.is_app_admin()
  );

-- INSERT: only an authenticated assessor inserting a row tagged with
-- themselves and an org they belong to (as assessor).
drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions
  for insert to authenticated
  with check (
    assessor_id = auth.uid()
    and public.is_org_member(org_id, 'assessor')
  );

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions
  for update to authenticated
  using (
    enduser_id = auth.uid()
    or (assessor_id = auth.uid() and not student_revoked)
    or public.is_app_admin()
  )
  with check (
    enduser_id = auth.uid()
    or (assessor_id = auth.uid() and not student_revoked)
    or public.is_app_admin()
  );

drop policy if exists sessions_delete on public.sessions;
create policy sessions_delete on public.sessions
  for delete to authenticated
  using (public.is_app_admin());

-- analyses ------------------------------------------------------------------
-- Same predicate as sessions, joined through session_id.

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
        )
    )
  );

drop policy if exists analyses_insert on public.analyses;
create policy analyses_insert on public.analyses
  for insert to authenticated
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = analyses.session_id
        and (
          (s.assessor_id = auth.uid() and not s.student_revoked)
          or public.is_app_admin()
        )
    )
  );

drop policy if exists analyses_update on public.analyses;
create policy analyses_update on public.analyses
  for update to authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = analyses.session_id
        and (
          (s.assessor_id = auth.uid() and not s.student_revoked)
          or public.is_app_admin()
        )
    )
  )
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = analyses.session_id
        and (
          (s.assessor_id = auth.uid() and not s.student_revoked)
          or public.is_app_admin()
        )
    )
  );

drop policy if exists analyses_delete on public.analyses;
create policy analyses_delete on public.analyses
  for delete to authenticated
  using (public.is_app_admin());

-- ---------------------------------------------------------------------------
-- 7. Demo Org seed (idempotent, no users yet)
-- ---------------------------------------------------------------------------

insert into public.organizations (name, slug, plan)
values ('Demo Org', 'demo', 'trial')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Backfill — RUN AFTER seed-demo-users
--
-- These statements expect the demo users to already exist. They are written
-- to be safe to run repeatedly: each UPDATE only touches rows that still
-- have NULL tenant columns.
--
-- Uncomment / run via: psql -f scripts/backfill-demo-sessions.sql
-- (or run the seed script which executes this block at the end).
-- ---------------------------------------------------------------------------

-- run after seed-demo-users
do $$
declare
  demo_org_id uuid;
  demo_assessor_id uuid;
  demo_student_id uuid;
begin
  select id into demo_org_id from public.organizations where slug = 'demo';
  select id into demo_assessor_id from auth.users where email = 'assessor@example.com';
  select id into demo_student_id  from auth.users where email = 'student-1@example.com';

  if demo_org_id is null or demo_assessor_id is null or demo_student_id is null then
    raise notice 'Skipping backfill: demo org or demo users not found yet (run scripts/seed-demo-users.ts first).';
    return;
  end if;

  update public.sessions
     set org_id      = demo_org_id,
         assessor_id = demo_assessor_id,
         enduser_id  = demo_student_id
   where org_id is null;
end $$;
