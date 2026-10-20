import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, TextInput, View } from "react-native";
import { BrandText } from "./BrandText";
import { activateLocalWorkspace, type LocalCalendarDatabase } from "../persistence/localDatabase";
import { acquireSyncLease } from "../persistence/recoveryGate";
import { getValidSession, loadSession, loadSupabaseConfig, saveSupabaseConfig, signIn, signInWithOAuth, signOut, signUp, type AuthSession, type SupabaseConfig } from "../sync/authService";
import { acceptRemoteWorkspaceInvite, createRemoteWorkspace, createRemoteWorkspaceInvite, sendRemoteWorkspaceInviteEmail, listRemoteWorkspaceInvites, listRemoteWorkspaceMembers, listRemoteWorkspaces, removeRemoteWorkspaceMember, revokeRemoteWorkspaceInvite, updateRemoteWorkspaceMemberRole, SupabaseSyncTransport, type RemoteWorkspace, type RemoteWorkspaceInvite, type RemoteWorkspaceMember } from "../sync/supabaseTransport";
import { SyncCoordinator } from "../sync/syncCoordinator";
import { importPrimaryGoogleCalendar, syncGoogleCalendarChanges } from "../sync/googleCalendarImport";
import { useCalendarStore } from "../store/calendarStore";

const C = { bg: "#10141D", surface: "#171C28", raised: "#202838", border: "#30394B", text: "#F4F6FC", muted: "#9BA7BA", accent: "#FFC247", wash: "#322817", danger: "#FF9A63", green: "#72D6A1" };
type Props = { database: LocalCalendarDatabase | null; onSynced: () => Promise<void>; onWorkspaceChanged: (database: LocalCalendarDatabase) => Promise<void> };
type SyncStatus = "idle" | "syncing" | "success" | "offline" | "error";
export function AccountCenter({ database, onSynced, onWorkspaceChanged }: Props) {
  const [config, setConfig] = useState<SupabaseConfig | null>(null);
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [workspaces, setWorkspaces] = useState<RemoteWorkspace[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"editor" | "viewer">("editor");
  const [members, setMembers] = useState<RemoteWorkspaceMember[]>([]);
  const [invites, setInvites] = useState<RemoteWorkspaceInvite[]>([]);
  const [inviteId, setInviteId] = useState("");
  const [workspaceType, setWorkspaceType] = useState<"personal" | "family" | "team" | "project">("team");
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [lastSync, setLastSync] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([loadSupabaseConfig(), loadSession()]).then(async ([saved, savedSession]) => {
      if (!active) return;
      setConfig(saved); setUrl(saved?.url ?? ""); setAnonKey(saved?.anonKey ?? "");
      if (saved && savedSession) {
        try { const valid = await getValidSession(saved); if (active) setSession(valid); }
        catch { if (active) setMessage("Session expired. Sign in again."); }
      }
    }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, []);
  const reloadWorkspaces = async (cfg = config) => {
    if (!cfg) return;
    const items = await listRemoteWorkspaces(cfg);
    setWorkspaces(items);
  };
  const reloadAccess = async () => {
    if (!config || !database || !session) { setMembers([]); setInvites([]); return; }
    const [nextMembers, nextInvites] = await Promise.all([
      listRemoteWorkspaceMembers(config, database.workspaceId),
      listRemoteWorkspaceInvites(config, database.workspaceId),
    ]);
    setMembers(nextMembers);
    setInvites(nextInvites);
  };
  useEffect(() => {
    if (config && session) reloadWorkspaces(config).catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, [config, session?.user.id]);
  const configure = async () => {
    setBusy(true); setMessage("");
    try {
      const next = { url: url.trim(), anonKey: anonKey.trim() };
      await saveSupabaseConfig(next); setConfig(next); setShowConfig(false); setMessage("Supabase project settings saved securely on this device.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const authenticate = async (mode: "signin" | "signup") => {
    setBusy(true); setMessage("");
    try {
      const cfg = config ?? { url: url.trim(), anonKey: anonKey.trim() };
      if (!config) { await saveSupabaseConfig(cfg); setConfig(cfg); }
      if (!cfg.url || !cfg.anonKey) throw new Error("Configure your Supabase project URL and publishable/anon key first.");
      if (password.length < 8) throw new Error("Password must contain at least 8 characters.");
      const result = mode === "signin" ? await signIn(cfg, email, password) : await signUp(cfg, email, password);
      if (mode === "signup" && "session" in result && !result.session) { setMessage("Account created. Confirm your email, then sign in."); return; }
      const nextSession = mode === "signin" ? result as AuthSession : (result as { session: AuthSession | null }).session;
      if (!nextSession) throw new Error("Authentication did not return a session.");
      setSession(nextSession); setMessage(mode === "signup" ? "Account created and signed in." : "Signed in securely.");
      setPassword("");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const runSync = async () => {
    if (!database || !config || !session) { setMessage("Initialize local storage and sign in before syncing."); return; }
    setBusy(true); setStatus("syncing"); setMessage("");
    let releaseSync: (() => void) | null = null;
    try {
      // Keep the recovery gate held through the UI/store refresh after sync completes.
      releaseSync = acquireSyncLease();
      const validSession = await getValidSession(config);
      if (!validSession) throw new Error("Your session expired. Sign in again.");
      const transport = new SupabaseSyncTransport(config, validSession);
      const coordinator = new SyncCoordinator(database.repository, transport, 100);
      const result = await coordinator.syncWorkspace(database.workspaceId);
      await onSynced();
      setLastSync(Date.now()); setStatus("success");
      setMessage(`Synced: ${result.pushed} changes uploaded, ${result.pulled} records downloaded, ${result.conflicts} conflicts detected.`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setStatus(/network|fetch|offline|timeout/i.test(text) ? "offline" : "error");
      setMessage(text);
    } finally { releaseSync?.(); setBusy(false); }
  };
  const linkPersonal = async () => {
    if (!config || !session || !database) return;
    setBusy(true); setMessage("");
    try {
      const exists = workspaces.some(item => item.id === database.workspaceId);
      if (exists) { setMessage("Your local personal workspace is already linked."); return; }
      const workspace = await createRemoteWorkspace(config, "Personal", "personal", database.workspaceId);
      setWorkspaces(current => [...current.filter(item => item.id !== workspace.id), workspace]);
      setMessage("Personal workspace linked. Your next sync will upload pending local changes.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const useWorkspace = async (workspace: RemoteWorkspace) => {
    if (!database) return;
    setBusy(true); setMessage("");
    try {
      const next = await activateLocalWorkspace(database, { id: workspace.id, name: workspace.name, type: workspace.workspace_type, role: workspace.role });
      await onWorkspaceChanged(next);
      setMessage(`Now using “${workspace.name}”. Local records remain scoped to this workspace.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const addMember = async () => {
    if (!config || !database) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(memberEmail.trim())) { setMessage("Enter a valid invitation email."); return; }
    setBusy(true); setMessage("");
    try {
      let invite: RemoteWorkspaceInvite;
      let delivery = "email";
      try {
        invite = await sendRemoteWorkspaceInviteEmail(config, database.workspaceId, memberEmail, memberRole);
      } catch (emailError) {
        // Keep invitation usable even before the optional email provider is configured.
        invite = await createRemoteWorkspaceInvite(config, database.workspaceId, memberEmail, memberRole);
        delivery = "share";
        await Share.share({ title: "DR-Calender workspace invitation", message: "You have been invited to " + (workspaces.find(item => item.id === database.workspaceId)?.name ?? database.workspaceId) + " as " + invite.role + ". Sign in with " + invite.email + " and enter this invitation ID in Account & sync: " + invite.id + ". Expires " + new Date(invite.expires_at).toLocaleString() });
        setMessage("Invitation created and shared by ID. Email delivery was unavailable: " + (emailError instanceof Error ? emailError.message : String(emailError)));
      }
      await reloadAccess();
      if (delivery === "email") {
        setMessage("Invitation email sent to " + invite.email + ". The recipient must sign in using that email and accept the invitation in Account & sync.");
      }
      setMemberEmail("");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const changeMemberRole = async (member: RemoteWorkspaceMember, role: "admin" | "editor" | "viewer") => {
    if (!config || !database) return;
    setBusy(true); setMessage("");
    try { await updateRemoteWorkspaceMemberRole(config, database.workspaceId, member.user_id, role); await reloadAccess(); setMessage("Workspace member role updated."); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const removeMember = async (member: RemoteWorkspaceMember) => {
    if (!config || !database || member.role === "owner") return;
    setBusy(true); setMessage("");
    try { await removeRemoteWorkspaceMember(config, database.workspaceId, member.user_id); await reloadAccess(); setMessage("Member removed from this workspace. Their device-local data is not deleted."); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const revokeInvite = async (invite: RemoteWorkspaceInvite) => {
    if (!config) return;
    setBusy(true); setMessage("");
    try { await revokeRemoteWorkspaceInvite(config, invite.id); await reloadAccess(); setMessage("Invitation revoked."); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const acceptInvite = async () => {
    if (!config || !inviteId.trim()) { setMessage("Enter the invitation ID you received."); return; }
    setBusy(true); setMessage("");
    try {
      const workspace = await acceptRemoteWorkspaceInvite(config, inviteId.trim());
      setInviteId(""); await reloadWorkspaces(config);
      setMessage("Invitation accepted for " + workspace.name + ". Select that workspace to activate its local mirror, then sync.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (config && session && database) reloadAccess().catch(() => { setMembers([]); setInvites([]); });
  }, [config, session?.user.id, database?.workspaceId]);
  const createWorkspace = async () => {
    if (!config || !session) return;
    if (!workspaceName.trim()) { setMessage("Enter a workspace name."); return; }
    setBusy(true); setMessage("");
    try {
      const workspace = await createRemoteWorkspace(config, workspaceName, workspaceType);
      setWorkspaces(current => [...current, workspace]); setWorkspaceName(""); setMessage("Workspace “" + workspace.name + "” created. Use it in the workspace list to activate its local mirror, then sync.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const importGoogleCalendar = async () => {
    if (!database || !session) { setMessage("Sign in with Google and initialize local storage before importing."); return; }
    setBusy(true); setMessage("");
    try {
      const count = await importPrimaryGoogleCalendar(database, session);
      await onSynced();
      setMessage(`Imported ${count} Google Calendar events into this device. Tap Sync now to upload them to your DR-Calender cloud workspace.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };
  const syncGoogleCalendar = async () => {
    if (!database || !session) { setMessage("Sign in with Google and initialize local storage before syncing."); return; }
    setBusy(true); setMessage("");
    try {
      const result = await syncGoogleCalendarChanges(database, session);
      await onSynced();
      const mode = result.fullSync ? "Full sync complete" : "Incremental sync complete";
      setMessage(`${mode}: ${result.createdOrUpdated} Google event(s) added or updated, ${result.deleted} deletion(s) applied. Future syncs will check only changes since this checkpoint.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };
  const logout = async () => {
    if (config && session) await signOut(config, session);
    setSession(null); setWorkspaces([]); setMessage("Signed out. Local data remains on this device.");
  };
  const statusLabel = status === "syncing" ? "Syncing…" : status === "success" ? "Synced" : status === "offline" ? "Offline — changes queued" : status === "error" ? "Sync needs attention" : "Ready to sync";
  return <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    {session ? <View style={s.hero}><BrandText style={s.kicker}>YOUR DATA, YOUR CONTROL</BrandText><BrandText style={s.heading}>Account & sync</BrandText><BrandText style={s.subtitle}>Local-first storage with authenticated, workspace-scoped cloud sync.</BrandText></View> : null}
    <View style={s.statusCard}><View style={[s.statusDot, status === "success" && s.dotSuccess, (status === "error" || status === "offline") && s.dotError]} /><View style={{ flex: 1, gap: 3 }}><BrandText style={s.cardTitle}>{statusLabel}</BrandText><BrandText style={s.muted}>{lastSync ? `Last successful sync: ${new Date(lastSync).toLocaleString()}` : "Local changes stay on this device until you sign in and sync."}</BrandText></View><Pressable disabled={busy || !session || !database} onPress={() => { void runSync(); }} style={[s.primaryButton, (busy || !session || !database) && s.disabled]}><BrandText style={s.primaryText}>{busy ? "Working…" : "Sync now"}</BrandText></Pressable></View>
    {!session ? <>
      <View style={s.authHero}><View style={s.authMark}><BrandText style={s.authMarkText}>DR</BrandText></View><BrandText style={s.authEyebrow}>YOUR SPACE · PLAN WITH INTENTION</BrandText><BrandText style={s.authTitle}>{authMode === "signin" ? "Welcome back." : "Create your space."}</BrandText><BrandText style={s.authSubtitle}>{authMode === "signin" ? "Sign in to keep your plans in sync across devices." : "One account for your calendar, tasks and reminders."}</BrandText></View>
      <View style={s.authCard}>
        <View style={s.socialRow}>
          <Pressable disabled={busy} onPress={() => { void (async () => { try { if (!config) throw new Error("Configure Supabase first, enable Google under Authentication → Providers, and allow drcalender://auth/callback in URL Configuration."); setBusy(true); setMessage(""); const next = await signInWithOAuth(config, "google"); setSession(next); setMessage("Signed in with Google."); await reloadWorkspaces(config); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } })(); }} style={[s.socialButton,busy&&s.disabled]}><BrandText style={s.googleGlyph}>G</BrandText><BrandText style={s.socialText}>Google</BrandText></Pressable>
          <Pressable disabled={busy} onPress={() => { void (async () => { try { if (!config) throw new Error("Configure Supabase first, enable Apple under Authentication → Providers, and allow drcalender://auth/callback in URL Configuration."); setBusy(true); setMessage(""); const next = await signInWithOAuth(config, "apple"); setSession(next); setMessage("Signed in with Apple."); await reloadWorkspaces(config); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } })(); }} style={[s.socialButton,busy&&s.disabled]}><BrandText style={s.appleGlyph}>●</BrandText><BrandText style={s.socialText}>Apple</BrandText></Pressable>
        </View>
        <View style={s.orRow}><View style={s.orLine}/><BrandText style={s.orText}>OR CONTINUE WITH EMAIL</BrandText><View style={s.orLine}/></View>
        <BrandText style={s.label}>EMAIL ADDRESS</BrandText><TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" placeholderTextColor={C.muted} style={s.input}/>
        <BrandText style={s.label}>PASSWORD</BrandText><TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete={authMode === "signin" ? "current-password" : "new-password"} placeholder={authMode === "signin" ? "Your password" : "At least 8 characters"} placeholderTextColor={C.muted} style={s.input}/>
        <Pressable disabled={busy} onPress={() => { void authenticate(authMode); }} style={[s.authSubmit,busy&&s.disabled]}><BrandText style={s.authSubmitText}>{busy ? "Please wait…" : authMode === "signin" ? "Sign in" : "Create account"}</BrandText></Pressable>
        <Pressable disabled={busy} onPress={() => { setAuthMode(mode => mode === "signin" ? "signup" : "signin"); setMessage(""); }} style={s.modeSwitch}><BrandText style={s.modeSwitchText}>{authMode === "signin" ? "New to DR Calender?  Create account" : "Already have an account?  Sign in"}</BrandText></Pressable>
      </View>
      <View style={s.configCard}><View style={s.cardHeader}><BrandText style={s.cardTitle}>Cloud connection</BrandText><Pressable onPress={() => setShowConfig(value => !value)}><BrandText style={s.link}>{showConfig ? "Hide settings" : config ? "Edit settings" : "Configure"}</BrandText></Pressable></View><BrandText style={s.muted}>Connect Supabase to enable authentication and secure sync. Never use a service-role key in the mobile app.</BrandText>{showConfig || !config ? <><BrandText style={s.label}>PROJECT URL</BrandText><TextInput value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" placeholder="https://your-project.supabase.co" placeholderTextColor={C.muted} style={s.input}/><BrandText style={s.label}>PUBLISHABLE / ANON KEY</BrandText><TextInput value={anonKey} onChangeText={setAnonKey} autoCapitalize="none" placeholder="sb_publishable_… or anon key" placeholderTextColor={C.muted} style={s.input} secureTextEntry/><Pressable disabled={busy} onPress={() => { void configure(); }} style={s.secondaryButton}><BrandText style={s.secondaryText}>Save project settings</BrandText></Pressable></> : <BrandText style={s.saved}>Project settings saved securely.</BrandText>}</View>
    </> : <>
      <View style={s.card}><BrandText style={s.cardTitle}>Signed in</BrandText><BrandText style={s.email}>{session.user.email ?? session.user.id}</BrandText><BrandText style={s.muted}>Session tokens are stored using platform secure storage and refreshed when near expiry.</BrandText><Pressable disabled={busy || !database} onPress={() => { void importGoogleCalendar(); }} style={[s.secondaryButton,busy&&s.disabled]}><BrandText style={s.secondaryText}>{busy ? "Working…" : "Import Google Calendar events"}</BrandText></Pressable><Pressable disabled={busy || !database} onPress={() => { void syncGoogleCalendar(); }} style={[s.primaryButton,(busy||!database)&&s.disabled]}><BrandText style={s.primaryText}>{busy ? "Working…" : "Sync Google Calendar changes"}</BrandText></Pressable><BrandText style={s.muted}>Import brings in the primary calendar. Sync Google Calendar changes then applies edits and deletions from Google; run it whenever you want to refresh this device.</BrandText><View style={s.buttonRow}><Pressable onPress={() => { void runSync(); }} disabled={busy || !database} style={s.primaryButton}><BrandText style={s.primaryText}>Sync local workspace</BrandText></Pressable><Pressable onPress={() => { void logout(); }} style={s.secondaryButton}><BrandText style={s.secondaryText}>Sign out</BrandText></Pressable></View></View>
      <View style={s.card}><View style={s.cardHeader}><BrandText style={s.cardTitle}>Workspaces</BrandText><BrandText style={s.count}>{workspaces.length}</BrandText></View>{workspaces.map(workspace => <View key={workspace.id} style={s.workspaceRow}><View style={s.workspaceIcon}><BrandText style={s.workspaceGlyph}>{workspace.workspace_type === "personal" ? "◉" : workspace.workspace_type === "family" ? "⌂" : workspace.workspace_type === "project" ? "◇" : "◎"}</BrandText></View><View style={{ flex: 1, gap: 3 }}><BrandText style={s.workspaceName}>{workspace.name}</BrandText><BrandText style={s.muted}>{workspace.workspace_type} · {workspace.role} · {workspace.id === database?.workspaceId ? "Active on this device" : "Cloud workspace"}</BrandText></View><Pressable disabled={busy || workspace.id === database?.workspaceId} onPress={() => { void useWorkspace(workspace); }} style={[s.useButton,workspace.id === database?.workspaceId&&s.useButtonActive]}><BrandText style={[s.useText,workspace.id === database?.workspaceId&&s.useTextActive]}>{workspace.id === database?.workspaceId ? "Active" : "Use"}</BrandText></Pressable></View>)}{database && !workspaces.some(item => item.id === database.workspaceId) ? <Pressable disabled={busy} onPress={() => { void linkPersonal(); }} style={s.secondaryButton}><BrandText style={s.secondaryText}>Link this device’s Personal workspace</BrandText></Pressable> : null}
        <BrandText style={s.label}>CREATE WORKSPACE</BrandText><TextInput value={workspaceName} onChangeText={setWorkspaceName} placeholder="Workspace name" placeholderTextColor={C.muted} style={s.input}/><View style={s.typeRow}>{(["family","team","project"] as const).map(type => <Pressable key={type} onPress={() => setWorkspaceType(type)} style={[s.typePill,workspaceType===type&&s.typePillActive]}><BrandText style={[s.typeText,workspaceType===type&&s.typeTextActive]}>{type}</BrandText></Pressable>)}</View><Pressable disabled={busy} onPress={() => { void createWorkspace(); }} style={s.secondaryButton}><BrandText style={s.secondaryText}>Create workspace</BrandText></Pressable>
        {workspaces.find(item => item.id === database?.workspaceId && (item.role === "owner" || item.role === "admin")) ? <>
          <BrandText style={s.label}>WORKSPACE MEMBERS</BrandText>
          {members.map(member => <View key={member.user_id} style={s.workspaceRow}><View style={{flex:1,gap:3}}><BrandText style={s.workspaceName}>{member.email || member.user_id}</BrandText><BrandText style={s.muted}>{member.role}{member.role === "owner" ? " · owner cannot be changed" : ""}</BrandText></View>{member.role !== "owner" && (workspaces.find(item => item.id === database?.workspaceId)?.role === "owner" || member.role !== "admin") ? <><Pressable disabled={busy} onPress={() => { void changeMemberRole(member, member.role === "viewer" ? "editor" : "viewer"); }} style={s.useButton}><BrandText style={s.useText}>{member.role === "viewer" ? "Make editor" : "Make viewer"}</BrandText></Pressable>{workspaces.find(item => item.id === database?.workspaceId)?.role === "owner" ? <Pressable disabled={busy} onPress={() => { void changeMemberRole(member, member.role === "admin" ? "editor" : "admin"); }} style={s.useButton}><BrandText style={s.useText}>{member.role === "admin" ? "Make editor" : "Make admin"}</BrandText></Pressable> : null}<Pressable disabled={busy} onPress={() => { void removeMember(member); }} style={s.useButton}><BrandText style={[s.useText,{color:C.danger}]}>Remove</BrandText></Pressable></> : null}</View>)}
          <BrandText style={s.label}>INVITE BY EMAIL</BrandText><BrandText style={s.muted}>Creates a 14-day invitation. Email delivery is not configured in the mobile app; share the invitation ID with the recipient.</BrandText><TextInput value={memberEmail} onChangeText={setMemberEmail} autoCapitalize="none" keyboardType="email-address" placeholder="member@example.com" placeholderTextColor={C.muted} style={s.input}/><View style={s.typeRow}>{(["editor","viewer"] as const).map(role => <Pressable key={role} onPress={() => setMemberRole(role)} style={[s.typePill,memberRole===role&&s.typePillActive]}><BrandText style={[s.typeText,memberRole===role&&s.typeTextActive]}>{role}</BrandText></Pressable>)}</View><Pressable disabled={busy} onPress={() => { void addMember(); }} style={s.secondaryButton}><BrandText style={s.secondaryText}>Create & share invitation</BrandText></Pressable>
          {invites.length ? <><BrandText style={s.label}>PENDING INVITATIONS</BrandText>{invites.map(invite => <View key={invite.id} style={s.workspaceRow}><View style={{flex:1,gap:3}}><BrandText style={s.workspaceName}>{invite.email}</BrandText><BrandText style={s.muted}>{invite.role} · expires {new Date(invite.expires_at).toLocaleDateString()}</BrandText></View><Pressable disabled={busy} onPress={() => { void Share.share({title:"Workspace invitation ID",message:invite.id}); }} style={s.useButton}><BrandText style={s.useText}>Share ID</BrandText></Pressable><Pressable disabled={busy} onPress={() => { void revokeInvite(invite); }} style={s.useButton}><BrandText style={[s.useText,{color:C.danger}]}>Revoke</BrandText></Pressable></View>)}</> : null}
        </> : null}
        <BrandText style={s.label}>ACCEPT A WORKSPACE INVITATION</BrandText><BrandText style={s.muted}>Sign in with the invited email address, then enter the invitation ID.</BrandText><TextInput value={inviteId} onChangeText={setInviteId} autoCapitalize="none" placeholder="Invitation UUID" placeholderTextColor={C.muted} style={s.input}/><Pressable disabled={busy||!session} onPress={() => { void acceptInvite(); }} style={s.secondaryButton}><BrandText style={s.secondaryText}>Accept invitation</BrandText></Pressable>
      </View>
    </>}
    {message ? <View style={s.message}><BrandText style={s.messageText}>{message}</BrandText></View> : null}
    <View style={s.footnote}><BrandText style={s.footnoteTitle}>Security boundaries</BrandText><BrandText style={s.muted}>The SQL migration must be applied to your Supabase project before sync can work. The mobile client uses the public project key only; workspace membership and write permissions are enforced by server-side RPC functions. Never embed a service-role key.</BrandText></View>
  </ScrollView>;
}
const s=StyleSheet.create({
  root:{flex:1,backgroundColor:C.bg},content:{padding:18,paddingBottom:35,gap:12},hero:{paddingHorizontal:3,paddingTop:12,paddingBottom:8,gap:6},kicker:{color:C.accent,fontSize:9,fontWeight:"900",letterSpacing:1.7},heading:{color:C.text,fontSize:27,fontWeight:"900"},subtitle:{color:C.muted,fontSize:11,lineHeight:17},authHero:{alignItems:"center",paddingTop:22,paddingBottom:12,gap:8},authMark:{width:54,height:54,borderRadius:18,backgroundColor:C.accent,alignItems:"center",justifyContent:"center",shadowColor:C.accent,shadowOpacity:.22,shadowRadius:14,elevation:5},authMarkText:{color:C.bg,fontSize:20,fontWeight:"900"},authEyebrow:{color:C.muted,fontSize:9,fontWeight:"900",letterSpacing:1.8,marginTop:8},authTitle:{color:C.text,fontSize:29,fontWeight:"900",letterSpacing:-.7,textAlign:"center"},authSubtitle:{color:C.muted,fontSize:12,lineHeight:18,textAlign:"center",maxWidth:280},authCard:{padding:17,gap:12,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:20,shadowColor:"#000",shadowOpacity:.2,shadowRadius:16,elevation:4},socialRow:{flexDirection:"row",gap:10},socialButton:{flex:1,minHeight:48,flexDirection:"row",gap:9,alignItems:"center",justifyContent:"center",backgroundColor:C.raised,borderWidth:1,borderColor:C.border,borderRadius:12},socialText:{color:C.text,fontSize:12,fontWeight:"800"},googleGlyph:{color:"#4285F4",fontSize:17,fontWeight:"900"},appleGlyph:{color:C.text,fontSize:15,fontWeight:"900"},orRow:{flexDirection:"row",alignItems:"center",gap:9,marginVertical:3},orLine:{height:1,backgroundColor:C.border,flex:1},orText:{color:C.muted,fontSize:8,fontWeight:"900",letterSpacing:1},authSubmit:{minHeight:48,backgroundColor:C.accent,borderRadius:12,alignItems:"center",justifyContent:"center",marginTop:3},authSubmitText:{color:C.bg,fontSize:13,fontWeight:"900"},modeSwitch:{alignItems:"center",paddingVertical:7},modeSwitchText:{color:C.accent,fontSize:11,fontWeight:"800"},configCard:{padding:15,gap:9,backgroundColor:"#131923",borderWidth:1,borderColor:C.border,borderRadius:15},
  statusCard:{flexDirection:"row",alignItems:"center",gap:10,padding:13,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:15},statusDot:{width:8,height:8,borderRadius:5,backgroundColor:C.muted},dotSuccess:{backgroundColor:C.green},dotError:{backgroundColor:C.danger},card:{padding:15,gap:9,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:15},cardHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},cardTitle:{color:C.text,fontSize:13,fontWeight:"900"},muted:{color:C.muted,fontSize:10,lineHeight:15},link:{color:C.accent,fontSize:10,fontWeight:"900"},label:{color:C.muted,fontSize:9,fontWeight:"900",letterSpacing:1.2,marginTop:6},input:{color:C.text,backgroundColor:C.raised,borderWidth:1,borderColor:C.border,borderRadius:10,paddingHorizontal:12,paddingVertical:11,fontSize:11},primaryButton:{backgroundColor:C.accent,paddingHorizontal:12,paddingVertical:11,borderRadius:10,alignItems:"center",justifyContent:"center"},primaryText:{color:C.bg,fontSize:10,fontWeight:"900"},secondaryButton:{borderWidth:1,borderColor:C.border,paddingHorizontal:12,paddingVertical:10,borderRadius:10,alignItems:"center",justifyContent:"center"},secondaryText:{color:C.text,fontSize:10,fontWeight:"800"},disabled:{opacity:.45},buttonRow:{flexDirection:"row",gap:8,alignItems:"center",flexWrap:"wrap"},saved:{color:C.green,fontSize:10},email:{color:C.accent,fontSize:12,fontWeight:"800"},workspaceRow:{flexDirection:"row",alignItems:"center",gap:10,paddingVertical:9,borderBottomWidth:1,borderBottomColor:C.border},useButton:{paddingHorizontal:10,paddingVertical:7,borderRadius:8,borderWidth:1,borderColor:C.border},useButtonActive:{borderColor:"#426D56",backgroundColor:"#1C3028"},useText:{color:C.text,fontSize:9,fontWeight:"900"},useTextActive:{color:C.green},workspaceIcon:{width:32,height:32,borderRadius:10,backgroundColor:C.raised,alignItems:"center",justifyContent:"center"},workspaceGlyph:{color:C.accent,fontSize:16},workspaceName:{color:C.text,fontSize:11,fontWeight:"800"},count:{color:C.accent,fontSize:11,fontWeight:"900"},typeRow:{flexDirection:"row",gap:7,flexWrap:"wrap"},typePill:{paddingHorizontal:10,paddingVertical:8,borderRadius:9,backgroundColor:C.raised,borderWidth:1,borderColor:C.border},typePillActive:{backgroundColor:C.wash,borderColor:C.accent},typeText:{color:C.muted,fontSize:10,fontWeight:"800"},typeTextActive:{color:C.accent},message:{padding:12,backgroundColor:C.wash,borderWidth:1,borderColor:"#72551C",borderRadius:12},messageText:{color:C.text,fontSize:10,lineHeight:16},footnote:{padding:12,gap:5},footnoteTitle:{color:C.text,fontSize:10,fontWeight:"900"}
});
