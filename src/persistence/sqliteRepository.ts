import type { SyncMutation, TemporalEntity } from "../temporal/types";

export interface SQLiteRunResult {
  changes: number;
  lastInsertRowId?: number;
}

/** Structural subset implemented by expo-sqlite's SQLiteDatabase. */
export interface SQLiteDatabaseAdapter {
  execAsync(source: string): Promise<void>;
  runAsync(sql: string, ...params: Array<string | number | null | Uint8Array>): Promise<SQLiteRunResult>;
  getAllAsync<T>(sql: string, ...params: Array<string | number | null | Uint8Array>): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: Array<string | number | null | Uint8Array>): Promise<T | null>;
  withTransactionAsync<T>(task: () => Promise<T>): Promise<T>;
}

interface TemporalRow {
  id: string;
  workspace_id: string;
  item_type: TemporalEntity["itemType"];
  title: string;
  scheduled_at: number | null;
  end_at: number | null;
  is_completed: number;
  priority: TemporalEntity["priority"];
  is_shielded: number;
  is_elastic: number;
  is_ghost: number;
  ghost_cluster_id: string | null;
  assigned_user_ids_json: string;
  rrule: string | null;
  sync_version: number;
  metadata_json: string;
  time_zone: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toEntity(row: TemporalRow): TemporalEntity {
  const metadata = JSON.parse(row.metadata_json) as TemporalEntity["metadata"];
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    itemType: row.item_type,
    title: row.title,
    scheduledAt: row.scheduled_at,
    endAt: row.end_at,
    isCompleted: row.is_completed === 1,
    priority: row.priority,
    isShielded: row.is_shielded === 1,
    isElastic: row.is_elastic === 1,
    isGhost: row.is_ghost === 1,
    ghostClusterId: row.ghost_cluster_id,
    assignedUserIds: JSON.parse(row.assigned_user_ids_json) as string[],
    rrule: row.rrule,
    syncVersion: row.sync_version,
    metadata,
    timeZone: row.time_zone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function validateEntity(entity: TemporalEntity): void {
  if (!entity.id.trim() || !entity.workspaceId.trim() || !entity.title.trim()) {
    throw new Error("Temporal entity id, workspaceId, and title are required");
  }
  if (!Number.isInteger(entity.syncVersion) || entity.syncVersion < 1) {
    throw new RangeError("syncVersion must be a positive integer");
  }
  if (entity.scheduledAt !== null && !Number.isFinite(entity.scheduledAt)) {
    throw new RangeError("scheduledAt must be finite or null");
  }
  if (entity.endAt !== null && !Number.isFinite(entity.endAt)) {
    throw new RangeError("endAt must be finite or null");
  }
  if (entity.scheduledAt !== null && entity.endAt !== null && entity.endAt <= entity.scheduledAt) {
    throw new RangeError("endAt must be after scheduledAt");
  }
}

export class SQLiteTemporalRepository {
  constructor(private readonly db: SQLiteDatabaseAdapter) {}

  async initialize(schemaSql: string): Promise<void> {
    await this.db.execAsync("PRAGMA foreign_keys = ON;");
    await this.db.execAsync(schemaSql);
  }

  async upsert(entity: TemporalEntity, mutationId: string): Promise<void> {
    validateEntity(entity);
    const now = Date.now();
    const mutation: SyncMutation<TemporalEntity> = {
      mutationId,
      workspaceId: entity.workspaceId,
      entityId: entity.id,
      entityType: entity.itemType,
      operation: "upsert",
      payload: entity,
      syncVersion: entity.syncVersion,
      createdAt: now,
      retryCount: 0,
    };

    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO temporal_entities (
          id, workspace_id, item_type, title, scheduled_at, end_at, is_completed,
          priority, is_shielded, is_elastic, is_ghost, ghost_cluster_id,
          assigned_user_ids_json, rrule, sync_version, metadata_json, time_zone,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          workspace_id=excluded.workspace_id, item_type=excluded.item_type,
          title=excluded.title, scheduled_at=excluded.scheduled_at, end_at=excluded.end_at,
          is_completed=excluded.is_completed, priority=excluded.priority,
          is_shielded=excluded.is_shielded, is_elastic=excluded.is_elastic,
          is_ghost=excluded.is_ghost, ghost_cluster_id=excluded.ghost_cluster_id,
          assigned_user_ids_json=excluded.assigned_user_ids_json, rrule=excluded.rrule,
          sync_version=excluded.sync_version, metadata_json=excluded.metadata_json,
          time_zone=excluded.time_zone, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`,
        entity.id, entity.workspaceId, entity.itemType, entity.title, entity.scheduledAt,
        entity.endAt, entity.isCompleted ? 1 : 0, entity.priority, entity.isShielded ? 1 : 0,
        entity.isElastic ? 1 : 0, entity.isGhost ? 1 : 0, entity.ghostClusterId,
        JSON.stringify(entity.assignedUserIds), entity.rrule, entity.syncVersion,
        JSON.stringify(entity.metadata ?? {}), entity.timeZone, entity.createdAt,
        entity.updatedAt, entity.deletedAt,
      );

      await this.enqueueMutation(mutation);
    });
  }

  async getById(id: string): Promise<TemporalEntity | null> {
    const row = await this.db.getFirstAsync<TemporalRow>(
      "SELECT * FROM temporal_entities WHERE id = ? AND deleted_at IS NULL LIMIT 1",
      id,
    );
    return row ? toEntity(row) : null;
  }

  async queryRange(workspaceId: string, rangeStart: number, rangeEnd: number): Promise<TemporalEntity[]> {
    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
      throw new RangeError("Invalid temporal query range");
    }
    const rows = await this.db.getAllAsync<TemporalRow>(
      `SELECT * FROM temporal_entities
       WHERE workspace_id = ? AND deleted_at IS NULL
         AND (scheduled_at IS NULL OR scheduled_at < ?)
         AND (end_at IS NULL OR end_at >= ? OR scheduled_at IS NULL)
       ORDER BY scheduled_at ASC, id ASC`,
      workspaceId, rangeEnd, rangeStart,
    );
    return rows.map(toEntity);
  }

  async listPendingMutations(limit = 100): Promise<SyncMutation[]> {
    const rows = await this.db.getAllAsync<{
      mutation_id: string; workspace_id: string; entity_id: string;
      entity_type: SyncMutation["entityType"]; operation: SyncMutation["operation"];
      payload_json: string; sync_version: number; created_at: number; retry_count: number;
    }>(
      `SELECT mutation_id, workspace_id, entity_id, entity_type, operation, payload_json,
              sync_version, created_at, retry_count
       FROM sync_outbox ORDER BY created_at ASC, mutation_id ASC LIMIT ?`,
      Math.max(1, Math.trunc(limit)),
    );
    return rows.map(row => ({
      mutationId: row.mutation_id,
      workspaceId: row.workspace_id,
      entityId: row.entity_id,
      entityType: row.entity_type,
      operation: row.operation,
      payload: JSON.parse(row.payload_json) as unknown,
      syncVersion: row.sync_version,
      createdAt: row.created_at,
      retryCount: row.retry_count,
    }));
  }

  async acknowledgeMutation(mutationId: string): Promise<void> {
    await this.db.runAsync("DELETE FROM sync_outbox WHERE mutation_id = ?", mutationId);
  }

  async recordMutationFailure(mutationId: string, error: string): Promise<void> {
    await this.db.runAsync(
      "UPDATE sync_outbox SET retry_count = retry_count + 1, last_error = ? WHERE mutation_id = ?",
      error.slice(0, 1000), mutationId,
    );
  }

  private async enqueueMutation(mutation: SyncMutation<TemporalEntity>): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO sync_outbox (
        mutation_id, workspace_id, entity_id, entity_type, operation, payload_json,
        sync_version, created_at, retry_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mutation_id) DO NOTHING`,
      mutation.mutationId, mutation.workspaceId, mutation.entityId, mutation.entityType,
      mutation.operation, JSON.stringify(mutation.payload), mutation.syncVersion,
      mutation.createdAt, mutation.retryCount,
    );
  }
}
