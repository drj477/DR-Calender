import type { SyncMutation, TemporalEntity } from "../temporal/types";
import type { HybridLogicalClock } from "./hlc";
import { mergeVersionedEntity } from "./merge";

export interface RemoteTemporalRecord {
  entity: TemporalEntity;
  clock: HybridLogicalClock;
}

export interface SyncTransport {
  push(mutations: SyncMutation[]): Promise<{ acknowledgedMutationIds: string[] }>;
  pull(input: { workspaceId: string; cursor: string | null }): Promise<{
    records: RemoteTemporalRecord[];
    cursor: string | null;
  }>;
}

export interface SyncLocalStore {
  listPendingMutations(limit: number, workspaceId?: string): Promise<SyncMutation[]>;
  acknowledgeMutation(mutationId: string): Promise<void>;
  recordMutationFailure(mutationId: string, error: string): Promise<void>;
  getCursor(workspaceId: string): Promise<string | null>;
  saveCursor(workspaceId: string, cursor: string | null): Promise<void>;
  getVersionedEntity(id: string): Promise<RemoteTemporalRecord | null>;
  applyRemoteEntity(record: RemoteTemporalRecord): Promise<void>;
}

export interface SyncRunResult {
  pushed: number;
  pulled: number;
  merged: number;
  conflicts: number;
  cursor: string | null;
}

/**
 * Transport-agnostic sync orchestrator. Remote adapters should implement
 * authentication, workspace authorization, server-side validation and
 * idempotency. The local store must persist cursor/entity changes transactionally.
 */
export class SyncCoordinator {
  constructor(
    private readonly local: SyncLocalStore,
    private readonly transport: SyncTransport,
    private readonly batchSize = 100,
  ) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
      throw new RangeError("batchSize must be an integer between 1 and 1000");
    }
  }

  async syncWorkspace(workspaceId: string): Promise<SyncRunResult> {
    if (!workspaceId.trim()) throw new Error("workspaceId is required");
    const pending = (await this.local.listPendingMutations(this.batchSize))
      .filter(mutation => mutation.workspaceId === workspaceId);
    let pushed = 0;

    if (pending.length) {
      try {
        const response = await this.transport.push(pending);
        const acknowledged = new Set(response.acknowledgedMutationIds);
        for (const mutation of pending) {
          if (acknowledged.has(mutation.mutationId)) {
            await this.local.acknowledgeMutation(mutation.mutationId);
            pushed += 1;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const mutation of pending) await this.local.recordMutationFailure(mutation.mutationId, message);
        throw error;
      }
    }

    const previousCursor = await this.local.getCursor(workspaceId);
    const remote = await this.transport.pull({ workspaceId, cursor: previousCursor });
    let merged = 0;
    let conflicts = 0;

    for (const remoteRecord of remote.records) {
      const localRecord = await this.local.getVersionedEntity(remoteRecord.entity.id);
      if (!localRecord) {
        await this.local.applyRemoteEntity(remoteRecord);
        merged += 1;
        continue;
      }
      const result = mergeVersionedEntity(localRecord, remoteRecord);
      if (result.conflict) conflicts += 1;
      if (result.winner === remoteRecord) {
        await this.local.applyRemoteEntity(remoteRecord);
        merged += 1;
      }
    }

    await this.local.saveCursor(workspaceId, remote.cursor);
    return {
      pushed,
      pulled: remote.records.length,
      merged,
      conflicts,
      cursor: remote.cursor,
    };
  }
}
