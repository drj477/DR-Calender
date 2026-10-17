import type { TemporalEntity } from "./types";

export interface LayoutItem {
  id: string;
  startAt: number;
  endAt: number;
  columnIndex: number;
  columnCount: number;
  leftFraction: number;
  widthFraction: number;
}

export interface OverlapOptions {
  /** Minimum event duration used only when endAt is null. Defaults to 30 minutes. */
  defaultDurationMs?: number;
  /** Filter items to a day window [dayStart, dayEnd). */
  dayEnd?: Date;
}

interface Interval {
  id: string;
  startAt: number;
  endAt: number;
  sourceIndex: number;
}

/**
 * Computes an interval-graph layout. Overlapping intervals occupy separate
 * columns; each connected overlap group shares the group's maximum column
 * count so cards align consistently within the group.
 */
export function calculateOverlappingLayout(
  items: TemporalEntity[],
  dayStart: Date,
  options: OverlapOptions = {},
): LayoutItem[] {
  const startBoundary = dayStart.getTime();
  if (!Number.isFinite(startBoundary)) throw new RangeError("dayStart must be a valid Date");

  const defaultDurationMs = options.defaultDurationMs ?? 30 * 60_000;
  if (!Number.isFinite(defaultDurationMs) || defaultDurationMs <= 0) {
    throw new RangeError("defaultDurationMs must be a positive finite number");
  }

  const endBoundary = options.dayEnd?.getTime() ?? startBoundary + 24 * 60 * 60_000;
  if (!Number.isFinite(endBoundary) || endBoundary <= startBoundary) {
    throw new RangeError("dayEnd must be after dayStart");
  }

  const intervals: Interval[] = [];
  items.forEach((item, sourceIndex) => {
    if (item.deletedAt !== null || item.scheduledAt === null) return;
    const rawEnd = item.endAt ?? item.scheduledAt + defaultDurationMs;
    if (!Number.isFinite(item.scheduledAt) || !Number.isFinite(rawEnd) || rawEnd <= item.scheduledAt) return;
    const startAt = Math.max(item.scheduledAt, startBoundary);
    const endAt = Math.min(rawEnd, endBoundary);
    if (endAt <= startAt) return;
    intervals.push({ id: item.id, startAt, endAt, sourceIndex });
  });

  intervals.sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt || a.sourceIndex - b.sourceIndex);

  type Assigned = Interval & { columnIndex: number; groupId: number };
  const assigned: Assigned[] = [];
  let groupId = -1;
  let groupMaxEnd = -Infinity;
  let active: Array<{ endAt: number; columnIndex: number }> = [];
  let groupItems: Assigned[] = [];
  let groupColumnCount = 0;

  const flushGroup = () => {
    for (const item of groupItems) {
      (item as Assigned & { finalColumnCount?: number }).finalColumnCount = groupColumnCount;
    }
    groupItems = [];
    active = [];
    groupColumnCount = 0;
  };

  for (const interval of intervals) {
    if (groupItems.length === 0 || interval.startAt >= groupMaxEnd) {
      if (groupItems.length) flushGroup();
      groupId += 1;
      groupMaxEnd = interval.endAt;
    } else {
      groupMaxEnd = Math.max(groupMaxEnd, interval.endAt);
    }

    active = active.filter(slot => slot.endAt > interval.startAt);
    const occupied = new Set(active.map(slot => slot.columnIndex));
    let columnIndex = 0;
    while (occupied.has(columnIndex)) columnIndex += 1;
    active.push({ endAt: interval.endAt, columnIndex });
    groupColumnCount = Math.max(groupColumnCount, columnIndex + 1);
    const assignedItem: Assigned = { ...interval, columnIndex, groupId };
    groupItems.push(assignedItem);
    assigned.push(assignedItem);
  }
  flushGroup();

  return assigned.map(item => {
    const columnCount = (item as Assigned & { finalColumnCount?: number }).finalColumnCount ?? 1;
    return {
      id: item.id,
      startAt: item.startAt,
      endAt: item.endAt,
      columnIndex: item.columnIndex,
      columnCount,
      leftFraction: item.columnIndex / columnCount,
      widthFraction: 1 / columnCount,
    };
  }).sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt);
}
