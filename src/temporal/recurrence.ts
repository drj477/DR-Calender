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

/**
 * A deliberately bounded RRULE expander for common calendar rules.
 * Supported frequencies: DAILY, WEEKLY, MONTHLY; supported selectors:
 * INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY. Unsupported rule parts fail
 * explicitly rather than silently producing an incomplete schedule.
 *
 * This engine expands wall-clock dates using UTC calendar arithmetic. For
 * timezone-aware recurring events, callers should expand in the event's IANA
 * timezone with a timezone-aware adapter before relying on DST boundaries.
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
    parts.set(segment.slice(0, equals).toUpperCase(), segment.slice(equals + 1).toUpperCase());
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
  const weekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

  const start = new Date(entity.scheduledAt);
  const cursor = new Date(start);
  const occurrences: Occurrence[] = [];
  let generated = 0;
  let iterations = 0;
  const maxIterations = Math.max(maxOccurrences * 400, 10000);

  while (cursor.getTime() < options.rangeEnd && cursor.getTime() <= until && generated < count) {
    if (++iterations > maxIterations) throw new Error("RRULE expansion exceeded safety iteration limit");
    const elapsedDays = Math.floor((Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()) -
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) / 86400000);
    const elapsedMonths = (cursor.getUTCFullYear() - start.getUTCFullYear()) * 12 + cursor.getUTCMonth() - start.getUTCMonth();
    const matchesFrequency =
      frequency === "DAILY" ? elapsedDays % interval === 0 :
      frequency === "WEEKLY" ? Math.floor(elapsedDays / 7) % interval === 0 :
      elapsedMonths % interval === 0;
    const matchesDay = (!byDay || byDay.includes(weekdayCodes[cursor.getUTCDay()])) &&
      (!byMonthDay || byMonthDay.includes(cursor.getUTCDate()));

    if (matchesFrequency && matchesDay && cursor.getTime() >= entity.scheduledAt) {
      generated += 1;
      const occurrenceStart = cursor.getTime();
      const occurrenceEnd = duration === null ? null : occurrenceStart + duration;
      if ((occurrenceEnd ?? occurrenceStart) >= options.rangeStart) {
        occurrences.push({
          entityId: entity.id,
          startAt: occurrenceStart,
          endAt: occurrenceEnd,
          isRecurring: true,
        });
        if (occurrences.length >= maxOccurrences) break;
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return occurrences;
}

function parseUntil(value: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value);
  if (!match) throw new Error(`Unsupported RRULE UNTIL value: ${value}`);
  const [, y, m, d, hh = "23", mm = "59", ss = "59", z = "Z"] = match;
  if (z !== "Z") throw new Error("UNTIL must be a UTC value ending in Z");
  return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
}
