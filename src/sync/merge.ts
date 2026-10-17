import type { TemporalEntity } from "../temporal/types";
import { compareHLC, type HybridLogicalClock } from "./hlc";

export interface VersionedEntity {
  entity: TemporalEntity;
  clock: HybridLogicalClock;
}

export interface MergeResult {
  winner: VersionedEntity;
  loser: VersionedEntity;
  conflict: boolean;
}

/**
 * Deterministic LWW register merge. HLC comparison is primary; entity version,
 * update time and id are stable tie-breakers for malformed/equal clock data.
 */
export function mergeVersionedEntity(
  local: VersionedEntity,
  remote: VersionedEntity,
): MergeResult {
  const clockOrder = compareHLC(local.clock, remote.clock);
  let localWins: boolean;
  if (clockOrder !== 0) localWins = clockOrder > 0;
  else if (local.entity.syncVersion !== remote.entity.syncVersion) {
    localWins = local.entity.syncVersion > remote.entity.syncVersion;
  } else if (local.entity.updatedAt !== remote.entity.updatedAt) {
    localWins = local.entity.updatedAt > remote.entity.updatedAt;
  } else {
    localWins = local.entity.id.localeCompare(remote.entity.id) >= 0;
  }

  const winner = localWins ? local : remote;
  const loser = localWins ? remote : local;
  const conflict =
    local.entity.syncVersion !== remote.entity.syncVersion ||
    local.entity.updatedAt !== remote.entity.updatedAt ||
    local.clock.wallTime !== remote.clock.wallTime ||
    local.clock.logical !== remote.clock.logical ||
    local.entity.deletedAt !== remote.entity.deletedAt;

  return { winner, loser, conflict };
}
