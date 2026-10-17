export interface DragRange {
  startAt: number;
  endAt: number;
}

export interface SnapOptions {
  snapMinutes?: 5 | 10 | 15 | 30 | 60;
  minimumDurationMinutes?: number;
  dayStartAt?: number;
  dayEndAt?: number;
}

/** Snap an epoch timestamp to the nearest grid boundary. */
export function snapTimestamp(timestamp: number, snapMinutes: number = 15): number {
  if (!Number.isFinite(timestamp)) throw new RangeError("timestamp must be finite");
  if (!Number.isFinite(snapMinutes) || snapMinutes <= 0 || 1440 % snapMinutes !== 0) {
    throw new RangeError("snapMinutes must be a positive divisor of 1440");
  }
  const quantum = snapMinutes * 60_000;
  return Math.round(timestamp / quantum) * quantum;
}

/** Moves an event while preserving duration, clamped to an optional viewport. */
export function moveTemporalRange(
  original: DragRange,
  proposedStartAt: number,
  options: SnapOptions = {},
): DragRange {
  if (!Number.isFinite(original.startAt) || !Number.isFinite(original.endAt) || original.endAt <= original.startAt) {
    throw new RangeError("Original range must have a positive duration");
  }
  if (!Number.isFinite(proposedStartAt)) throw new RangeError("proposedStartAt must be finite");
  const duration = original.endAt - original.startAt;
  const snappedStart = snapTimestamp(proposedStartAt, options.snapMinutes ?? 15);
  const minimumDuration = (options.minimumDurationMinutes ?? 5) * 60_000;
  if (duration < minimumDuration) throw new RangeError("Original duration is below the configured minimum");

  let startAt = snappedStart;
  if (options.dayStartAt !== undefined) startAt = Math.max(startAt, options.dayStartAt);
  if (options.dayEndAt !== undefined) startAt = Math.min(startAt, options.dayEndAt - duration);
  return { startAt, endAt: startAt + duration };
}

/** Resize an event from its start or end edge, preserving the opposite edge. */
export function resizeTemporalRange(
  original: DragRange,
  edge: "start" | "end",
  proposedAt: number,
  options: SnapOptions = {},
): DragRange {
  if (original.endAt <= original.startAt) throw new RangeError("Original range must have a positive duration");
  const minimumDuration = (options.minimumDurationMinutes ?? 5) * 60_000;
  const snapped = snapTimestamp(proposedAt, options.snapMinutes ?? 15);
  if (edge === "start") {
    const startAt = Math.min(snapped, original.endAt - minimumDuration);
    return { startAt: Math.max(startAt, options.dayStartAt ?? -Infinity), endAt: original.endAt };
  }
  const endAt = Math.max(snapped, original.startAt + minimumDuration);
  return { startAt: original.startAt, endAt: Math.min(endAt, options.dayEndAt ?? Infinity) };
}

/** Returns true when half-open time ranges overlap. */
export function temporalRangesOverlap(a: DragRange, b: DragRange): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}
