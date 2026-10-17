import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { activateLocalWorkspace, type LocalCalendarDatabase } from "../persistence/localDatabase";
import { acquireSyncLease } from "../persistence/recoveryGate";
import { getValidSession, loadSession, loadSupabaseConfig, saveSupabaseConfig, signIn, signOut, signUp, type AuthSession, type SupabaseConfig } from "../sync/authService";
import { acceptRemoteWorkspaceInvite, createRemoteWorkspace, createRemoteWorkspaceInvite, listRemoteWorkspaceInvites, listRemoteWorkspaceMembers, listRemoteWorkspaces, removeRemoteWorkspaceMember, revokeRemoteWorkspaceInvite, updateRemoteWorkspaceMemberRole, SupabaseSyncTransport, type RemoteWorkspace, type RemoteWorkspaceInvite, type RemoteWorkspaceMember } from "../sync/supabaseTransport";
import { SyncCoordinator } from "../sync/syncCoordinator";
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
      if (mode === "signup" && !result.session) { setMessage("Account created. Confirm your email, then sign in."); return; }
      const nextSession = mode === "signin" ? result as AuthSession : (result as { session: AuthSession }).session;
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
    if (!memberEmail.trim()) { setMessage("Enter the email address of an existing account."); return; }
    setBusy(true); setMessage("");
    try {
      await addRemoteWorkspaceMember(config, database.workspaceId, memberEmail, memberRole);
      setMessage("Added " + memberEmail.trim() + " as " + memberRole + ". They can access this workspace after signing in.");
      setMemberEmail("");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const reloadAccess = async () => {
    if (!config || !database) return;
    const nextMembers = await listRemoteWorkspaceMembers(config, database.workspaceId);
    const nextInvites = await listRemoteWorkspaceInvites(config, database.workspaceId).catch(() => [] as RemoteWorkspaceInvite[]);
    setMembers(nextMembers); setInvites(nextInvites);
  };
  const addMember = async () => {
    if (!config || !database) return;
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(memberEmail.trim())) { setMessage("Enter a valid invitation email."); return; }
    setBusy(true); setMessage("");
    try {
      const invite = await createRemoteWorkspaceInvite(config, database.workspaceId, memberEmail, memberRole);
      await Share.share({ title: "DR-Calender workspace invitation", message: "You have been invited to " + (workspaces.find(item => item.id === database.workspaceId)?.name ?? database.workspaceId) + " as " + invite.role + ". Sign in with " + invite.email + " and enter this invitation ID in Account & sync: " + invite.id + ". Expires " + new Date(invite.expires_at).toLocaleString() });
      await reloadAccess(); setMessage("Invitation created. Share the invitation ID with the recipient; they must sign in using the invited email and accept it in Account & sync."); setMemberEmail("");
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
  const logout = async () => {
    if (config && session) await signOut(config, session);
    setSession(null); setWorkspaces([]); setMessage("Signed out. Local data remains on this device.");
  };
  const statusLabel = status === "syncing" ? "Syncing…" : status === "success" ? "Synced" : status === "offline" ? "Offline — changes queued" : status === "error" ? "Sync needs attention" : "Ready to sync";
  return <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <View style={s.hero}><Text style={s.kicker}>YOUR DATA, YOUR CONTROL</Text><Text style={s.heading}>Account & sync</Text><Text style={s.subtitle}>Local-first storage with authenticated, workspace-scoped cloud sync.</Text></View>
    <View style={s.statusCard}><View style={[s.statusDot, status === "success" && s.dotSuccess, (status === "error" || status === "offline") && s.dotError]} /><View style={{ flex: 1, gap: 3 }}><Text style={s.cardTitle}>{statusLabel}</Text><Text style={s.muted}>{lastSync ? `Last successful sync: ${new Date(lastSync).toLocaleString()}` : "Local changes stay on this device until you sign in and sync."}</Text></View><Pressable disabled={busy || !session || !database} onPress={() => { void runSync(); }} style={[s.primaryButton, (busy || !session || !database) && s.disabled]}><Text style={s.primaryText}>{busy ? "Working…" : "Sync now"}</Text></Pressable></View>
    {!session ? <>
      <View style={s.card}><View style={s.cardHeader}><Text style={s.cardTitle}>Connect your Supabase project</Text><Pressable onPress={() => setShowConfig(value => !value)}><Text style={s.link}>{showConfig ? "Hide" : "Configure"}</Text></Pressable></View>
        <Text style={s.muted}>Use your project URL and publishable/anon key. Never put a service-role key in the mobile app.</Text>
        {showConfig || !config ? <><Text style={s.label}>PROJECT URL</Text><TextInput value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" placeholder="https://your-project.supabase.co" placeholderTextColor={C.muted} style={s.input}/><Text style={s.label}>PUBLISHABLE / ANON KEY</Text><TextInput value={anonKey} onChangeText={setAnonKey} autoCapitalize="none" placeholder="sb_publishable_… or anon key" placeholderTextColor={C.muted} style={s.input} secureTextEntry/><Pressable disabled={busy} onPress={() => { void configure(); }} style={s.secondaryButton}><Text style={s.secondaryText}>Save project settings</Text></Pressable></> : <Text style={s.saved}>Project configuration saved securely.</Text>}
      </View>
      <View style={s.card}><Text style={s.cardTitle}>Sign in or create account</Text><Text style={s.label}>EMAIL</Text><TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" placeholderTextColor={C.muted} style={s.input}/><Text style={s.label}>PASSWORD</Text><TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="At least 8 characters" placeholderTextColor={C.muted} style={s.input}/><View style={s.buttonRow}><Pressable disabled={busy} onPress={() => { void authenticate("signin"); }} style={s.primaryButton}><Text style={s.primaryText}>Sign in</Text></Pressable><Pressable disabled={busy} onPress={() => { void authenticate("signup"); }} style={s.secondaryButton}><Text style={s.secondaryText}>Create account</Text></Pressable></View></View>
    </> : <>
      <View style={s.card}><Text style={s.cardTitle}>Signed in</Text><Text style={s.email}>{session.user.email ?? session.user.id}</Text><Text style={s.muted}>Session tokens are stored using platform secure storage and refreshed when near expiry.</Text><View style={s.buttonRow}><Pressable onPress={() => { void runSync(); }} disabled={busy || !database} style={s.primaryButton}><Text style={s.primaryText}>Sync local workspace</Text></Pressable><Pressable onPress={() => { void logout(); }} style={s.secondaryButton}><Text style={s.secondaryText}>Sign out</Text></Pressable></View></View>
      <View style={s.card}><View style={s.cardHeader}><Text style={s.cardTitle}>Workspaces</Text><Text style={s.count}>{workspaces.length}</Text></View>{workspaces.map(workspace => <View key={workspace.id} style={s.workspaceRow}><View style={s.workspaceIcon}><Text style={s.workspaceGlyph}>{workspace.workspace_type === "personal" ? "◉" : workspace.workspace_type === "family" ? "⌂" : workspace.workspace_type === "project" ? "◇" : "◎"}</Text></View><View style={{ flex: 1, gap: 3 }}><Text style={s.workspaceName}>{workspace.name}</Text><Text style={s.muted}>{workspace.workspace_type} · {workspace.role} · {workspace.id === database?.workspaceId ? "Active on this device" : "Cloud workspace"}</Text></View><Pressable disabled={busy || workspace.id === database?.workspaceId} onPress={() => { void useWorkspace(workspace); }} style={[s.useButton,workspace.id === database?.workspaceId&&s.useButtonActive]}><Text style={[s.useText,workspace.id === database?.workspaceId&&s.useTextActive]}>{workspace.id === database?.workspaceId ? "Active" : "Use"}</Text></Pressable></View>)}{database && !workspaces.some(item => item.id === database.workspaceId) ? <Pressable disabled={busy} onPress={() => { void linkPersonal(); }} style={s.secondaryButton}><Text style={s.secondaryText}>Link this device’s Personal workspace</Text></Pressable> : null}
        <Text style={s.label}>CREATE WORKSPACE</Text><TextInput value={workspaceName} onChangeText={setWorkspaceName} placeholder="Workspace name" placeholderTextColor={C.muted} style={s.input}/><View style={s.typeRow}>{(["family","team","project"] as const).map(type => <Pressable key={type} onPress={() => setWorkspaceType(type)} style={[s.typePill,workspaceType===type&&s.typePillActive]}><Text style={[s.typeText,workspaceType===type&&s.typeTextActive]}>{type}</Text></Pressable>)}</View><Pressable disabled={busy} onPress={() => { void createWorkspace(); }} style={s.secondaryButton}><Text style={s.secondaryText}>Create workspace</Text></Pressable>
        {workspaces.find(item => item.id === database?.workspaceId && (item.role === "owner" || item.role === "admin")) ? <>
          <Text style={s.label}>WORKSPACE MEMBERS</Text>
          {members.map(member => <View key={member.user_id} style={s.workspaceRow}><View style={{flex:1,gap:3}}><Text style={s.workspaceName}>{member.email || member.user_id}</Text><Text style={s.muted}>{member.role}{member.role === "owner" ? " · owner cannot be changed" : ""}</Text></View>{member.role !== "owner" && (workspaces.find(item => item.id === database?.workspaceId)?.role === "owner" || member.role !== "admin") ? <><Pressable disabled={busy} onPress={() => { void changeMemberRole(member, member.role === "viewer" ? "editor" : "viewer"); }} style={s.useButton}><Text style={s.useText}>{member.role === "viewer" ? "Make editor" : "Make viewer"}</Text></Pressable><Pressable disabled={busy} onPress={() => { void removeMember(member); }} style={s.useButton}><Text style={[s.useText,{color:C.danger}]}>Remove</Text></Pressable></> : null}</View>)}
          <Text style={s.label}>INVITE BY EMAIL</Text><Text style={s.muted}>Creates a 14-day invitation. Email delivery is not configured in the mobile app; share the invitation ID with the recipient.</Text><TextInput value={memberEmail} onChangeText={setMemberEmail} autoCapitalize="none" keyboardType="email-address" placeholder="member@example.com" placeholderTextColor={C.muted} style={s.input}/><View style={s.typeRow}>{(["editor","viewer"] as const).map(role => <Pressable key={role} onPress={() => setMemberRole(role)} style={[s.typePill,memberRole===role&&s.typePillActive]}><Text style={[s.typeText,memberRole===role&&s.typeTextActive]}>{role}</Text></Pressable>)}</View><Pressable disabled={busy} onPress={() => { void addMember(); }} style={s.secondaryButton}><Text style={s.secondaryText}>Create & share invitation</Text></Pressable>
          {invites.length ? <><Text style={s.label}>PENDING INVITATIONS</Text>{invites.map(invite => <View key={invite.id} style={s.workspaceRow}><View style={{flex:1,gap:3}}><Text style={s.workspaceName}>{invite.email}</Text><Text style={s.muted}>{invite.role} · expires {new Date(invite.expires_at).toLocaleDateString()}</Text></View><Pressable disabled={busy} onPress={() => { void Share.share({title:"Workspace invitation ID",message:invite.id}); }} style={s.useButton}><Text style={s.useText}>Share ID</Text></Pressable><Pressable disabled={busy} onPress={() => { void revokeInvite(invite); }} style={s.useButton}><Text style={[s.useText,{color:C.danger}]}>Revoke</Text></Pressable></View>)}</> : null}
        </> : null}
        <Text style={s.label}>ACCEPT A WORKSPACE INVITATION</Text><Text style={s.muted}>Sign in with the invited email address, then enter the invitation ID.</Text><TextInput value={inviteId} onChangeText={setInviteId} autoCapitalize="none" placeholder="Invitation UUID" placeholderTextColor={C.muted} style={s.input}/><Pressable disabled={busy||!session} onPress={() => { void acceptInvite(); }} style={s.secondaryButton}><Text style={s.secondaryText}>Accept invitation</Text></Pressable>
      </View>
    </>}
    {message ? <View style={s.message}><Text style={s.messageText}>{message}</Text></View> : null}
    <View style={s.footnote}><Text style={s.footnoteTitle}>Security boundaries</Text><Text style={s.muted}>The SQL migration must be applied to your Supabase project before sync can work. The mobile client uses the public project key only; workspace membership and write permissions are enforced by server-side RPC functions. Never embed a service-role key.</Text></View>
  </ScrollView>;
}
const s=StyleSheet.create({
  root:{flex:1,backgroundColor:C.bg},content:{padding:18,paddingBottom:35,gap:12},hero:{paddingHorizontal:3,paddingTop:12,paddingBottom:8,gap:6},kicker:{color:C.accent,fontSize:9,fontWeight:"900",letterSpacing:1.7},heading:{color:C.text,fontSize:27,fontWeight:"900"},subtitle:{color:C.muted,fontSize:11,lineHeight:17},
  statusCard:{flexDirection:"row",alignItems:"center",gap:10,padding:13,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:15},statusDot:{width:8,height:8,borderRadius:5,backgroundColor:C.muted},dotSuccess:{backgroundColor:C.green},dotError:{backgroundColor:C.danger},card:{padding:15,gap:9,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:15},cardHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},cardTitle:{color:C.text,fontSize:13,fontWeight:"900"},muted:{color:C.muted,fontSize:10,lineHeight:15},link:{color:C.accent,fontSize:10,fontWeight:"900"},label:{color:C.muted,fontSize:9,fontWeight:"900",letterSpacing:1.2,marginTop:6},input:{color:C.text,backgroundColor:C.raised,borderWidth:1,borderColor:C.border,borderRadius:10,paddingHorizontal:12,paddingVertical:11,fontSize:11},primaryButton:{backgroundColor:C.accent,paddingHorizontal:12,paddingVertical:11,borderRadius:10,alignItems:"center",justifyContent:"center"},primaryText:{color:C.bg,fontSize:10,fontWeight:"900"},secondaryButton:{borderWidth:1,borderColor:C.border,paddingHorizontal:12,paddingVertical:10,borderRadius:10,alignItems:"center",justifyContent:"center"},secondaryText:{color:C.text,fontSize:10,fontWeight:"800"},disabled:{opacity:.45},buttonRow:{flexDirection:"row",gap:8,alignItems:"center",flexWrap:"wrap"},saved:{color:C.green,fontSize:10},email:{color:C.accent,fontSize:12,fontWeight:"800"},workspaceRow:{flexDirection:"row",alignItems:"center",gap:10,paddingVertical:9,borderBottomWidth:1,borderBottomColor:C.border},useButton:{paddingHorizontal:10,paddingVertical:7,borderRadius:8,borderWidth:1,borderColor:C.border},useButtonActive:{borderColor:"#426D56",backgroundColor:"#1C3028"},useText:{color:C.text,fontSize:9,fontWeight:"900"},useTextActive:{color:C.green},workspaceIcon:{width:32,height:32,borderRadius:10,backgroundColor:C.raised,alignItems:"center",justifyContent:"center"},workspaceGlyph:{color:C.accent,fontSize:16},workspaceName:{color:C.text,fontSize:11,fontWeight:"800"},count:{color:C.accent,fontSize:11,fontWeight:"900"},typeRow:{flexDirection:"row",gap:7,flexWrap:"wrap"},typePill:{paddingHorizontal:10,paddingVertical:8,borderRadius:9,backgroundColor:C.raised,borderWidth:1,borderColor:C.border},typePillActive:{backgroundColor:C.wash,borderColor:C.accent},typeText:{color:C.muted,fontSize:10,fontWeight:"800"},typeTextActive:{color:C.accent},message:{padding:12,backgroundColor:C.wash,borderWidth:1,borderColor:"#72551C",borderRadius:12},messageText:{color:C.text,fontSize:10,lineHeight:16},footnote:{padding:12,gap:5},footnoteTitle:{color:C.text,fontSize:10,fontWeight:"900"}
});
