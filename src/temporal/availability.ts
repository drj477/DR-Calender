import type { TemporalEntity } from "./types";

export interface FreeSlot {
  startAt: number;
  endAt: number;
  durationMinutes: number;
}

export interface AvailabilityOptions {
  rangeStart: number;
  rangeEnd: number;
  durationMinutes: number;
  workingDayStartMinute?: number;
  workingDayEndMinute?: number;
  timeZoneOffsetMinutes?: number;
  stepMinutes?: number;
  excludeItemIds?: string[];
}

/**
 * Finds candidate free slots for a single fixed-offset day/window.
 * For true IANA timezone/DST handling, compute the window boundaries in a
 * timezone-aware layer and pass their epoch values here.
 */
export function findFreeSlots(
  items: TemporalEntity[],
  options: AvailabilityOptions,
): FreeSlot[] {
  const {
    rangeStart,
    rangeEnd,
    durationMinutes,
    workingDayStartMinute = 9 * 60,
    workingDayEndMinute = 17 * 60,
    timeZoneOffsetMinutes = 0,
    stepMinutes = 15,
    excludeItemIds = [],
  } = options;
  if (![rangeStart, rangeEnd, durationMinutes, workingDayStartMinute, workingDayEndMinute, timeZoneOffsetMinutes, stepMinutes].every(Number.isFinite)) {
    throw new RangeError("Availability arguments must be finite numbers");
  }
  if (rangeEnd <= rangeStart || durationMinutes <= 0 || stepMinutes <= 0) {
    throw new RangeError("Invalid availability range or duration");
  }
  if (workingDayStartMinute < 0 || workingDayStartMinute >= 1440 ||
      workingDayEndMinute <= workingDayStartMinute || workingDayEndMinute > 1440) {
    throw new RangeError("Invalid working-day boundaries");
  }

  const excluded = new Set(excludeItemIds);
  const busy = items
    .filter(item => !excluded.has(item.id) && item.deletedAt === null && !item.isCompleted)
    .filter(item => item.scheduledAt !== null)
    .map(item => ({
      startAt: item.scheduledAt!,
      endAt: item.endAt ?? item.scheduledAt! + 30 * 60_000,
    }))
    .filter(range => range.endAt > range.startAt && range.startAt < rangeEnd && range.endAt > rangeStart)
    .sort((a, b) => a.startAt - b.startAt);

  const merged: Array<{ startAt: number; endAt: number }> = [];
  for (const range of busy) {
    const last = merged[merged.length - 1];
    if (last && range.startAt <= last.endAt) last.endAt = Math.max(last.endAt, range.endAt);
    else merged.push({ ...range });
  }

  const offsetMs = timeZoneOffsetMinutes * 60_000;
  const dayCursor = new Date(rangeStart + offsetMs);
  dayCursor.setUTCHours(0, 0, 0, 0);
  let dayStart = dayCursor.getTime() - offsetMs;
  const slots: FreeSlot[] = [];
  const durationMs = durationMinutes * 60_000;
  const stepMs = stepMinutes * 60_000;

  while (dayStart < rangeEnd) {
    const workStart = Math.max(rangeStart, dayStart + workingDayStartMinute * 60_000);
    const workEnd = Math.min(rangeEnd, dayStart + workingDayEndMinute * 60_000);
    for (let startAt = Math.ceil(workStart / stepMs) * stepMs; startAt + durationMs <= workEnd; startAt += stepMs) {
      const endAt = startAt + durationMs;
      if (!merged.some(range => startAt < range.endAt && range.startAt < endAt)) {
        slots.push({ startAt, endAt, durationMinutes });
      }
    }
    dayStart += 24 * 60 * 60_000;
  }
  return slots;
}
