-- supabase/migrations/0005_billing.sql
--
-- Phase C: per-seat subscriptions + per-analysis overage metering, with
-- Supabase-side seat invites and an append-only usage_events ledger that
-- the API uses to (a) gate analyses against the org quota and (b) submit
-- Stripe meter events for overages.
--
-- Idempotent: re-running this migration is a no-op on a database that
-- already has it applied. We use IF NOT EXISTS / DO blocks / DROP POLICY
-- IF EXISTS / ON CONFLICT DO NOTHING so partial application is recoverable.
--
-- Depends on: 0003 (organizations, org_members, profiles, is_app_admin,
-- is_org_member, get_user_orgs) and 0004 (audit_log, log_audit).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. plans  (catalog table; one row per pricing tier)
-- ---------------------------------------------------------------------------
--
-- Plans are global. An org's plan is read indirectly via
-- subscriptions.plan_code -> plans.code. We seed three tiers; Stripe price
-- ids are filled in later (manual op against the Stripe dashboard, or via
-- the env-driven setup script).
--
-- For the trial row, quota_per_seat is interpreted by application code
-- (org_can_run_analysis) as the ORG-WIDE cap during the trial period
-- rather than per-seat. The is_trial=true flag is the discriminator.

create table if not exists public.plans (
  code text primary key check (code in ('trial','starter','pro')),
  name text not null,
  seat_price_cents int not null default 0,
  quota_per_seat int not null default 0,
  overage_cents int not null default 0,
  is_trial boolean not null default false,
  stripe_seat_price_id text,
  stripe_overage_meter_id text,
  created_at timestamptz not null default now()
);

insert into public.plans (code, name, seat_price_cents, quota_per_seat, overage_cents, is_trial)
values
  ('trial',   'Trial',   0,    5,   0,   true),
  ('starter', 'Starter', 2900, 50,  150, false),
  ('pro',     'Pro',     4900, 200, 150, false)
on conflict (code) do update set
  name = excluded.name,
  seat_price_cents = excluded.seat_price_cents,
  quota_per_seat = excluded.quota_per_seat,
  overage_cents = excluded.overage_cents,
  is_trial = excluded.is_trial;

-- ---------------------------------------------------------------------------
-- 2. subscriptions (one row per org, 1:1)
-- ---------------------------------------------------------------------------

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organizations(id) on delete cascade,
  plan_code text not null references public.plans(code),
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'trialing'
    check (status in ('trialing','active','past_due','canceled','unpaid','incomplete')),
  seat_quantity int not null default 0,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id) where stripe_customer_id is not null;
create index if not exists subscriptions_stripe_subscription_id_idx
  on public.subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;

-- updated_at maintenance.
create or replace function public.subscriptions_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.subscriptions_touch_updated_at();

-- Auto-provision a trial subscription whenever an organization is created.
-- current_period_end mirrors organizations.trial_ends_at when present so the
-- billing UI and the org-admin dashboard agree.
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (
    org_id, plan_code, status, seat_quantity, current_period_start, current_period_end
  )
  values (
    new.id,
    'trial',
    'trialing',
    0,
    now(),
    coalesce(new.trial_ends_at, now() + interval '14 days')
  )
  on conflict (org_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_organization_created on public.organizations;
create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();

-- ---------------------------------------------------------------------------
-- 3. seat_invites (pending magic-link invitations)
-- ---------------------------------------------------------------------------

create table if not exists public.seat_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete restrict,
  email text not null,
  role text not null check (role in ('assessor','org_admin')),
  status text not null default 'pending'
    check (status in ('pending','accepted','revoked','expired')),
  token text not null unique,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index if not exists seat_invites_org_status_idx
  on public.seat_invites (org_id, status);
create index if not exists seat_invites_email_idx
  on public.seat_invites (lower(email));

-- ---------------------------------------------------------------------------
-- 4. usage_events (append-only ledger)
-- ---------------------------------------------------------------------------

create table if not exists public.usage_events (
  id bigserial primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('analysis_run','session_started')),
  target_session_id uuid,
  target_analysis_id uuid,
  quantity int not null default 1,
  billed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_org_kind_created_idx
  on public.usage_events (org_id, kind, created_at desc);
create index if not exists usage_events_org_unbilled_idx
  on public.usage_events (org_id) where billed = false;

-- ---------------------------------------------------------------------------
-- 5. SECURITY DEFINER helpers
-- ---------------------------------------------------------------------------

-- org_active_seats: how many billable members the org has (assessors +
-- org_admins; endusers are not seats).
create or replace function public.org_active_seats(p_org_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct user_id)::int
  from public.org_members
  where org_id = p_org_id
    and role in ('assessor','org_admin');
$$;

-- org_period_analysis_count: how many analyses the org has run since the
-- start of the current billing period. Lookup is by org_id; we read the
-- subscription row inline.
create or replace function public.org_period_analysis_count(p_org_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.usage_events ue
  where ue.org_id = p_org_id
    and ue.kind = 'analysis_run'
    and ue.created_at >= coalesce(
      (select s.current_period_start from public.subscriptions s where s.org_id = p_org_id),
      'epoch'::timestamptz
    );
$$;

-- org_can_run_analysis: the single quota gate the API consults before
-- running an analysis. Returns true on overage too — overage gets metered,
-- not blocked.
create or replace function public.org_can_run_analysis(p_org_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s_status text;
  s_plan_code text;
  s_period_end timestamptz;
  trial_cap int;
  used_in_period int;
begin
  select status, plan_code, current_period_end
    into s_status, s_plan_code, s_period_end
    from public.subscriptions
    where org_id = p_org_id;

  if s_plan_code is null then
    return false;
  end if;

  -- Active or past_due paid plan: allowed (overage is metered, not blocked).
  if s_plan_code in ('starter','pro') and s_status in ('active','past_due') then
    return true;
  end if;

  -- Trial: must still be inside trial window AND under the org-wide cap.
  if s_status = 'trialing' and s_plan_code = 'trial' then
    if s_period_end is null or s_period_end <= now() then
      return false;
    end if;
    select quota_per_seat into trial_cap from public.plans where code = 'trial';
    used_in_period := public.org_period_analysis_count(p_org_id);
    return used_in_period < coalesce(trial_cap, 0);
  end if;

  -- canceled / unpaid / incomplete: denied.
  return false;
end;
$$;

-- log_usage_event: bypasses RLS to write a single ledger row. Looks up
-- org_id from the session row when target_session_id is provided, else
-- from the caller's first non-enduser org_member row. Callable by
-- authenticated AND service_role.
create or replace function public.log_usage_event(
  p_kind text,
  p_target_session_id uuid default null,
  p_target_analysis_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_org_id uuid;
begin
  if p_kind not in ('analysis_run','session_started') then
    raise exception 'invalid_usage_kind: %', p_kind using errcode = 'P0001';
  end if;

  if p_target_session_id is not null then
    select s.org_id into resolved_org_id
      from public.sessions s
      where s.id = p_target_session_id;
  end if;

  if resolved_org_id is null then
    select m.org_id into resolved_org_id
      from public.org_members m
      where m.user_id = auth.uid()
        and m.role in ('assessor','org_admin')
      order by m.created_at asc
      limit 1;
  end if;

  if resolved_org_id is null then
    raise exception 'usage_event_no_org' using errcode = 'P0001';
  end if;

  insert into public.usage_events (
    org_id, actor_user_id, kind, target_session_id, target_analysis_id, metadata
  ) values (
    resolved_org_id, auth.uid(), p_kind, p_target_session_id, p_target_analysis_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.org_active_seats(uuid)               from public;
revoke all on function public.org_period_analysis_count(uuid)      from public;
revoke all on function public.org_can_run_analysis(uuid)           from public;
revoke all on function public.log_usage_event(text, uuid, uuid, jsonb) from public;

grant execute on function public.org_active_seats(uuid)            to authenticated, service_role;
grant execute on function public.org_period_analysis_count(uuid)   to authenticated, service_role;
grant execute on function public.org_can_run_analysis(uuid)        to authenticated, service_role;
grant execute on function public.log_usage_event(text, uuid, uuid, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Enable RLS
-- ---------------------------------------------------------------------------

alter table public.plans         enable row level security;
alter table public.subscriptions enable row level security;
alter table public.seat_invites  enable row level security;
alter table public.usage_events  enable row level security;

-- ---------------------------------------------------------------------------
-- 7. Policies
-- ---------------------------------------------------------------------------

-- plans ---------------------------------------------------------------------
-- Public read so the marketing /pricing page can render without auth.
-- Writes are app_admin only (service-role bypasses RLS for seeding).
drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to anon, authenticated
  using (true);

drop policy if exists plans_write_admin on public.plans;
create policy plans_write_admin on public.plans
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- subscriptions -------------------------------------------------------------
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (
    public.is_org_member(org_id, 'org_admin')
    or public.is_app_admin()
  );

-- INSERT/UPDATE/DELETE: app_admin only. Stripe webhook writes happen via
-- service-role and bypass RLS unconditionally.
drop policy if exists subscriptions_insert on public.subscriptions;
create policy subscriptions_insert on public.subscriptions
  for insert to authenticated
  with check (public.is_app_admin());

drop policy if exists subscriptions_update on public.subscriptions;
create policy subscriptions_update on public.subscriptions
  for update to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists subscriptions_delete on public.subscriptions;
create policy subscriptions_delete on public.subscriptions
  for delete to authenticated
  using (public.is_app_admin());

-- seat_invites --------------------------------------------------------------
-- SELECT: org_admin of the org, app_admin, OR the invited email matches the
-- caller's JWT email (so the invitee can see their own pending invite).
drop policy if exists seat_invites_select on public.seat_invites;
create policy seat_invites_select on public.seat_invites
  for select to authenticated
  using (
    public.is_org_member(org_id, 'org_admin')
    or public.is_app_admin()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- INSERT: org_admin of the org or app_admin. invited_by must equal caller.
drop policy if exists seat_invites_insert on public.seat_invites;
create policy seat_invites_insert on public.seat_invites
  for insert to authenticated
  with check (
    invited_by = auth.uid()
    and (
      public.is_org_member(org_id, 'org_admin')
      or public.is_app_admin()
    )
  );

-- UPDATE: app_admin only. Status flips on accept happen via service-role
-- inside the auth callback path.
drop policy if exists seat_invites_update on public.seat_invites;
create policy seat_invites_update on public.seat_invites
  for update to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists seat_invites_delete on public.seat_invites;
create policy seat_invites_delete on public.seat_invites
  for delete to authenticated
  using (public.is_app_admin() or public.is_org_member(org_id, 'org_admin'));

-- usage_events --------------------------------------------------------------
-- SELECT: org_admin of the org or app_admin.
drop policy if exists usage_events_select on public.usage_events;
create policy usage_events_select on public.usage_events
  for select to authenticated
  using (
    public.is_org_member(org_id, 'org_admin')
    or public.is_app_admin()
  );

-- INSERT: deliberately no policy. RLS denies all direct INSERTs from
-- authenticated callers; log_usage_event() (SECURITY DEFINER) is the only
-- write path. service_role bypasses RLS unconditionally.

drop policy if exists usage_events_update on public.usage_events;
create policy usage_events_update on public.usage_events
  for update to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists usage_events_delete on public.usage_events;
create policy usage_events_delete on public.usage_events
  for delete to authenticated
  using (public.is_app_admin());

-- ---------------------------------------------------------------------------
-- 8. Backfill: ensure the demo org from phase A has a trial subscription
-- ---------------------------------------------------------------------------

do $$
declare
  demo_org_id uuid;
begin
  select id into demo_org_id from public.organizations where slug = 'demo';
  if demo_org_id is null then
    return;
  end if;

  insert into public.subscriptions (
    org_id, plan_code, status, seat_quantity, current_period_start, current_period_end
  )
  values (
    demo_org_id,
    'trial',
    'trialing',
    0,
    now(),
    now() + interval '14 days'
  )
  on conflict (org_id) do nothing;
end $$;
