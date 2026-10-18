import type { TemporalEntity } from "./types";

export interface Occurrence {
  entityId: string;
  startAt: number;
  endAt: number | null;
  isRecurring: boolean;
}

export interface ExpandRecurrenceOptions {
  rangeStart: number;
  rangeEnd: number;
  maxOccurrences?: number;
}

type WallClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

const DAY_MS = 86400000;
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * A deliberately bounded RRULE expander for common calendar rules.
 * Supported frequencies: DAILY, WEEKLY, MONTHLY; supported selectors:
 * INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY.
 *
 * Recurrence dates are generated as wall-clock dates in entity.timeZone, then
 * converted back to instants. This keeps a 09:00 event at 09:00 local time
 * across daylight-saving transitions. Ambiguous/nonexistent local times use
 * the runtime's deterministic offset-resolution behavior.
 */
export function expandRecurrence(
  entity: TemporalEntity,
  options: ExpandRecurrenceOptions,
): Occurrence[] {
  if (entity.scheduledAt === null) return [];
  if (!Number.isFinite(options.rangeStart) || !Number.isFinite(options.rangeEnd) || options.rangeEnd <= options.rangeStart) {
    throw new RangeError("Recurrence range must be finite and rangeEnd > rangeStart");
  }
  const duration = entity.endAt === null ? null : entity.endAt - entity.scheduledAt;
  if (duration !== null && duration <= 0) throw new RangeError("Recurring event endAt must be after scheduledAt");
  const maxOccurrences = options.maxOccurrences ?? 500;
  if (!Number.isInteger(maxOccurrences) || maxOccurrences < 1 || maxOccurrences > 10000) {
    throw new RangeError("maxOccurrences must be an integer between 1 and 10000");
  }

  if (!entity.rrule) {
    const endAt = entity.endAt;
    return entity.scheduledAt < options.rangeEnd && (endAt ?? entity.scheduledAt) >= options.rangeStart
      ? [{ entityId: entity.id, startAt: entity.scheduledAt, endAt, isRecurring: false }]
      : [];
  }

  const parts = new Map<string, string>();
  for (const segment of entity.rrule.replace(/^RRULE:/i, "").split(";")) {
    const equals = segment.indexOf("=");
    if (equals < 1) throw new Error(`Invalid RRULE segment: ${segment}`);
    const key = segment.slice(0, equals).toUpperCase();
    if (parts.has(key)) throw new Error(`Duplicate RRULE part: ${key}`);
    parts.set(key, segment.slice(equals + 1).toUpperCase());
  }
  const allowed = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY"]);
  for (const key of parts.keys()) if (!allowed.has(key)) throw new Error(`Unsupported RRULE part: ${key}`);
  const frequency = parts.get("FREQ");
  if (frequency !== "DAILY" && frequency !== "WEEKLY" && frequency !== "MONTHLY") {
    throw new Error(`Unsupported RRULE frequency: ${frequency ?? "(missing)"}`);
  }
  const interval = Number(parts.get("INTERVAL") ?? 1);
  const count = parts.has("COUNT") ? Number(parts.get("COUNT")) : Infinity;
  if (!Number.isInteger(interval) || interval < 1 || !((Number.isInteger(count) && count > 0) || count === Infinity)) {
    throw new Error("RRULE INTERVAL and COUNT must be positive integers");
  }
  const until = parts.has("UNTIL") ? parseUntil(parts.get("UNTIL")!) : Infinity;
  const byDay = parts.get("BYDAY")?.split(",").map(day => day.slice(-2));
  const byMonthDay = parts.get("BYMONTHDAY")?.split(",").map(Number);
  if (byDay?.some(day => !WEEKDAY_CODES.includes(day))) throw new Error("RRULE BYDAY contains an unsupported weekday");
  if (byMonthDay?.some(day => !Number.isInteger(day) || day < 1 || day > 31)) {
    throw new Error("RRULE BYMONTHDAY values must be integers from 1 to 31");
  }

  const timeZone = entity.timeZone || "UTC";
  const startWall = getWallClockParts(entity.scheduledAt, timeZone);
  const startDate = new Date(Date.UTC(startWall.year, startWall.month - 1, startWall.day));
  const cursor = new Date(startDate);
  const occurrences: Occurrence[] = [];
  let generated = 0;
  let iterations = 0;
  const maxIterations = Math.max(maxOccurrences * 400, 10000);
  // Include local dates before the range so long events that overlap rangeStart
  // are retained. For unbounded rules, jump directly to this local-date window;
  // COUNT rules must scan from DTSTART to preserve their ordinal occurrence count.
  const rangeWall = getWallClockParts(options.rangeStart, timeZone);
  const rangeDate = Date.UTC(rangeWall.year, rangeWall.month - 1, rangeWall.day);
  const overlapDays = Math.ceil((duration ?? 0) / DAY_MS) + 2;
  const scanFromDate = rangeDate - overlapDays * DAY_MS;
  if (count === Infinity && scanFromDate > cursor.getTime()) {
    // Keep recurrence phase anchored to DTSTART while avoiding years of scans.
    // Never start before DTSTART: negative modulo changes weekly interval phase.
    cursor.setTime(Math.max(startDate.getTime(), scanFromDate));
  }
  const stopWall = getWallClockParts(options.rangeEnd, timeZone);
  const stopDate = Date.UTC(stopWall.year, stopWall.month - 1, stopWall.day) + DAY_MS;

  while (cursor.getTime() < stopDate && generated < count) {
    if (++iterations > maxIterations) throw new Error("RRULE expansion exceeded safety iteration limit");
    const elapsedDays = Math.floor((cursor.getTime() - startDate.getTime()) / DAY_MS);
    const elapsedMonths = (cursor.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + cursor.getUTCMonth() - startDate.getUTCMonth();
    const matchesFrequency =
      frequency === "DAILY" ? elapsedDays % interval === 0 :
      frequency === "WEEKLY" ? Math.floor(elapsedDays / 7) % interval === 0 :
      elapsedMonths % interval === 0;
    const weekday = WEEKDAY_CODES[cursor.getUTCDay()];
    // A plain MONTHLY rule defaults to the DTSTART day-of-month (for example,
    // the 31st), rather than matching every day in each eligible month. If a
    // month lacks that day, it is skipped; we do not clamp to month-end.
    const matchesDay = frequency === "MONTHLY" && !byDay && !byMonthDay
      ? cursor.getUTCDate() === startWall.day
      : (!byDay || byDay.includes(weekday ?? "")) &&
        (!byMonthDay || byMonthDay.includes(cursor.getUTCDate()));

    if (matchesFrequency && matchesDay) {
      const wall: WallClockParts = {
        ...startWall,
        year: cursor.getUTCFullYear(),
        month: cursor.getUTCMonth() + 1,
        day: cursor.getUTCDate(),
      };
      const occurrenceStart = wallClockToEpoch(wall, timeZone);
      if (occurrenceStart >= entity.scheduledAt && occurrenceStart <= until) {
        generated += 1;
        let occurrenceEnd = duration === null ? null : occurrenceStart + duration;
        if (duration !== null && entity.metadata?.event?.kind === "all-day") {
          // All-day duration is a count of local calendar days, not 24-hour
          // chunks; this preserves midnight boundaries across DST changes.
          const endWall = getWallClockParts(entity.endAt!, timeZone);
          const endDateUtc = Date.UTC(endWall.year, endWall.month - 1, endWall.day);
          const startDateUtc = Date.UTC(startWall.year, startWall.month - 1, startWall.day);
          const calendarDays = Math.max(1, Math.round((endDateUtc - startDateUtc) / DAY_MS));
          const nextWallDate = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + calendarDays));
          occurrenceEnd = wallClockToEpoch({
            ...wall,
            year: nextWallDate.getUTCFullYear(),
            month: nextWallDate.getUTCMonth() + 1,
            day: nextWallDate.getUTCDate(),
            hour: 0, minute: 0, second: 0, millisecond: 0,
          }, timeZone);
        }
        if (occurrenceStart < options.rangeEnd && (occurrenceEnd ?? occurrenceStart) >= options.rangeStart) {
          occurrences.push({
            entityId: entity.id,
            startAt: occurrenceStart,
            endAt: occurrenceEnd,
            isRecurring: true,
          });
          if (occurrences.length >= maxOccurrences) break;
        }
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return occurrences;
}

function getWallClockParts(epochMs: number, timeZone: string): WallClockParts {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${timeZone}`);
  }
  const parts = formatter.formatToParts(new Date(epochMs));
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
    millisecond: ((epochMs % 1000) + 1000) % 1000,
  };
}

function wallClockToEpoch(wall: WallClockParts, timeZone: string): number {
  const targetUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, wall.millisecond);
  const matchesWall = (epoch:number, target:number) => {
    const actual=getWallClockParts(epoch,timeZone);
    const expected=new Date(target);
    return actual.year===expected.getUTCFullYear()&&actual.month===expected.getUTCMonth()+1&&actual.day===expected.getUTCDate()&&actual.hour===expected.getUTCHours()&&actual.minute===expected.getUTCMinutes()&&actual.second===expected.getUTCSeconds()&&actual.millisecond===expected.getUTCMilliseconds();
  };
  const exactCandidates = (target:number) => {
    const offsets=new Set<number>();
    for(const delta of [-36,-12,0,12,36]){
      const sample=target+delta*60*60_000;
      const actual=getWallClockParts(sample,timeZone);
      const represented=Date.UTC(actual.year,actual.month-1,actual.day,actual.hour,actual.minute,actual.second,actual.millisecond);
      offsets.add(represented-sample);
    }
    const candidates=[...offsets].map(offset=>target-offset).filter(candidate=>matchesWall(candidate,target));
    return [...new Set(candidates)].sort((a,b)=>a-b);
  };
  const candidates=exactCandidates(targetUtc);
  // In a fall-back fold, choose the earlier instant so repeated local wall times
  // remain deterministic across platforms.
  if(candidates.length)return candidates[0]!;
  // A spring-forward gap has no exact instant. Advance the requested wall clock
  // minute-by-minute to the first valid local time after the gap.
  for(let minute=1;minute<=180;minute++){
    const shifted=targetUtc+minute*60_000;
    const resolved=exactCandidates(shifted);
    if(resolved.length)return resolved[0]!;
  }
  throw new RangeError(`Could not resolve local time in ${timeZone}`);
}

function parseUntil(value: string): number {
  const match = /^(\\d{4})(\\d{2})(\\d{2})(?:T(\\d{2})(\\d{2})(\\d{2})?(Z)?)?$/.exec(value);
  if (!match) throw new Error(`Unsupported RRULE UNTIL value: ${value}`);
  const [, y, m, d, hh = "23", mm = "59", ss = "59", z = "Z"] = match;
  if (z !== "Z") throw new Error("UNTIL must be a UTC value ending in Z");
  return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
}
