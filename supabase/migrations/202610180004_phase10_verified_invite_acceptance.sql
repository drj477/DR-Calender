-- Phase 10: require verified email ownership before accepting workspace invitations.
-- Apply after the Phase 4, Phase 7, and Phase 9 migrations.
-- The app uses email/password authentication, so invitation acceptance must not
-- rely on an unverified auth.users.email value matching the invited address.

create or replace function public.dr_accept_workspace_invite(p_invite_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare
  v_email text;
  v_email_confirmed_at timestamptz;
  v_invite public.dr_workspace_invites;
  v_workspace public.dr_workspaces;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select lower(email), email_confirmed_at
    into v_email, v_email_confirmed_at
    from auth.users
    where id=auth.uid();

  if v_email_confirmed_at is null then
    raise exception 'Confirm your email address before accepting a workspace invitation'
      using errcode='42501';
  end if;

  select * into v_invite
    from public.dr_workspace_invites
    where id=p_invite_id
    for update;

  if not found
     or v_invite.revoked_at is not null
     or v_invite.accepted_at is not null
     or v_invite.expires_at<=now() then
    raise exception 'Invitation is invalid, expired, or already used';
  end if;

  if lower(v_invite.email)<>coalesce(v_email,'') then
    raise exception 'Sign in with the email address this invitation was sent to'
      using errcode='42501';
  end if;

  insert into public.dr_workspace_members(workspace_id,user_id,role)
    values(v_invite.workspace_id,auth.uid(),v_invite.role)
    on conflict(workspace_id,user_id) do nothing;

  update public.dr_workspace_invites
    set accepted_at=now()
    where id=p_invite_id;

  select * into v_workspace
    from public.dr_workspaces
    where id=v_invite.workspace_id;

  return jsonb_build_object(
    'id',v_workspace.id,
    'name',v_workspace.name,
    'workspace_type',v_workspace.workspace_type,
    'role',v_invite.role
  );
end $$;

revoke all on function public.dr_accept_workspace_invite(uuid) from public, anon;
grant execute on function public.dr_accept_workspace_invite(uuid) to authenticated;
