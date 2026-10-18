-- Phase 11: database-enforced invitation rate limits.
-- Apply after the workspace invitation table exists (Phase 9 migration).
-- This guard runs inside PostgreSQL, so direct authenticated RPC calls cannot
-- bypass it by skipping the Edge Function.
--
-- Keep a separate attempt ledger: counting invitation rows is insufficient
-- because repeatedly refreshing the same workspace/email upsert changes one
-- row and would otherwise allow unlimited attempts.

create table if not exists public.dr_workspace_invite_attempts (
  id bigint generated always as identity primary key,
  invited_by uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists dr_workspace_invite_attempts_actor_time_idx
  on public.dr_workspace_invite_attempts (invited_by, attempted_at desc);

alter table public.dr_workspace_invite_attempts enable row level security;
revoke all on public.dr_workspace_invite_attempts from public, anon, authenticated;

create or replace function public.dr_enforce_workspace_invite_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hour_count integer;
  v_day_count integer;
begin
  -- Do not count ordinary acceptance/revocation updates as new invite attempts.
  -- An upsert that refreshes created_at is an invite attempt and is rate limited.
  if tg_op = 'UPDATE'
     and new.created_at = old.created_at
     and new.invited_by = old.invited_by then
    return new;
  end if;

  if new.invited_by is null then
    raise exception 'Invitation actor is required';
  end if;

  -- Serialize invite writes by actor so concurrent requests cannot all pass
  -- the count check before any of them commits.
  perform pg_advisory_xact_lock(hashtextextended(new.invited_by::text, 0));

  -- Remove expired ledger rows while holding the actor's transaction lock.
  delete from public.dr_workspace_invite_attempts
    where invited_by = new.invited_by
      and attempted_at < now() - interval '24 hours';

  select
    (count(*) filter (where attempted_at >= now() - interval '1 hour'))::integer,
    count(*)::integer
    into v_hour_count, v_day_count
    from public.dr_workspace_invite_attempts
    where invited_by = new.invited_by
      and attempted_at >= now() - interval '24 hours';

  if v_hour_count >= 10 then
    raise exception 'Invitation rate limit exceeded: try again later'
      using errcode = 'P0001';
  end if;

  if v_day_count >= 50 then
    raise exception 'Daily invitation limit exceeded: try again tomorrow'
      using errcode = 'P0001';
  end if;

  -- This insert and the invitation write share a transaction, so failed writes
  -- do not leave phantom successful attempts in the ledger.
  insert into public.dr_workspace_invite_attempts (invited_by)
    values (new.invited_by);

  return new;
end;
$$;

drop trigger if exists dr_workspace_invites_rate_limit
  on public.dr_workspace_invites;

create trigger dr_workspace_invites_rate_limit
  before insert or update on public.dr_workspace_invites
  for each row
  execute function public.dr_enforce_workspace_invite_rate_limit();

revoke all on function public.dr_enforce_workspace_invite_rate_limit()
  from public, anon, authenticated;
