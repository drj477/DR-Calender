import type { GhostCluster, TemporalEntity } from "./types";

export interface ScheduleConflict {
  itemId: string;
  conflictingItemId: string;
  startAt: number;
  endAt: number;
}

export interface ScheduleMove {
  itemId: string;
  previousStartAt: number;
  previousEndAt: number;
  nextStartAt: number;
  nextEndAt: number;
  reason: "hard-event-overlap" | "ghost-slot-confirmed";
}

export interface ResolutionResult {
  moves: ScheduleMove[];
  conflicts: ScheduleConflict[];
  expiredGhostClusterIds: string[];
  removedGhostClusterIds: string[];
  unresolvedItemIds: string[];
}

export interface ResolveScheduleOptions {
  now?: number;
  /** Latest time an elastic item may be moved to. Defaults to +14 days. */
  horizonMs?: number;
  /** Search increment for gaps. Defaults to 5 minutes. */
  stepMs?: number;
}

function rangeOf(item: TemporalEntity, fallbackDurationMs = 30 * 60_000) {
  if (item.scheduledAt === null) return null;
  const endAt = item.endAt ?? item.scheduledAt + fallbackDurationMs;
  if (!Number.isFinite(item.scheduledAt) || !Number.isFinite(endAt) || endAt <= item.scheduledAt) return null;
  return { startAt: item.scheduledAt, endAt };
}

function overlaps(a: { startAt: number; endAt: number }, b: { startAt: number; endAt: number }) {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/**
 * Deterministic first-fit resolver. Hard events are never moved. Elastic items
 * are considered in start-time order and shifted forward to the first free
 * interval, preserving duration. The caller should persist returned moves in
 * one local database transaction and enqueue sync mutations atomically.
 */
export function resolveScheduleConflicts(
  hardEvents: TemporalEntity[],
  elasticItems: TemporalEntity[],
  ghostClusters: GhostCluster[],
  options: ResolveScheduleOptions = {},
): ResolutionResult {
  const now = options.now ?? Date.now();
  const horizonMs = options.horizonMs ?? 14 * 24 * 60 * 60_000;
  const stepMs = options.stepMs ?? 5 * 60_000;
  if (!Number.isFinite(now) || !Number.isFinite(horizonMs) || horizonMs <= 0) {
    throw new RangeError("now must be finite and horizonMs must be positive");
  }
  if (!Number.isFinite(stepMs) || stepMs <= 0) throw new RangeError("stepMs must be positive");

  const fixed = hardEvents
    .filter(item => item.deletedAt === null)
    .map(item => ({ item, range: rangeOf(item) }))
    .filter((entry): entry is { item: TemporalEntity; range: NonNullable<ReturnType<typeof rangeOf>> } => entry.range !== null)
    .sort((a, b) => a.range.startAt - b.range.startAt);

  const occupied = fixed.map(entry => ({ ...entry.range, itemId: entry.item.id }));
  const moves: ScheduleMove[] = [];
  const conflicts: ScheduleConflict[] = [];
  const unresolvedItemIds: string[] = [];

  const movable = elasticItems
    .filter(item => item.deletedAt === null && item.isElastic && item.scheduledAt !== null)
    .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0) || a.id.localeCompare(b.id));

  for (const item of movable) {
    const original = rangeOf(item);
    if (!original) continue;
    const blockers = occupied.filter(range => overlaps(original, range));
    for (const blocker of blockers) {
      conflicts.push({
        itemId: item.id,
        conflictingItemId: blocker.itemId,
        startAt: Math.max(original.startAt, blocker.startAt),
        endAt: Math.min(original.endAt, blocker.endAt),
      });
    }
    if (blockers.length === 0) {
      occupied.push({ ...original, itemId: item.id });
      continue;
    }

    const duration = original.endAt - original.startAt;
    const earliest = Math.max(original.startAt, now);
    const latest = original.startAt + horizonMs;
    let candidateStart = Math.ceil(earliest / stepMs) * stepMs;
    let found: { startAt: number; endAt: number } | null = null;

    while (candidateStart <= latest) {
      const candidate = { startAt: candidateStart, endAt: candidateStart + duration };
      if (!occupied.some(range => overlaps(candidate, range))) {
        found = candidate;
        break;
      }
      candidateStart += stepMs;
    }

    if (!found) {
      unresolvedItemIds.push(item.id);
      continue;
    }

    moves.push({
      itemId: item.id,
      previousStartAt: original.startAt,
      previousEndAt: original.endAt,
      nextStartAt: found.startAt,
      nextEndAt: found.endAt,
      reason: "hard-event-overlap",
    });
    occupied.push({ ...found, itemId: item.id });
  }

  const expiredGhostClusterIds = ghostClusters
    .filter(cluster => cluster.confirmedSlotId === null && cluster.expiresAt !== null && cluster.expiresAt <= now)
    .map(cluster => cluster.id);
  const removedGhostClusterIds = ghostClusters
    .filter(cluster => cluster.confirmedSlotId !== null)
    .map(cluster => cluster.id);

  return { moves, conflicts, expiredGhostClusterIds, removedGhostClusterIds, unresolvedItemIds };
}
