PRAGMA foreign_keys = ON;

-- Timestamps use UTC epoch milliseconds. Keep this schema compatible with
-- SQLite builds shipped in mobile runtimes; avoid reliance on optional JSON1.

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

-- Primary query path: workspace time-range views, excluding tombstones.
CREATE INDEX IF NOT EXISTS idx_temporal_workspace_start
  ON temporal_entities (workspace_id, scheduled_at, end_at)
  WHERE deleted_at IS NULL;

-- Fast task/reminder/alarm filtering within a workspace.
CREATE INDEX IF NOT EXISTS idx_temporal_workspace_type_start
  ON temporal_entities (workspace_id, item_type, scheduled_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_temporal_workspace_completion_due
  ON temporal_entities (workspace_id, is_completed, scheduled_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_temporal_ghost_cluster
  ON temporal_entities (workspace_id, ghost_cluster_id)
  WHERE is_ghost = 1 AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_temporal_updated_at
  ON temporal_entities (updated_at);

CREATE TABLE IF NOT EXISTS ghost_clusters (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES temporal_entities(id) ON DELETE CASCADE,
  candidate_slot_ids_json TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER,
  confirmed_slot_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ghost_clusters_expiry
  ON ghost_clusters (expires_at)
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

CREATE INDEX IF NOT EXISTS idx_checklist_entity_updated
  ON checklist_items (entity_id, updated_at)
  WHERE deleted_at IS NULL;

-- Transactional outbox: local edits are durable before remote delivery.
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

CREATE INDEX IF NOT EXISTS idx_sync_outbox_created
  ON sync_outbox (created_at, mutation_id);

CREATE TABLE IF NOT EXISTS sync_cursors (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cursor TEXT,
  last_synced_at INTEGER,
  updated_at INTEGER NOT NULL
);
