-- Phase 7 security hardening. Apply after 202610180001_phase4_sync_workspaces.sql.
-- Direct table access is unnecessary: the mobile client uses authenticated RPCs.
revoke all on table public.dr_workspaces, public.dr_workspace_members,
  public.dr_sync_mutations, public.dr_temporal_entities from anon, authenticated;

create or replace function public.dr_sync_push(p_workspace_id text,p_mutations jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare
  v_item jsonb; v_payload jsonb; v_id text; v_mutation_id text; v_op text;
  v_type text; v_version integer; v_clock jsonb; v_acked jsonb := '[]'::jsonb;
  v_role text; v_existing_actor uuid; v_scheduled numeric; v_end numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if coalesce(trim(p_workspace_id),'')='' then raise exception 'Workspace id is required'; end if;
  select role into v_role from public.dr_workspace_members
    where workspace_id=p_workspace_id and user_id=auth.uid();
  if v_role is null or v_role not in ('owner','admin','editor') then
    raise exception 'Workspace write access denied' using errcode='42501';
  end if;
  if coalesce(jsonb_typeof(p_mutations),'') <> 'array' then
    raise exception 'Mutation batch must be a JSON array';
  end if;
  if jsonb_array_length(p_mutations)<1 or jsonb_array_length(p_mutations)>100 then
    raise exception 'Mutation batch must contain between 1 and 100 items';
  end if;

  for v_item in select value from jsonb_array_elements(p_mutations) loop
    if coalesce(jsonb_typeof(v_item),'') <> 'object' then raise exception 'Mutation must be an object'; end if;
    v_mutation_id := v_item->>'mutation_id';
    v_id := v_item->>'entity_id';
    v_op := v_item->>'operation';
    v_type := v_item->>'entity_type';
    if coalesce(v_mutation_id,'')='' or length(v_mutation_id)>160
       or coalesce(v_id,'')='' or length(v_id)>160
       or v_type not in ('event','task','reminder','alarm')
       or v_op not in ('upsert','delete') then
      raise exception 'Malformed sync mutation';
    end if;
    if length(coalesce(v_item::text,''))>300000 then raise exception 'Mutation exceeds the 300 KB limit'; end if;
    begin
      v_version := (v_item->>'sync_version')::integer;
    exception when others then raise exception 'sync_version must be an integer'; end;
    if v_version is null or v_version<1 then raise exception 'sync_version must be positive'; end if;

    select actor_id into v_existing_actor from public.dr_sync_mutations
      where workspace_id=p_workspace_id and mutation_id=v_mutation_id;
    if found then
      if v_existing_actor <> auth.uid() then
        raise exception 'Mutation id belongs to another actor' using errcode='42501';
      end if;
      v_acked := v_acked || jsonb_build_array(v_mutation_id);
      continue;
    end if;

    if v_op='upsert' then
      v_payload := v_item->'payload';
      if coalesce(jsonb_typeof(v_payload),'')<>'object'
         or coalesce(v_payload->>'id','')<>v_id
         or coalesce(v_payload->>'workspaceId','')<>p_workspace_id
         or coalesce(v_payload->>'itemType','')<>v_type
         or length(trim(coalesce(v_payload->>'title','')))<1
         or length(coalesce(v_payload->>'title',''))>500 then
        raise exception 'Entity payload identity or title is invalid';
      end if;
      if coalesce((v_payload->>'syncVersion')::integer,0)<1 then
        raise exception 'Entity syncVersion must be positive';
      end if;
      if v_payload->>'scheduledAt' is not null and v_payload->>'endAt' is not null then
        begin
          v_scheduled := (v_payload->>'scheduledAt')::numeric;
          v_end := (v_payload->>'endAt')::numeric;
        exception when others then raise exception 'Entity timestamps must be numeric'; end;
        if v_end<=v_scheduled then raise exception 'Entity endAt must be after scheduledAt'; end if;
      end if;
    else
      select entity_payload into v_payload from public.dr_temporal_entities
        where workspace_id=p_workspace_id and entity_id=v_id;
      if v_payload is null then
        v_payload := jsonb_build_object(
          'id',v_id,'workspaceId',p_workspace_id,'itemType',v_type,'title','Deleted item',
          'scheduledAt',null,'endAt',null,'isCompleted',false,'priority','normal',
          'isShielded',false,'isElastic',false,'isGhost',false,'ghostClusterId',null,
          'assignedUserIds','[]'::jsonb,'rrule',null,'syncVersion',v_version,
          'createdAt',coalesce((v_item->>'created_at')::bigint,0),
          'updatedAt',floor(extract(epoch from clock_timestamp())*1000),
          'deletedAt',floor(extract(epoch from clock_timestamp())*1000),'timeZone','UTC','metadata','{}'::jsonb);
      else
        v_payload := v_payload || jsonb_build_object(
          'deletedAt',floor(extract(epoch from clock_timestamp())*1000),
          'syncVersion',v_version,'updatedAt',floor(extract(epoch from clock_timestamp())*1000));
      end if;
    end if;

    insert into public.dr_sync_mutations(workspace_id,mutation_id,actor_id)
      values(p_workspace_id,v_mutation_id,auth.uid());
    v_clock := jsonb_build_object('wallTime',floor(extract(epoch from clock_timestamp())*1000),
      'logical',v_version,'nodeId',auth.uid()::text);
    insert into public.dr_temporal_entities(workspace_id,entity_id,entity_type,entity_payload,clock)
      values(p_workspace_id,v_id,v_type,v_payload,v_clock)
      on conflict(workspace_id,entity_id) do update set
        entity_type=excluded.entity_type,entity_payload=excluded.entity_payload,
        clock=excluded.clock,revision=nextval(pg_get_serial_sequence('public.dr_temporal_entities','revision')),
        updated_at=now()
      where coalesce((public.dr_temporal_entities.entity_payload->>'syncVersion')::integer,0)<=v_version;
    v_acked := v_acked || jsonb_build_array(v_mutation_id);
  end loop;
  return jsonb_build_object('acknowledged_mutation_ids',v_acked);
end $$;

-- Keep the RPC surface authenticated-only and explicitly document the intended grants.
revoke all on function public.dr_sync_push(text,jsonb) from public, anon;
revoke all on function public.dr_sync_pull(text,bigint,integer) from public, anon;
revoke all on function public.dr_list_workspaces() from public, anon;
revoke all on function public.dr_create_workspace(text,text,text) from public, anon;
revoke all on function public.dr_add_workspace_member(text,text,text) from public, anon;
grant execute on function public.dr_sync_push(text,jsonb) to authenticated;
grant execute on function public.dr_sync_pull(text,bigint,integer) to authenticated;
grant execute on function public.dr_list_workspaces() to authenticated;
grant execute on function public.dr_create_workspace(text,text,text) to authenticated;
grant execute on function public.dr_add_workspace_member(text,text,text) to authenticated;
