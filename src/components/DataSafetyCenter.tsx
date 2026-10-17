import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import type { LocalCalendarDatabase } from "../persistence/localDatabase";

const C={bg:"#10141D",surface:"#171C28",raised:"#202838",border:"#30394B",text:"#F4F6FC",muted:"#9BA7BA",accent:"#FFC247",wash:"#322817",green:"#72D6A1",danger:"#FF9A63"};
const MAX_EXPORT_BYTES=2_000_000;
type Diagnostics={workspaceCount:number;entityCount:number;liveEntityCount:number;pendingMutations:number;failedMutations:number;checklistCount:number;invalidSchedules:number;orphanedChecklistItems:number;foreignKeyIssues:number;activeWorkspace:string;checkedAt:number};
type Props={database:LocalCalendarDatabase|null};

function bytes(value:string):number{return new TextEncoder().encode(value).length;}
function safeError(error:unknown):string{return error instanceof Error?error.message:String(error);}

export function DataSafetyCenter({database}:Props){
 const [diagnostics,setDiagnostics]=useState<Diagnostics|null>(null);
 const [busy,setBusy]=useState<"diagnostics"|"export"|null>(null);
 const [message,setMessage]=useState("");
 const [lastExport,setLastExport]=useState<number|null>(null);

 const inspect=useCallback(async()=>{
  if(!database){setMessage("Local database is still starting. Try again in a moment.");return;}
  setBusy("diagnostics");setMessage("");
  try{
   const [workspaces,entities,liveEntities,pending,failed,checklists,invalid,orphans,foreignKeys,active]=await Promise.all([
    database.db.getFirstAsync<{count:number}>("SELECT COUNT(*) AS count FROM workspaces"),
    database.db.getFirstAsync<{count:number}>("SELECT COUNT(*) AS count FROM temporal_entities"),
    database.db.getFirstAsync<{count:number}>("SELECT COUNT(*) AS count FROM temporal_entities WHERE deleted_at IS NULL"),
    database.db.getFirstAsync<{count:number}>("SELECT COUNT(*) AS count FROM sync_outbox"),
    database.db.getFirstAsync<{count:number}>("SELECT COUNT(*) AS count FROM sync_outbox WHERE last_error IS NOT NULL"),
    database.db.getFirstAsync<{count:number}>("SELECT COUNT(*) AS count FROM checklist_items WHERE deleted_at IS NULL"),
    database.db.getFirstAsync<{count:number}>("SELECT COUNT(*) AS count FROM temporal_entities WHERE scheduled_at IS NOT NULL AND end_at IS NOT NULL AND end_at<=scheduled_at"),
    database.db.getFirstAsync<{count:number}>("SELECT COUNT(*) AS count FROM checklist_items c LEFT JOIN temporal_entities e ON e.id=c.entity_id WHERE e.id IS NULL"),
    database.db.getAllAsync<{table:string;rowid:number|null;parent:string;fkid:number}>("PRAGMA foreign_key_check"),
    database.db.getFirstAsync<{name:string}>("SELECT name FROM workspaces WHERE id=? LIMIT 1",database.workspaceId),
   ]);
   setDiagnostics({workspaceCount:workspaces?.count??0,entityCount:entities?.count??0,liveEntityCount:liveEntities?.count??0,pendingMutations:pending?.count??0,failedMutations:failed?.count??0,checklistCount:checklists?.count??0,invalidSchedules:invalid?.count??0,orphanedChecklistItems:orphans?.count??0,foreignKeyIssues:foreignKeys.length,activeWorkspace:active?.name??database.workspaceId,checkedAt:Date.now()});
   setMessage("Local diagnostics refreshed. This is a read-only inspection; no data was changed.");
  }catch(error){setMessage("Could not inspect local data: "+safeError(error));}
  finally{setBusy(null);}
 },[database]);

 useEffect(()=>{if(database)void inspect()},[database,inspect]);

 const exportBackup=async()=>{
  if(!database){setMessage("Local database is not available yet.");return;}
  setBusy("export");setMessage("");
  try{
   const [workspaces,members,entities,checklists,ghostClusters,outbox,cursors,clocks,settings]=await Promise.all([
    database.db.getAllAsync("SELECT * FROM workspaces ORDER BY id"),
    database.db.getAllAsync("SELECT * FROM workspace_members ORDER BY workspace_id,user_id"),
    database.db.getAllAsync("SELECT * FROM temporal_entities ORDER BY workspace_id,id"),
    database.db.getAllAsync("SELECT * FROM checklist_items ORDER BY workspace_id,entity_id,id"),
    database.db.getAllAsync("SELECT * FROM ghost_clusters ORDER BY workspace_id,id"),
    database.db.getAllAsync("SELECT * FROM sync_outbox ORDER BY created_at,mutation_id"),
    database.db.getAllAsync("SELECT * FROM sync_cursors ORDER BY workspace_id"),
    database.db.getAllAsync("SELECT * FROM sync_entity_clocks ORDER BY entity_id"),
    database.db.getAllAsync("SELECT * FROM app_settings WHERE key NOT LIKE '%token%' AND key NOT LIKE '%secret%' ORDER BY key"),
   ]);
   const backup={format:"dr-calender-backup",schemaVersion:1,generatedAt:new Date().toISOString(),activeWorkspaceId:database.workspaceId,security:{includesAuthenticationTokens:false,includesCalendarAndTaskContent:true,includesPendingSyncPayloads:true},data:{workspaces,members,entities,checklists,ghostClusters,outbox,cursors,clocks,settings}};
   const serialized=JSON.stringify(backup,null,2);
   const size=bytes(serialized);
   if(size>MAX_EXPORT_BYTES)throw new Error("Backup is "+(size/1_000_000).toFixed(2)+" MB. The in-app share export limit is 2 MB to avoid memory and share-sheet failures. Export smaller workspace ranges or add file-based backup support before exporting this dataset.");
   await Share.share({title:"DR Calender local backup",message:serialized});
   setLastExport(Date.now());
   setMessage("Backup prepared for sharing ("+(size/1024).toFixed(1)+" KB). Check the destination before sending; the export contains private calendar/task content and pending sync payloads.");
  }catch(error){setMessage("Backup export did not complete: "+safeError(error));}
  finally{setBusy(null);}
 };

 const metric=(label:string,value:number,warning=false)=><View key={label} style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={[s.metricValue,warning&&value>0?{color:C.danger}:null]}>{value}</Text></View>;
 const d=diagnostics;
 return <ScrollView style={s.root} contentContainerStyle={s.content}>
  <View style={s.hero}><Text style={s.kicker}>PHASE 7 · DATA SAFETY</Text><Text style={s.heading}>Diagnostics & backup</Text><Text style={s.subtitle}>Read-only local database inspection, pending-sync visibility, and a portable JSON backup that excludes authentication tokens.</Text></View>
  <View style={s.card}><View style={s.row}><Text style={s.title}>Local health</Text><Text style={s.badge}>{d?"INSPECTED":"NOT INSPECTED"}</Text></View><Text style={s.muted}>Active workspace: {d?.activeWorkspace??database?.workspaceId??"Database unavailable"}</Text>{d?<View style={s.grid}>{metric("Workspaces",d.workspaceCount)}{metric("All entity records",d.entityCount)}{metric("Live entities",d.liveEntityCount)}{metric("Checklist items",d.checklistCount)}{metric("Pending sync",d.pendingMutations,true)}{metric("Failed sync",d.failedMutations,true)}{metric("Invalid schedules",d.invalidSchedules,true)}{metric("Orphan checklist rows",d.orphanedChecklistItems,true)}{metric("Foreign-key issues",d.foreignKeyIssues,true)}</View>:<Text style={s.muted}>Run an inspection to load local counts and consistency indicators.</Text>}<Pressable disabled={!database||busy!==null} onPress={()=>{void inspect()}} style={[s.button,(busy!==null||!database)&&s.disabled]}><Text style={s.buttonText}>{busy==="diagnostics"?"Inspecting…":"Refresh read-only diagnostics"}</Text></Pressable>{d?<Text style={s.footnote}>Last inspected: {new Date(d.checkedAt).toLocaleString()}. Checks report potential issues; they do not repair or delete records.</Text>:null}</View>
  <View style={s.card}><Text style={s.title}>Local backup export</Text><Text style={s.muted}>Exports workspaces, members, calendar/task records (including tombstones), checklists, pending sync mutations, cursors, local clocks, and non-secret app settings. Credentials and SecureStore auth sessions are not included.</Text><View style={s.notice}><Text style={s.noticeTitle}>Privacy warning</Text><Text style={s.muted}>The JSON includes private event titles, notes/metadata, task details, and pending sync payloads. Share it only with a destination you trust. Maximum in-app export size: 2 MB.</Text></View><Pressable disabled={!database||busy!==null} onPress={()=>{void exportBackup()}} style={[s.button,(busy!==null||!database)&&s.disabled]}><Text style={s.buttonText}>{busy==="export"?"Preparing backup…":"Export local JSON backup"}</Text></Pressable>{lastExport?<Text style={s.footnote}>Last prepared: {new Date(lastExport).toLocaleString()}</Text>:null}</View>
  <View style={s.card}><Text style={s.title}>Recovery guidance</Text><Text style={s.muted}>• Pending sync rows are preserved until acknowledged by the server.</Text><Text style={s.muted}>• A backup is an export, not an automatic cloud upload or a restore operation.</Text><Text style={s.muted}>• Do not manually edit and re-import database rows; a validated, transactional restore workflow is not implemented yet.</Text><Text style={s.muted}>• If diagnostics show invalid schedules, orphan checklist rows, or foreign-key issues, preserve a backup before attempting any repair.</Text></View>
  {message?<View style={s.message}><Text style={s.messageText}>{message}</Text></View>:null}
 </ScrollView>
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:C.bg},content:{padding:18,paddingBottom:36,gap:12},hero:{paddingTop:12,paddingBottom:8,gap:6},kicker:{color:C.accent,fontSize:9,fontWeight:"900",letterSpacing:1.6},heading:{color:C.text,fontSize:26,fontWeight:"900"},subtitle:{color:C.muted,fontSize:11,lineHeight:17},card:{padding:14,gap:11,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:15},row:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8},title:{color:C.text,fontSize:13,fontWeight:"900"},badge:{color:C.green,fontSize:9,fontWeight:"900",letterSpacing:1},muted:{color:C.muted,fontSize:10,lineHeight:15},grid:{flexDirection:"row",flexWrap:"wrap",gap:8},metric:{width:"31%",minHeight:65,backgroundColor:C.raised,borderRadius:10,padding:9,gap:5},metricLabel:{color:C.muted,fontSize:9,lineHeight:12},metricValue:{color:C.text,fontSize:19,fontWeight:"900"},button:{backgroundColor:C.accent,borderRadius:10,padding:12,alignItems:"center"},buttonText:{color:C.bg,fontSize:10,fontWeight:"900"},disabled:{opacity:.4},notice:{backgroundColor:C.wash,borderWidth:1,borderColor:"#72551C",borderRadius:10,padding:10,gap:5},noticeTitle:{color:C.accent,fontSize:11,fontWeight:"900"},footnote:{color:C.muted,fontSize:9,lineHeight:14},message:{padding:11,borderRadius:10,backgroundColor:C.raised,borderWidth:1,borderColor:C.border},messageText:{color:C.text,fontSize:10,lineHeight:16}});
