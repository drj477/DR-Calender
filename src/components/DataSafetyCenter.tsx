import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { refreshLocalDatabaseAfterRestore, type LocalCalendarDatabase } from "../persistence/localDatabase";
import { isSyncOperationActive } from "../persistence/recoveryGate";
import { createBackup, exportBackupToFile, restoreBackupFromFile } from "../persistence/backupService";

const C={bg:"#10141D",surface:"#171C28",raised:"#202838",border:"#30394B",text:"#F4F6FC",muted:"#9BA7BA",accent:"#FFC247",wash:"#322817",green:"#72D6A1",danger:"#FF9A63"};
type Diagnostics={workspaceCount:number;entityCount:number;liveEntityCount:number;pendingMutations:number;failedMutations:number;checklistCount:number;invalidSchedules:number;orphanedChecklistItems:number;foreignKeyIssues:number;activeWorkspace:string;checkedAt:number};
type Props={database:LocalCalendarDatabase|null;onRestored:(database:LocalCalendarDatabase)=>Promise<void>};
type Busy="diagnostics"|"export"|"file-export"|"restore"|null;
function safeError(error:unknown):string{return error instanceof Error?error.message:String(error);}

export function DataSafetyCenter({database,onRestored}:Props){
 const [diagnostics,setDiagnostics]=useState<Diagnostics|null>(null);
 const [busy,setBusy]=useState<Busy>(null);
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

 const shareSmallBackup=async()=>{
  if(!database)return;
  setBusy("export");setMessage("");
  try{
   const backup=await createBackup(database.db,database.workspaceId);
   const serialized=JSON.stringify(backup,null,2);
   const size=serialized.length*2;
   if(size>2_000_000)throw new Error("This backup is "+(size/1_000_000).toFixed(2)+" MB. Use the file-based export button for larger datasets.");
   await Share.share({title:"DR Calender local backup",message:serialized});
   setLastExport(Date.now());setMessage("Backup prepared for sharing ("+(size/1024).toFixed(1)+" KB). Only send it to a trusted destination.");
  }catch(error){setMessage("Backup export did not complete: "+safeError(error));}
  finally{setBusy(null);}
 };
 const exportFile=async()=>{
  if(!database)return;
  setBusy("file-export");setMessage("");
  try{
   const result=await exportBackupToFile(database.db,database.workspaceId);
   setLastExport(Date.now());setMessage("File-based JSON backup prepared ("+(result.bytes/1_000_000).toFixed(2)+" MB). Use the share sheet to save it to Files or another trusted destination.");
  }catch(error){setMessage("File export did not complete: "+safeError(error));}
  finally{setBusy(null);}
 };
 const restore=()=>{
  if(!database)return;
  if(isSyncOperationActive()){setMessage("Restore is blocked while sync is running. Wait for sync to finish, then try again.");return;}
  Alert.alert("Replace local app data?","Restore replaces the local workspaces, events, tasks, checklists, sync queue, and local settings with the selected backup. Export a backup of the current device first. Authentication sessions are not restored. Sync is locked out during the database replacement.",[
   {text:"Cancel",style:"cancel"},
   {text:"Replace local data",style:"destructive",onPress:()=>{void (async()=>{
    setBusy("restore");setMessage("");
    try{
     const result=await restoreBackupFromFile(database.db,async()=>{
      const refreshedDatabase=await refreshLocalDatabaseAfterRestore(database);
      await onRestored(refreshedDatabase);
     });
     setDiagnostics(null);
     setMessage("Restore committed and integrity checks passed for "+result.rowCount+" rows. In-memory calendar/task state and the active workspace were reloaded immediately. Sync is available again.");
    }catch(error){
     const detail=safeError(error);
     setMessage(detail.includes("data was committed")
      ? detail+" Restart the app if the views still look stale."
      : "Restore was not completed. The database transaction should have rolled back; preserve the original database and backup before trying again. Details: "+detail);
    }
    finally{setBusy(null);}
   })()}}
  ]);
 };

 const metric=(label:string,value:number,warning=false)=><View key={label} style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={[s.metricValue,warning&&value>0?{color:C.danger}:null]}>{value}</Text></View>;
 const d=diagnostics;
 return <ScrollView style={s.root} contentContainerStyle={s.content}>
  <View style={s.hero}><Text style={s.kicker}>PHASE 7 · DATA SAFETY</Text><Text style={s.heading}>Diagnostics & recovery</Text><Text style={s.subtitle}>Read-only local health checks, portable file backups, and guarded transactional restore. Backups contain private calendar and task content.</Text></View>
  <View style={s.card}><View style={s.row}><Text style={s.title}>Local health</Text><Text style={s.badge}>{d?"INSPECTED":"NOT INSPECTED"}</Text></View><Text style={s.muted}>Active workspace: {d?.activeWorkspace??database?.workspaceId??"Database unavailable"}</Text>{d?<View style={s.grid}>{metric("Workspaces",d.workspaceCount)}{metric("All entity records",d.entityCount)}{metric("Live entities",d.liveEntityCount)}{metric("Checklist items",d.checklistCount)}{metric("Pending sync",d.pendingMutations,true)}{metric("Failed sync",d.failedMutations,true)}{metric("Invalid schedules",d.invalidSchedules,true)}{metric("Orphan checklist rows",d.orphanedChecklistItems,true)}{metric("Foreign-key issues",d.foreignKeyIssues,true)}</View>:<Text style={s.muted}>Run an inspection to load local counts and consistency indicators.</Text>}<Pressable accessibilityRole="button" disabled={!database||busy!==null} onPress={()=>{void inspect()}} style={[s.button,(busy!==null||!database)&&s.disabled]}><Text style={s.buttonText}>{busy==="diagnostics"?"Inspecting…":"Refresh read-only diagnostics"}</Text></Pressable>{d?<Text style={s.footnote}>Last inspected: {new Date(d.checkedAt).toLocaleString()}. Diagnostics do not repair or delete records.</Text>:null}</View>
  <View style={s.card}><Text style={s.title}>Backup export</Text><Text style={s.muted}>Exports workspaces, members, all temporal records including tombstones, checklists, pending sync mutations, cursors, clocks, and non-secret settings. Authentication tokens are excluded.</Text><View style={s.notice}><Text style={s.noticeTitle}>Privacy warning</Text><Text style={s.muted}>The file contains event titles, notes/metadata, task details, and pending sync payloads. Protect it as sensitive data. File-based export is not constrained by the former 2 MB share-sheet guard, although device storage and share-provider limits still apply.</Text></View><Pressable accessibilityRole="button" disabled={!database||busy!==null} onPress={()=>{void shareSmallBackup()}} style={[s.button,(busy!==null||!database)&&s.disabled]}><Text style={s.buttonText}>{busy==="export"?"Preparing…":"Quick share (under 2 MB)"}</Text></Pressable><Pressable accessibilityRole="button" disabled={!database||busy!==null} onPress={()=>{void exportFile()}} style={[s.buttonSecondary,(busy!==null||!database)&&s.disabled]}><Text style={s.buttonSecondaryText}>{busy==="file-export"?"Writing backup file…":"Export backup file (large datasets)"}</Text></Pressable>{lastExport?<Text style={s.footnote}>Last prepared: {new Date(lastExport).toLocaleString()}</Text>:null}</View>
  <View style={s.card}><Text style={s.title}>Validated restore</Text><Text style={s.muted}>Choose a JSON backup. The importer validates the format/version, table shape, workspace references, entity ranges, and JSON payloads before touching the database. Import then runs in a single SQLite transaction and checks foreign-key integrity before commit.</Text><View style={s.notice}><Text style={s.noticeTitle}>Destructive operation</Text><Text style={s.muted}>Restore replaces local app data. Make a fresh backup first. Sync the current outbox or consciously accept that replacing it may discard pending changes. After a successful restore, fully close and reopen the app.</Text></View><Pressable accessibilityRole="button" disabled={!database||busy!==null} onPress={restore} style={[s.buttonDanger,(busy!==null||!database)&&s.disabled]}><Text style={s.buttonText}>{busy==="restore"?"Restoring transaction…":"Choose backup and restore"}</Text></Pressable></View>
  <View style={s.card}><Text style={s.title}>Recovery guidance</Text><Text style={s.muted}>• A failed restore is rolled back by SQLite transaction handling; keep the original database and backup until recovery is confirmed.</Text><Text style={s.muted}>• Migration versions are recorded locally. A migration failure rolls back its transaction and stops initialization rather than silently continuing.</Text><Text style={s.muted}>• Cloud data is not deleted or overwritten by local restore. Reconcile the sync queue deliberately before resuming sync.</Text><Text style={s.muted}>• Do not restore a backup from an untrusted source; JSON is validated for structure but is not cryptographically signed.</Text></View>
  {message?<View style={s.message}><Text style={s.messageText}>{message}</Text></View>:null}
 </ScrollView>
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:C.bg},content:{padding:18,paddingBottom:36,gap:12},hero:{paddingTop:12,paddingBottom:8,gap:6},kicker:{color:C.accent,fontSize:9,fontWeight:"900",letterSpacing:1.6},heading:{color:C.text,fontSize:26,fontWeight:"900"},subtitle:{color:C.muted,fontSize:11,lineHeight:17},card:{padding:14,gap:11,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:15},row:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8},title:{color:C.text,fontSize:13,fontWeight:"900"},badge:{color:C.green,fontSize:9,fontWeight:"900",letterSpacing:1},muted:{color:C.muted,fontSize:10,lineHeight:15},grid:{flexDirection:"row",flexWrap:"wrap",gap:8},metric:{width:"31%",minHeight:65,backgroundColor:C.raised,borderRadius:10,padding:9,gap:5},metricLabel:{color:C.muted,fontSize:9,lineHeight:12},metricValue:{color:C.text,fontSize:19,fontWeight:"900"},button:{backgroundColor:C.accent,borderRadius:10,padding:12,alignItems:"center"},buttonSecondary:{backgroundColor:C.raised,borderColor:C.border,borderWidth:1,borderRadius:10,padding:12,alignItems:"center"},buttonSecondaryText:{color:C.text,fontSize:10,fontWeight:"900"},buttonDanger:{backgroundColor:C.danger,borderRadius:10,padding:12,alignItems:"center"},buttonText:{color:C.bg,fontSize:10,fontWeight:"900"},disabled:{opacity:.4},notice:{backgroundColor:C.wash,borderWidth:1,borderColor:"#72551C",borderRadius:10,padding:10,gap:5},noticeTitle:{color:C.accent,fontSize:11,fontWeight:"900"},footnote:{color:C.muted,fontSize:9,lineHeight:14},message:{padding:11,borderRadius:10,backgroundColor:C.raised,borderWidth:1,borderColor:C.border},messageText:{color:C.text,fontSize:10,lineHeight:16}});
