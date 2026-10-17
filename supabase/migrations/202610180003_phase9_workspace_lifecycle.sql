-- Phase 9: workspace membership lifecycle and invitation acceptance.
-- Apply after the Phase 4 and Phase 7 migrations. Email delivery is intentionally
-- delegated to a trusted server/Edge Function; the mobile client never receives
-- a service-role key. Pending invitations can be copied/shared by an administrator.
create table if not exists public.dr_workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.dr_workspaces(id) on delete cascade,
  email text not null check (length(trim(email)) between 3 and 254),
  role text not null check (role in ('editor','viewer')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  unique (workspace_id, email)
);
create index if not exists dr_workspace_invites_email_idx on public.dr_workspace_invites(lower(email), expires_at)
  where accepted_at is null and revoked_at is null;
alter table public.dr_workspace_invites enable row level security;
revoke all on public.dr_workspace_invites from public, anon, authenticated;

create or replace function public.dr_list_workspace_members(p_workspace_id text)
returns table(user_id uuid, email text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.dr_workspace_members
    where workspace_id=p_workspace_id and user_id=auth.uid()
  ) then
    raise exception 'Workspace membership required' using errcode='42501';
  end if;
  return query
    select m.user_id, coalesce(u.email,''), m.role, m.created_at
    from public.dr_workspace_members m
    join auth.users u on u.id=m.user_id
    where m.workspace_id=p_workspace_id
    order by case m.role when 'owner' then 0 when 'admin' then 1 when 'editor' then 2 else 3 end, lower(u.email);
end $$;

create or replace function public.dr_set_workspace_member_role(p_workspace_id text,p_user_id uuid,p_role text)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare v_actor_role text; v_target_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select role into v_actor_role from public.dr_workspace_members where workspace_id=p_workspace_id and user_id=auth.uid();
  if v_actor_role not in ('owner','admin') or v_actor_role is null then
    raise exception 'Workspace administration access denied' using errcode='42501';
  end if;
  if p_role not in ('admin','editor','viewer') then raise exception 'Invalid member role'; end if;
  select role into v_target_role from public.dr_workspace_members where workspace_id=p_workspace_id and user_id=p_user_id;
  if v_target_role is null then raise exception 'Workspace member not found'; end if;
  if v_target_role='owner' then raise exception 'The workspace owner role cannot be changed'; end if;
  if v_actor_role='admin' and (v_target_role='admin' or p_role='admin') then
    raise exception 'Only the owner can grant or change administrator access' using errcode='42501';
  end if;
  if auth.uid()=p_user_id and p_role not in ('admin','editor','viewer') then
    raise exception 'Invalid self-role change';
  end if;
  update public.dr_workspace_members set role=p_role where workspace_id=p_workspace_id and user_id=p_user_id;
  return jsonb_build_object('workspace_id',p_workspace_id,'user_id',p_user_id,'role',p_role);
end $$;

create or replace function public.dr_remove_workspace_member(p_workspace_id text,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare v_actor_role text; v_target_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select role into v_actor_role from public.dr_workspace_members where workspace_id=p_workspace_id and user_id=auth.uid();
  if v_actor_role not in ('owner','admin') or v_actor_role is null then
    raise exception 'Workspace administration access denied' using errcode='42501';
  end if;
  select role into v_target_role from public.dr_workspace_members where workspace_id=p_workspace_id and user_id=p_user_id;
  if v_target_role is null then raise exception 'Workspace member not found'; end if;
  if v_target_role='owner' then raise exception 'Transfer ownership before removing the owner'; end if;
  if v_actor_role='admin' and v_target_role='admin' then
    raise exception 'Only the owner can remove an administrator' using errcode='42501';
  end if;
  if auth.uid()=p_user_id and v_actor_role='owner' then
    raise exception 'Transfer ownership before leaving this workspace';
  end if;
  delete from public.dr_workspace_members where workspace_id=p_workspace_id and user_id=p_user_id;
  return jsonb_build_object('workspace_id',p_workspace_id,'removed_user_id',p_user_id);
end $$;

create or replace function public.dr_create_workspace_invite(p_workspace_id text,p_email text,p_role text default 'editor')
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare v_actor_role text; v_email text; v_invite public.dr_workspace_invites;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select role into v_actor_role from public.dr_workspace_members where workspace_id=p_workspace_id and user_id=auth.uid();
  if v_actor_role not in ('owner','admin') or v_actor_role is null then
    raise exception 'Workspace administration access denied' using errcode='42501';
  end if;
  v_email := lower(trim(coalesce(p_email,'')));
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_email)>254 then
    raise exception 'Enter a valid email address';
  end if;
  if p_role not in ('editor','viewer') then raise exception 'Invitation role must be editor or viewer'; end if;
  if exists(select 1 from public.dr_workspace_members m join auth.users u on u.id=m.user_id
    where m.workspace_id=p_workspace_id and lower(u.email)=v_email) then
    raise exception 'This account is already a workspace member';
  end if;
  insert into public.dr_workspace_invites(workspace_id,email,role,invited_by,expires_at,accepted_at,revoked_at)
    values(p_workspace_id,v_email,p_role,auth.uid(),now()+interval '14 days',null,null)
    on conflict(workspace_id,email) do update set role=excluded.role,invited_by=excluded.invited_by,
      created_at=now(),expires_at=now()+interval '14 days',accepted_at=null,revoked_at=null
    returning * into v_invite;
  return jsonb_build_object('id',v_invite.id,'workspace_id',v_invite.workspace_id,'email',v_invite.email,
    'role',v_invite.role,'created_at',v_invite.created_at,'expires_at',v_invite.expires_at);
end $$;

create or replace function public.dr_list_workspace_invites(p_workspace_id text)
returns table(id uuid,email text,role text,created_at timestamptz,expires_at timestamptz)
language plpgsql stable security definer set search_path = public, auth
as $$
declare v_actor_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select role into v_actor_role from public.dr_workspace_members where workspace_id=p_workspace_id and user_id=auth.uid();
  if v_actor_role not in ('owner','admin') or v_actor_role is null then
    raise exception 'Workspace administration access denied' using errcode='42501';
  end if;
  return query select i.id,i.email,i.role,i.created_at,i.expires_at
    from public.dr_workspace_invites i where i.workspace_id=p_workspace_id
      and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()
    order by i.created_at desc;
end $$;

create or replace function public.dr_revoke_workspace_invite(p_invite_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare v_workspace_id text; v_actor_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select workspace_id into v_workspace_id from public.dr_workspace_invites where id=p_invite_id;
  if v_workspace_id is null then raise exception 'Invitation not found'; end if;
  select role into v_actor_role from public.dr_workspace_members where workspace_id=v_workspace_id and user_id=auth.uid();
  if v_actor_role not in ('owner','admin') or v_actor_role is null then
    raise exception 'Workspace administration access denied' using errcode='42501';
  end if;
  update public.dr_workspace_invites set revoked_at=now()
    where id=p_invite_id and accepted_at is null and revoked_at is null;
  return jsonb_build_object('revoked',found,'invite_id',p_invite_id);
end $$;

create or replace function public.dr_accept_workspace_invite(p_invite_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare v_email text; v_invite public.dr_workspace_invites; v_workspace public.dr_workspaces;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select lower(email) into v_email from auth.users where id=auth.uid();
  select * into v_invite from public.dr_workspace_invites
    where id=p_invite_id for update;
  if not found or v_invite.revoked_at is not null or v_invite.accepted_at is not null or v_invite.expires_at<=now() then
    raise exception 'Invitation is invalid, expired, or already used';
  end if;
  if lower(v_invite.email)<>coalesce(v_email,'') then
    raise exception 'Sign in with the email address this invitation was sent to' using errcode='42501';
  end if;
  insert into public.dr_workspace_members(workspace_id,user_id,role)
    values(v_invite.workspace_id,auth.uid(),v_invite.role)
    on conflict(workspace_id,user_id) do nothing;
  update public.dr_workspace_invites set accepted_at=now() where id=p_invite_id;
  select * into v_workspace from public.dr_workspaces where id=v_invite.workspace_id;
  return jsonb_build_object('id',v_workspace.id,'name',v_workspace.name,
    'workspace_type',v_workspace.workspace_type,'role',v_invite.role);
end $$;

revoke all on function public.dr_list_workspace_members(text) from public,anon;
revoke all on function public.dr_set_workspace_member_role(text,uuid,text) from public,anon;
revoke all on function public.dr_remove_workspace_member(text,uuid) from public,anon;
revoke all on function public.dr_create_workspace_invite(text,text,text) from public,anon;
revoke all on function public.dr_list_workspace_invites(text) from public,anon;
revoke all on function public.dr_revoke_workspace_invite(uuid) from public,anon;
revoke all on function public.dr_accept_workspace_invite(uuid) from public,anon;
grant execute on function public.dr_list_workspace_members(text) to authenticated;
grant execute on function public.dr_set_workspace_member_role(text,uuid,text) to authenticated;
grant execute on function public.dr_remove_workspace_member(text,uuid) to authenticated;
grant execute on function public.dr_create_workspace_invite(text,text,text) to authenticated;
grant execute on function public.dr_list_workspace_invites(text) to authenticated;
grant execute on function public.dr_revoke_workspace_invite(uuid) to authenticated;
grant execute on function public.dr_accept_workspace_invite(uuid) to authenticated;
