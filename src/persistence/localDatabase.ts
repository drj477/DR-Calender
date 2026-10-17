import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { SQLiteTemporalRepository } from "./sqliteRepository";
import type { TemporalEntity } from "../temporal/types";
import { runSchemaMigrations } from "./schemaMigrations";

const DATABASE_NAME = "dr-calender.db";
export const DEFAULT_WORKSPACE_ID = "workspace-personal";

const LOCAL_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  workspace_type TEXT NOT NULL CHECK (workspace_type IN ('personal', 'family', 'team', 'project')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS temporal_entities (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('event', 'task', 'reminder', 'alarm')),
  title TEXT NOT NULL,
  scheduled_at INTEGER,
  end_at INTEGER,
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  is_shielded INTEGER NOT NULL DEFAULT 0 CHECK (is_shielded IN (0, 1)),
  is_elastic INTEGER NOT NULL DEFAULT 0 CHECK (is_elastic IN (0, 1)),
  is_ghost INTEGER NOT NULL DEFAULT 0 CHECK (is_ghost IN (0, 1)),
  ghost_cluster_id TEXT,
  assigned_user_ids_json TEXT NOT NULL DEFAULT '[]',
  rrule TEXT,
  sync_version INTEGER NOT NULL DEFAULT 1 CHECK (sync_version >= 1),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CHECK (end_at IS NULL OR scheduled_at IS NULL OR end_at > scheduled_at)
);
CREATE INDEX IF NOT EXISTS idx_temporal_workspace_start
  ON temporal_entities (workspace_id, scheduled_at, end_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_temporal_workspace_type_start
  ON temporal_entities (workspace_id, item_type, scheduled_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_temporal_workspace_completion_due
  ON temporal_entities (workspace_id, is_completed, scheduled_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_temporal_ghost_cluster
  ON temporal_entities (workspace_id, ghost_cluster_id) WHERE is_ghost = 1 AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_temporal_updated_at ON temporal_entities (updated_at);
CREATE TABLE IF NOT EXISTS ghost_clusters (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES temporal_entities(id) ON DELETE CASCADE,
  candidate_slot_ids_json TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER,
  confirmed_slot_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ghost_clusters_expiry ON ghost_clusters (expires_at)
  WHERE expires_at IS NOT NULL AND confirmed_slot_id IS NULL;
CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES temporal_entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
  assigned_user_id TEXT,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_checklist_entity_updated ON checklist_items (entity_id, updated_at)
  WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS sync_outbox (
  mutation_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('event', 'task', 'reminder', 'alarm')),
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload_json TEXT NOT NULL,
  sync_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_created ON sync_outbox (created_at, mutation_id);
CREATE TABLE IF NOT EXISTS sync_entity_clocks (
  entity_id TEXT PRIMARY KEY NOT NULL,
  clock_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_cursors (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cursor TEXT,
  last_synced_at INTEGER,
  updated_at INTEGER NOT NULL
);
`;

export interface LocalCalendarDatabase {
  db: SQLiteDatabase;
  repository: SQLiteTemporalRepository;
  workspaceId: string;
}

let initialization: Promise<LocalCalendarDatabase> | null = null;

/** Opens the local DB and ensures the default personal workspace exists. */
export function initializeLocalDatabase(): Promise<LocalCalendarDatabase> {
  if (initialization) return initialization;
  initialization = (async () => {
    const db = await openDatabaseAsync(DATABASE_NAME);
    await db.execAsync("PRAGMA journal_mode = WAL;");
    await db.execAsync(LOCAL_SCHEMA);
    await runSchemaMigrations(db);
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO workspaces (id, name, workspace_type, created_at, updated_at)
       VALUES (?, ?, 'personal', ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      DEFAULT_WORKSPACE_ID, "Personal", now, now,
    );
    await db.runAsync(
      `INSERT INTO workspace_members (workspace_id, user_id, role, display_name, created_at, updated_at)
       VALUES (?, ?, 'owner', ?, ?, ?)
       ON CONFLICT(workspace_id, user_id) DO NOTHING`,
      DEFAULT_WORKSPACE_ID, "local-user", "You", now, now,
    );
    const activeSetting = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = 'active_workspace_id' LIMIT 1");
    const activeId = activeSetting?.value ?? DEFAULT_WORKSPACE_ID;
    const activeRow = await db.getFirstAsync<{ id: string }>("SELECT id FROM workspaces WHERE id = ? LIMIT 1", activeId);
    const workspaceId = activeRow?.id ?? DEFAULT_WORKSPACE_ID;
    const repository = new SQLiteTemporalRepository(db as never);
    return { db, repository, workspaceId };
  })().catch(error => {
    initialization = null;
    throw error;
  });
  return initialization;
}

/**
 * Re-read the persisted active workspace after an in-place restore. The SQLite
 * handle remains valid; replacing the cached initialization result makes future
 * callers resolve to the restored workspace instead of stale pre-restore state.
 */
export async function refreshLocalDatabaseAfterRestore(
  current: LocalCalendarDatabase,
): Promise<LocalCalendarDatabase> {
  const setting = await current.db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'active_workspace_id' LIMIT 1",
  );
  const requestedId = setting?.value ?? DEFAULT_WORKSPACE_ID;
  const workspace = await current.db.getFirstAsync<{ id: string }>(
    "SELECT id FROM workspaces WHERE id = ? LIMIT 1",
    requestedId,
  );
  const fallback = await current.db.getFirstAsync<{ id: string }>(
    "SELECT id FROM workspaces WHERE id = ? LIMIT 1",
    DEFAULT_WORKSPACE_ID,
  );
  const workspaceId = workspace?.id ?? fallback?.id;
  if (!workspaceId) throw new Error("Restored database contains no usable workspace.");
  const refreshed = { ...current, workspaceId };
  initialization = Promise.resolve(refreshed);
  return refreshed;
}

export function makeTaskEntity(input: {
  id: string;
  title: string;
  dueAt: number | null;
  assigneeId?: string;
  workspaceId?: string;
}): TemporalEntity {
  const now = Date.now();
  return {
    id: input.id,
    workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE_ID,
    itemType: "task",
    title: input.title,
    scheduledAt: input.dueAt,
    endAt: null,
    isCompleted: false,
    priority: "normal",
    isShielded: false,
    isElastic: false,
    isGhost: false,
    ghostClusterId: null,
    assignedUserIds: [input.assigneeId ?? "local-user"],
    rrule: null,
    syncVersion: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    metadata: {
      task: {
        dueAt: input.dueAt,
        assignee: { id: input.assigneeId ?? "local-user", name: "You", avatarUrl: null },
      },
    },
  };
}

/** Create a local mirror for a server-authorized workspace and make it active. */
export async function activateLocalWorkspace(
  current: LocalCalendarDatabase,
  input: { id: string; name: string; type: "personal" | "family" | "team" | "project"; role: "owner" | "admin" | "editor" | "viewer" },
): Promise<LocalCalendarDatabase> {
  const now = Date.now();
  await current.db.runAsync(
    `INSERT INTO workspaces(id,name,workspace_type,created_at,updated_at) VALUES(?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name,workspace_type=excluded.workspace_type,updated_at=excluded.updated_at`,
    input.id,input.name,input.type,now,now,
  );
  await current.db.runAsync(
    `INSERT INTO workspace_members(workspace_id,user_id,role,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)
     ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at`,
    input.id,"local-user",input.role,"You",now,now,
  );
  await current.db.runAsync(
    `INSERT INTO app_settings(key,value,updated_at) VALUES('active_workspace_id',?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    input.id,now,
  );
  return { ...current, workspaceId: input.id };
}
