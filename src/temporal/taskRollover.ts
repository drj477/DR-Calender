import type { TemporalEntity } from "./types";

export interface TaskRolloverUpdate {
  entityId: string;
  previousScheduledAt: number | null;
  nextScheduledAt: number;
  nextSyncVersion: number;
}

/**
 * Creates rollover proposals for incomplete tasks from earlier calendar days.
 * This function is pure: persistence and sync-outbox writes remain the caller's
 * responsibility and should happen atomically.
 */
export function planTaskRollover(
  tasks: TemporalEntity[],
  now: number,
  options: { dayBoundaryOffsetMinutes?: number; maxAgeDays?: number } = {},
): TaskRolloverUpdate[] {
  if (!Number.isFinite(now)) throw new RangeError("now must be finite");
  const offset = (options.dayBoundaryOffsetMinutes ?? 0) * 60_000;
  const maxAgeDays = options.maxAgeDays ?? 90;
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1) throw new RangeError("maxAgeDays must be a positive integer");

  const shiftedNow = new Date(now + offset);
  shiftedNow.setUTCHours(0, 0, 0, 0);
  const todayStart = shiftedNow.getTime() - offset;
  const earliest = todayStart - maxAgeDays * 24 * 60 * 60_000;

  return tasks
    .filter(task =>
      task.itemType === "task" &&
      !task.isCompleted &&
      task.deletedAt === null &&
      task.scheduledAt !== null &&
      task.scheduledAt < todayStart &&
      task.scheduledAt >= earliest,
    )
    .map(task => ({
      entityId: task.id,
      previousScheduledAt: task.scheduledAt,
      nextScheduledAt: todayStart,
      nextSyncVersion: task.syncVersion + 1,
    }));
}
