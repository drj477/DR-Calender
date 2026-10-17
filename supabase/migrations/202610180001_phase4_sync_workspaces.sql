-- DR-Calender Phase 4: Supabase Auth, workspace authorization, idempotent sync.
-- Apply with the Supabase SQL editor or your migration workflow.
create extension if not exists pgcrypto;

create table if not exists public.dr_workspaces (
  id text primary key,
  name text not null check (length(trim(name)) between 1 and 80),
  workspace_type text not null check (workspace_type in ('personal','family','team','project')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.dr_workspace_members (
  workspace_id text not null references public.dr_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);
create table if not exists public.dr_sync_mutations (
  workspace_id text not null references public.dr_workspaces(id) on delete cascade,
  mutation_id text not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  received_at timestamptz not null default now(),
  primary key (workspace_id, mutation_id)
);
create table if not exists public.dr_temporal_entities (
  workspace_id text not null references public.dr_workspaces(id) on delete cascade,
  entity_id text not null,
  entity_type text not null check (entity_type in ('event','task','reminder','alarm')),
  entity_payload jsonb not null,
  clock jsonb not null,
  revision bigserial not null unique,
  updated_at timestamptz not null default now(),
  primary key (workspace_id,entity_id)
);
create index if not exists dr_temporal_entities_revision_idx on public.dr_temporal_entities(workspace_id,revision);
create index if not exists dr_workspace_members_user_idx on public.dr_workspace_members(user_id,workspace_id);

alter table public.dr_workspaces enable row level security;
alter table public.dr_workspace_members enable row level security;
alter table public.dr_sync_mutations enable row level security;
alter table public.dr_temporal_entities enable row level security;
revoke all on public.dr_workspaces, public.dr_workspace_members, public.dr_sync_mutations, public.dr_temporal_entities from anon, authenticated;
grant select on public.dr_workspaces, public.dr_workspace_members to authenticated;

create or replace function public.dr_list_workspaces()
returns table(id text, name text, workspace_type text, role text)
language sql stable security definer set search_path = public, auth
as $$
  select w.id,w.name,w.workspace_type,m.role
  from public.dr_workspaces w
  join public.dr_workspace_members m on m.workspace_id=w.id
  where m.user_id=auth.uid()
  order by w.created_at,w.name;
$$;

drop function if exists public.dr_create_workspace(text,text);
create or replace function public.dr_create_workspace(p_name text,p_workspace_type text default 'personal',p_workspace_id text default null)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare v_id text; v_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_name := trim(coalesce(p_name,''));
  if length(v_name)<1 or length(v_name)>80 then raise exception 'Workspace name must be 1–80 characters'; end if;
  if p_workspace_type not in ('personal','family','team','project') then raise exception 'Invalid workspace type'; end if;
  v_id := coalesce(nullif(trim(p_workspace_id),''),'ws-' || replace(gen_random_uuid()::text,'-',''));
  insert into public.dr_workspaces(id,name,workspace_type,created_by) values(v_id,v_name,p_workspace_type,auth.uid());
  insert into public.dr_workspace_members(workspace_id,user_id,role) values(v_id,auth.uid(),'owner');
  return jsonb_build_object('id',v_id,'name',v_name,'workspace_type',p_workspace_type,'role','owner');
end $$;

create or replace function public.dr_add_workspace_member(p_workspace_id text,p_email text,p_role text default 'editor')
returns jsonb language plpgsql security definer set search_path = public, auth
as $
declare v_actor_role text; v_user_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select role into v_actor_role from public.dr_workspace_members where workspace_id=p_workspace_id and user_id=auth.uid();
  if v_actor_role not in ('owner','admin') or v_actor_role is null then raise exception 'Workspace administration access denied' using errcode='42501'; end if;
  if p_role not in ('editor','viewer') then raise exception 'Member role must be editor or viewer'; end if;
  if length(trim(coalesce(p_email,'')))<3 or length(trim(p_email))>254 then raise exception 'Enter a valid member email'; end if;
  select id into v_user_id from auth.users where lower(email)=lower(trim(p_email)) limit 1;
  if v_user_id is null then raise exception 'No registered account was found for that email. The member must create an account first.'; end if;
  insert into public.dr_workspace_members(workspace_id,user_id,role)
    values(p_workspace_id,v_user_id,p_role)
    on conflict(workspace_id,user_id) do update set role=excluded.role;
  return jsonb_build_object('workspace_id',p_workspace_id,'user_id',v_user_id,'role',p_role);
end $;

create or replace function public.dr_sync_push(p_workspace_id text,p_mutations jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare v_item jsonb; v_payload jsonb; v_id text; v_mutation_id text; v_op text; v_type text; v_version integer; v_clock jsonb; v_acked jsonb := '[]'::jsonb; v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select role into v_role from public.dr_workspace_members where workspace_id=p_workspace_id and user_id=auth.uid();
  if v_role is null or v_role not in ('owner','admin','editor') then raise exception 'Workspace write access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_mutations) <> 'array' or jsonb_array_length(p_mutations)>100 then raise exception 'Mutation batch must contain at most 100 items'; end if;
  for v_item in select value from jsonb_array_elements(p_mutations) loop
    v_mutation_id := v_item->>'mutation_id'; v_id := v_item->>'entity_id'; v_op := v_item->>'operation'; v_type := v_item->>'entity_type';
    v_version := greatest(1,coalesce((v_item->>'sync_version')::integer,1));
    if coalesce(v_mutation_id,'')='' or coalesce(v_id,'')='' or v_type not in ('event','task','reminder','alarm') or v_op not in ('upsert','delete') then
      raise exception 'Malformed sync mutation';
    end if;
    insert into public.dr_sync_mutations(workspace_id,mutation_id,actor_id)
      values(p_workspace_id,v_mutation_id,auth.uid()) on conflict(workspace_id,mutation_id) do nothing;
    if not found then v_acked := v_acked || jsonb_build_array(v_mutation_id); continue; end if;
    if v_op='upsert' then
      v_payload := v_item->'payload';
      if jsonb_typeof(v_payload)<>'object' or coalesce(v_payload->>'id','')<>v_id or coalesce(v_payload->>'workspaceId','')<>p_workspace_id or coalesce(v_payload->>'itemType','')<>v_type or coalesce(v_payload->>'title','')='' then
        raise exception 'Entity payload identity does not match mutation';
      end if;
    else
      select entity_payload into v_payload from public.dr_temporal_entities where workspace_id=p_workspace_id and entity_id=v_id;
      if v_payload is null then
        v_payload := jsonb_build_object('id',v_id,'workspaceId',p_workspace_id,'itemType',v_type,'title','Deleted item','scheduledAt',null,'endAt',null,'isCompleted',false,'priority','normal','isShielded',false,'isElastic',false,'isGhost',false,'ghostClusterId',null,'assignedUserIds','[]'::jsonb,'rrule',null,'syncVersion',v_version,'createdAt',coalesce((v_item->>'created_at')::bigint,0),'updatedAt',floor(extract(epoch from clock_timestamp())*1000),'deletedAt',floor(extract(epoch from clock_timestamp())*1000),'timeZone','UTC','metadata','{}'::jsonb);
      else
        v_payload := v_payload || jsonb_build_object('deletedAt',floor(extract(epoch from clock_timestamp())*1000),'syncVersion',v_version,'updatedAt',floor(extract(epoch from clock_timestamp())*1000));
      end if;
    end if;
    v_clock := jsonb_build_object('wallTime',floor(extract(epoch from clock_timestamp())*1000),'logical',v_version,'nodeId',auth.uid()::text);
    insert into public.dr_temporal_entities(workspace_id,entity_id,entity_type,entity_payload,clock)
      values(p_workspace_id,v_id,v_type,v_payload,v_clock)
      on conflict(workspace_id,entity_id) do update set
        entity_type=excluded.entity_type,entity_payload=excluded.entity_payload,
        clock=excluded.clock,revision=nextval(pg_get_serial_sequence('public.dr_temporal_entities','revision')),
        updated_at=now()
      where (public.dr_temporal_entities.entity_payload->>'syncVersion')::integer <= v_version;
    v_acked := v_acked || jsonb_build_array(v_mutation_id);
  end loop;
  return jsonb_build_object('acknowledged_mutation_ids',v_acked);
end $$;

create or replace function public.dr_sync_pull(p_workspace_id text,p_after_revision bigint default 0,p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = public, auth
as $$
declare v_records jsonb; v_cursor bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.dr_workspace_members where workspace_id=p_workspace_id and user_id=auth.uid()) then
    raise exception 'Workspace read access denied' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('entity_id',entity_id,'entity_payload',entity_payload,'clock',clock,'revision',revision) order by revision),'[]'::jsonb),
         coalesce(max(revision),greatest(coalesce(p_after_revision,0),0))
    into v_records,v_cursor
    from (select * from public.dr_temporal_entities where workspace_id=p_workspace_id and revision>greatest(coalesce(p_after_revision,0),0) order by revision limit least(greatest(coalesce(p_limit,500),1),500)) page;
  return jsonb_build_object('records',v_records,'cursor',v_cursor);
end $$;

revoke all on function public.dr_list_workspaces() from public, anon;
revoke all on function public.dr_create_workspace(text,text,text) from public, anon;
revoke all on function public.dr_add_workspace_member(text,text,text) from public, anon;
revoke all on function public.dr_sync_push(text,jsonb) from public, anon;
revoke all on function public.dr_sync_pull(text,bigint,integer) from public, anon;
grant execute on function public.dr_list_workspaces() to authenticated;
grant execute on function public.dr_create_workspace(text,text,text) to authenticated;
grant execute on function public.dr_add_workspace_member(text,text,text) to authenticated;
grant execute on function public.dr_sync_push(text,jsonb) to authenticated;
grant execute on function public.dr_sync_pull(text,bigint,integer) to authenticated;
