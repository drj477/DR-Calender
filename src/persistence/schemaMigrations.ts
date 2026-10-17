import type { SQLiteDatabase } from "expo-sqlite";

type Migration={version:number;name:string;up:(db:SQLiteDatabase)=>Promise<void>;down:(db:SQLiteDatabase)=>Promise<void>};
const MIGRATIONS:Migration[]=[
 {version:1,name:"baseline-schema-ledger",up:async db=>{
   await db.execAsync("CREATE INDEX IF NOT EXISTS idx_outbox_workspace_created ON sync_outbox(workspace_id,created_at,mutation_id);");
   await db.execAsync("CREATE INDEX IF NOT EXISTS idx_checklists_workspace_entity ON checklist_items(workspace_id,entity_id);");
 },down:async db=>{
   await db.execAsync("DROP INDEX IF EXISTS idx_outbox_workspace_created; DROP INDEX IF EXISTS idx_checklists_workspace_entity;");
 }},
 {version:2,name:"restore-and-recovery-metadata",up:async db=>{
   await db.runAsync("INSERT INTO app_settings(key,value,updated_at) VALUES('recovery.last_migration_version','2',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",Date.now());
 },down:async db=>{
   await db.runAsync("DELETE FROM app_settings WHERE key='recovery.last_migration_version'");
 }},
];

export async function runSchemaMigrations(db:SQLiteDatabase):Promise<void>{
 await db.execAsync("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL,name TEXT NOT NULL,applied_at INTEGER NOT NULL);");
 const current=await db.getFirstAsync<{version:number}>("SELECT MAX(version) AS version FROM schema_migrations");
 const installed=current?.version??0;
 const available=MIGRATIONS[MIGRATIONS.length-1]?.version??0;
 if(installed>available) throw new Error("This database was created by a newer DR Calender version. Update the app before opening it.");
 for(const migration of MIGRATIONS){
  if(migration.version<=installed) continue;
  try{
   await db.withTransactionAsync(async()=>{
    await migration.up(db);
    await db.runAsync("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)",migration.version,migration.name,Date.now());
   });
  }catch(error){
   throw new Error("Database migration "+migration.version+" ("+migration.name+") failed and was rolled back. Preserve the database file and a backup before recovery. Details: "+(error instanceof Error?error.message:String(error)));
  }
 }
}

/** Roll back only the newest known reversible migration. Export a backup first. */
export async function rollbackLatestSchemaMigration(db:SQLiteDatabase):Promise<number>{
 const latest=await db.getFirstAsync<{version:number;name:string}>("SELECT version,name FROM schema_migrations ORDER BY version DESC LIMIT 1");
 if(!latest) throw new Error("No applied migration is available to roll back.");
 const migration=MIGRATIONS.find(item=>item.version===latest.version);
 if(!migration) throw new Error("Migration "+latest.version+" is not known to this app; refusing an unsafe rollback.");
 await db.withTransactionAsync(async()=>{
  await migration.down(db);
  await db.runAsync("DELETE FROM schema_migrations WHERE version=?",latest.version);
 });
 return latest.version;
}
