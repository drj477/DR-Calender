import type { SQLiteDatabase } from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";

export const BACKUP_FORMAT = "dr-calender-backup";
export const BACKUP_SCHEMA_VERSION = 2;
const TABLES = {
  workspaces: ["id","name","workspace_type","created_at","updated_at"],
  members: ["workspace_id","user_id","role","display_name","avatar_url","created_at","updated_at"],
  entities: ["id","workspace_id","item_type","title","scheduled_at","end_at","is_completed","priority","is_shielded","is_elastic","is_ghost","ghost_cluster_id","assigned_user_ids_json","rrule","sync_version","metadata_json","time_zone","created_at","updated_at","deleted_at"],
  checklists: ["id","workspace_id","entity_id","title","is_completed","assigned_user_id","updated_at","deleted_at"],
  ghostClusters: ["id","workspace_id","entity_id","candidate_slot_ids_json","expires_at","confirmed_slot_id","updated_at"],
  outbox: ["mutation_id","workspace_id","entity_id","entity_type","operation","payload_json","sync_version","created_at","retry_count","last_error"],
  cursors: ["workspace_id","cursor","last_synced_at","updated_at"],
  clocks: ["entity_id","clock_json","updated_at"],
  settings: ["key","value","updated_at"],
} as const;
type TableKey = keyof typeof TABLES;
type BackupData = Record<TableKey, Array<Record<string, unknown>>>;
type Backup = { format:string; schemaVersion:number; generatedAt:string; activeWorkspaceId:string; data:BackupData; security?:Record<string,unknown> };

function assert(condition:unknown,message:string): asserts condition { if(!condition) throw new Error(message); }
function isRecord(value:unknown): value is Record<string,unknown> { return !!value && typeof value==="object" && !Array.isArray(value); }

export async function createBackup(db:SQLiteDatabase, activeWorkspaceId:string):Promise<Backup>{
  const [workspaces,members,entities,checklists,ghostClusters,outbox,cursors,clocks,settings]=await Promise.all([
    db.getAllAsync<Record<string,unknown>>("SELECT * FROM workspaces ORDER BY id"),
    db.getAllAsync<Record<string,unknown>>("SELECT * FROM workspace_members ORDER BY workspace_id,user_id"),
    db.getAllAsync<Record<string,unknown>>("SELECT * FROM temporal_entities ORDER BY workspace_id,id"),
    db.getAllAsync<Record<string,unknown>>("SELECT * FROM checklist_items ORDER BY workspace_id,entity_id,id"),
    db.getAllAsync<Record<string,unknown>>("SELECT * FROM ghost_clusters ORDER BY workspace_id,id"),
    db.getAllAsync<Record<string,unknown>>("SELECT * FROM sync_outbox ORDER BY created_at,mutation_id"),
    db.getAllAsync<Record<string,unknown>>("SELECT * FROM sync_cursors ORDER BY workspace_id"),
    db.getAllAsync<Record<string,unknown>>("SELECT * FROM sync_entity_clocks ORDER BY entity_id"),
    db.getAllAsync<Record<string,unknown>>("SELECT * FROM app_settings WHERE lower(key) NOT LIKE '%token%' AND lower(key) NOT LIKE '%secret%' AND lower(key) NOT LIKE '%password%' ORDER BY key"),
  ]);
  return {format:BACKUP_FORMAT,schemaVersion:BACKUP_SCHEMA_VERSION,generatedAt:new Date().toISOString(),activeWorkspaceId,
    security:{includesAuthenticationTokens:false,includesCalendarAndTaskContent:true,includesPendingSyncPayloads:true},
    data:{workspaces,members,entities,checklists,ghostClusters,outbox,cursors,clocks,settings}};
}

export function validateBackup(input:unknown):Backup {
  assert(isRecord(input),"Backup root must be a JSON object.");
  assert(input.format===BACKUP_FORMAT,"This file is not a DR Calender backup.");
  assert(Number.isInteger(input.schemaVersion) && Number(input.schemaVersion)>=1 && Number(input.schemaVersion)<=BACKUP_SCHEMA_VERSION,
    "Unsupported backup schema version. Update the app before restoring this file.");
  assert(typeof input.activeWorkspaceId==="string" && input.activeWorkspaceId.length>0,"Backup active workspace is missing.");
  assert(isRecord(input.data),"Backup data section is missing.");
  const data=input.data as Record<string,unknown>;
  for(const key of Object.keys(TABLES) as TableKey[]){
    assert(Array.isArray(data[key]),"Backup section '"+key+"' must be an array.");
    for(const [index,row] of (data[key] as unknown[]).entries()){
      assert(isRecord(row),"Backup section '"+key+"' contains a non-object row at index "+index+".");
      const allowed=TABLES[key] as readonly string[];
      for(const column of Object.keys(row)) assert(allowed.includes(column),"Unexpected column '"+column+"' in "+key+".");
      for(const column of allowed) assert(Object.prototype.hasOwnProperty.call(row,column),"Row in "+key+" is missing required column '"+column+"'.");
    }
  }
  const workspaces=data.workspaces as Array<Record<string,unknown>>;
  const workspaceIds=new Set<string>();
  for(const row of workspaces){
    assert(typeof row.id==="string" && row.id.length>0,"Workspace has an invalid id.");
    assert(typeof row.name==="string" && row.name.trim().length>0,"Workspace has an invalid name.");
    assert(["personal","family","team","project"].includes(String(row.workspace_type)),"Workspace has an invalid type.");
    assert(!workspaceIds.has(row.id),"Backup contains duplicate workspace ids.");
    workspaceIds.add(row.id);
  }
  assert(workspaceIds.has(input.activeWorkspaceId),"The active workspace is not present in the backup.");
  for(const key of ["members","entities","checklists","ghostClusters","outbox","cursors"] as TableKey[]){
    for(const row of data[key] as Array<Record<string,unknown>>){
      const workspaceId=String(row.workspace_id??"");
      assert(workspaceIds.has(workspaceId),"Backup row in "+key+" references a missing workspace.");
    }
  }
  for(const row of data.entities as Array<Record<string,unknown>>){
    assert(typeof row.id==="string" && typeof row.title==="string","Entity has invalid identity or title.");
    assert(["event","task","reminder","alarm"].includes(String(row.item_type)),"Entity has an invalid type.");
    if(row.scheduled_at!==null && row.end_at!==null) assert(Number(row.end_at)>Number(row.scheduled_at),"Entity has an invalid time range.");
    try{JSON.parse(String(row.metadata_json));JSON.parse(String(row.assigned_user_ids_json));}catch{throw new Error("Entity metadata is not valid JSON.");}
  }
  for(const row of data.outbox as Array<Record<string,unknown>>){try{JSON.parse(String(row.payload_json));}catch{throw new Error("A pending sync payload is not valid JSON.");}}
  return input as unknown as Backup;
}

export async function exportBackupToFile(db:SQLiteDatabase,activeWorkspaceId:string):Promise<{uri:string;bytes:number}>{
  const backup=await createBackup(db,activeWorkspaceId);
  const serialized=JSON.stringify(backup,null,2);
  const directory=FileSystem.cacheDirectory;
  assert(directory,"App cache directory is unavailable.");
  const uri=directory+"dr-calender-backup-"+new Date().toISOString().replace(/[:.]/g,"-")+".json";
  await FileSystem.writeAsStringAsync(uri,serialized,{encoding:FileSystem.EncodingType.UTF8});
  const available=await Sharing.isAvailableAsync();
  assert(available,"The system file-sharing service is unavailable on this device.");
  await Sharing.shareAsync(uri,{mimeType:"application/json",dialogTitle:"Save or share DR Calender backup"});
  return {uri,bytes:serialized.length*2};
}

export async function restoreBackupFromFile(db:SQLiteDatabase):Promise<{activeWorkspaceId:string;rowCount:number}>{
  const picked=await DocumentPicker.getDocumentAsync({type:["application/json","text/json","public.json"],copyToCacheDirectory:true,multiple:false});
  if(picked.canceled || !picked.assets?.[0]) throw new Error("Backup import was cancelled.");
  const serialized=await FileSystem.readAsStringAsync(picked.assets[0].uri,{encoding:FileSystem.EncodingType.UTF8});
  let parsed:unknown;
  try{parsed=JSON.parse(serialized);}catch{throw new Error("The selected file is not valid JSON.");}
  const backup=validateBackup(parsed);
  const mapping:Record<TableKey,string>={workspaces:"workspaces",members:"workspace_members",entities:"temporal_entities",checklists:"checklist_items",ghostClusters:"ghost_clusters",outbox:"sync_outbox",cursors:"sync_cursors",clocks:"sync_entity_clocks",settings:"app_settings"};
  const deleteOrder=["sync_outbox","sync_cursors","checklist_items","ghost_clusters","temporal_entities","workspace_members","sync_entity_clocks","workspaces","app_settings"];
  let rowCount=0;
  await db.withTransactionAsync(async()=>{
    await db.execAsync("PRAGMA defer_foreign_keys = ON;");
    for(const table of deleteOrder) await db.runAsync("DELETE FROM "+table);
    for(const key of Object.keys(TABLES) as TableKey[]){
      const table=mapping[key]; const columns=TABLES[key] as readonly string[];
      for(const row of backup.data[key]){
        const values=columns.map(column=>row[column]===undefined?null:row[column] as string|number|null);
        const placeholders=columns.map(()=>"?").join(",");
        await db.runAsync("INSERT INTO "+table+" ("+columns.join(",")+") VALUES ("+placeholders+")",...values as Array<string|number|null>);
        rowCount++;
      }
    }
    const active=await db.getFirstAsync<{id:string}>("SELECT id FROM workspaces WHERE id=? LIMIT 1",backup.activeWorkspaceId);
    assert(active?.id===backup.activeWorkspaceId,"Restored active workspace is missing.");
    const fkIssues=await db.getAllAsync<{table:string;rowid:number|null;parent:string;fkid:number}>("PRAGMA foreign_key_check");
    assert(fkIssues.length===0,"Restore failed integrity validation: foreign-key violations were found.");
    await db.runAsync("INSERT INTO app_settings(key,value,updated_at) VALUES('active_workspace_id',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",backup.activeWorkspaceId,Date.now());
  });
  return {activeWorkspaceId:backup.activeWorkspaceId,rowCount};
}
