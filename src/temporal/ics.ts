import type { InviteAttendee, RSVPStatus } from "./types";

export interface ParsedICSEvent {
  uid: string;
  sequence: number;
  summary: string;
  description: string | null;
  location: string | null;
  start: string | null;
  end: string | null;
  organizerEmail: string | null;
  attendees: InviteAttendee[];
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED" | null;
  method: "REQUEST" | "REPLY" | "CANCEL" | "PUBLISH" | null;
  isAllDay: boolean;
  timeZone: string | null;
  recurrenceRule: string | null;
  excludedDates: string[];
  recurrenceId: string | null;
}

export interface BuildICSInviteInput {
  uid: string;
  sequence?: number;
  summary: string;
  description?: string | null;
  location?: string | null;
  start: Date;
  end: Date;
  organizerEmail: string;
  attendees: Array<{ email: string; name?: string | null; rsvpStatus?: RSVPStatus }>;
  method?: "REQUEST" | "PUBLISH" | "CANCEL";
}

/** RFC 5545 text escaping. */
export function escapeICSText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?
/g, "\
").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function unescapeICSText(value: string): string {
  return value.replace(/\\[nN]/g, "
").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function utf8Length(value: string): number {
  let length = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

function foldLine(line: string): string {
  // RFC 5545 limits content lines to 75 octets. Fold at Unicode code points
  // conservatively; this avoids splitting surrogate pairs and needs no DOM APIs.
  const chunks: string[] = [];
  let current = "";
  let length = 0;
  for (const char of line) {
    const octets = utf8Length(char);
    if (length + octets > 73) {
      chunks.push(current);
      current = " " + char;
      length = 1 + octets;
    } else {
      current += char;
      length += octets;
    }
  }
  if (current) chunks.push(current);
  return chunks.join("\r
");
}

function formatUTC(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid ICS date");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function statusToPartstat(status: RSVPStatus | undefined): string {
  switch (status) {
    case "accepted": return "ACCEPTED";
    case "declined": return "DECLINED";
    case "tentative": return "TENTATIVE";
    default: return "NEEDS-ACTION";
  }
}

function unfoldLines(ics: string): string[] {
  const normalized = ics.replace(/\r
/g, "
").replace(/\r/g, "
");
  const unfolded: string[] = [];
  for (const line of normalized.split("
")) {
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function splitProperty(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const separator = line.indexOf(":");
  if (separator < 0) return null;
  const head = line.slice(0, separator);
  const value = line.slice(separator + 1);
  const [name = "", ...rawParams] = head.split(";");
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const equals = raw.indexOf("=");
    if (equals > 0) params[raw.slice(0, equals).toUpperCase()] = raw.slice(equals + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value };
}

function parseDateProperty(value: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour = "00", minute = "00", second = "00", zulu] = match;
  return zulu
    ? `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
    : `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/** Parses the first VEVENT in an ICS payload, including common RSVP fields. */
export function parseICS(ics: string): ParsedICSEvent {
  const lines = unfoldLines(ics);
  let inEvent = false;
  let foundEvent = false;
  const properties: ReturnType<typeof splitProperty>[] = [];

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      if (foundEvent) continue;
      inEvent = true;
      foundEvent = true;
      continue;
    }
    if (upper === "END:VEVENT" && inEvent) break;
    if (inEvent) {
      const property = splitProperty(line);
      if (property) properties.push(property);
    }
  }
  if (!foundEvent) throw new Error("ICS payload does not contain a VEVENT");

  const first = (name: string) => properties.find(property => property?.name === name);
  const uid = first("UID")?.value;
  if (!uid) throw new Error("VEVENT is missing required UID");

  const organizer = first("ORGANIZER")?.value ?? null;
  const attendees: InviteAttendee[] = properties
    .filter(property => property?.name === "ATTENDEE")
    .map(property => {
      const email = (property?.value ?? "").replace(/^mailto:/i, "");
      const partstat = property?.params.PARTSTAT?.toUpperCase();
      const rsvpStatus: RSVPStatus =
        partstat === "ACCEPTED" ? "accepted" :
        partstat === "DECLINED" ? "declined" :
        partstat === "TENTATIVE" ? "tentative" : "needs-action";
      return {
        email,
        displayName: property?.params.CN ?? null,
        userId: null,
        rsvpStatus,
      };
    });

  const status = first("STATUS")?.value.toUpperCase();
  const method = lines.map(splitProperty).find(property => property?.name === "METHOD")?.value.toUpperCase();

  return {
    uid,
    sequence: Number(first("SEQUENCE")?.value ?? 0) || 0,
    summary: unescapeICSText(first("SUMMARY")?.value ?? "(Untitled event)"),
    description: first("DESCRIPTION") ? unescapeICSText(first("DESCRIPTION")!.value) : null,
    location: first("LOCATION") ? unescapeICSText(first("LOCATION")!.value) : null,
    start: parseDateProperty(first("DTSTART")?.value ?? ""),
    end: parseDateProperty(first("DTEND")?.value ?? ""),
    organizerEmail: organizer?.replace(/^mailto:/i, "") ?? null,
    attendees,
    status: status === "CONFIRMED" || status === "TENTATIVE" || status === "CANCELLED" ? status : null,
    method: method === "REQUEST" || method === "REPLY" || method === "CANCEL" || method === "PUBLISH" ? method : null,
    isAllDay: first("DTSTART")?.params.VALUE?.toUpperCase() === "DATE" || /^\\d{8}$/.test(first("DTSTART")?.value ?? ""),
    timeZone: first("DTSTART")?.params.TZID ?? null,
    recurrenceRule: first("RRULE")?.value ?? null,
    excludedDates: properties.filter(property => property?.name === "EXDATE").flatMap(property => property?.value.split(",").map(value => parseDateProperty(value) ?? value) ?? []),
    recurrenceId: parseDateProperty(first("RECURRENCE-ID")?.value ?? ""),
  };
}

/** Builds a compact UTC VEVENT invitation with folded content lines. */
export function buildICS(input: BuildICSInviteInput): string {
  if (input.end.getTime() <= input.start.getTime()) throw new RangeError("ICS end must be after start");
  if (!input.uid.trim()) throw new Error("ICS UID is required");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DR-Calender//Temporal Engine//EN",
    `METHOD:${input.method ?? "REQUEST"}`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeICSText(input.uid)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(input.sequence ?? 0))}`,
    `DTSTAMP:${formatUTC(new Date())}`,
    `DTSTART:${formatUTC(input.start)}`,
    `DTEND:${formatUTC(input.end)}`,
    `SUMMARY:${escapeICSText(input.summary)}`,
  ];
  if (input.description) lines.push(`DESCRIPTION:${escapeICSText(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeICSText(input.location)}`);
  lines.push(`ORGANIZER:mailto:${input.organizerEmail.trim()}`);
  for (const attendee of input.attendees) {
    const name = attendee.name ? `;CN="${attendee.name.replace(/["\\\\]/g, "")}"` : "";
    lines.push(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=${statusToPartstat(attendee.rsvpStatus)};RSVP=TRUE${name}:mailto:${attendee.email.trim()}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r
") + "\r
";
}

/** Builds an RFC 5545 METHOD:REPLY payload for a single attendee. */
export function buildICSReply(input: {
  uid: string;
  sequence: number;
  attendeeEmail: string;
  status: Exclude<RSVPStatus, "needs-action">;
  summary?: string;
}): string {
  const partstat = statusToPartstat(input.status);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DR-Calender//Temporal Engine//EN",
    "METHOD:REPLY",
    "BEGIN:VEVENT",
    `UID:${escapeICSText(input.uid)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(input.sequence))}`,
    `DTSTAMP:${formatUTC(new Date())}`,
    `ATTENDEE;PARTSTAT=${partstat}:mailto:${input.attendeeEmail.trim()}`,
  ];
  if (input.summary) lines.push(`SUMMARY:${escapeICSText(input.summary)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r
") + "\r
";
}

import type { TemporalEntity, RecurrenceOverride } from "./types";

function formatICSUTC(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function formatICSDate(timestamp: number): string {
  const d = new Date(timestamp);
  return String(d.getFullYear()).padStart(4, "0") + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
}
function buildEntityLines(entity: TemporalEntity, uid: string, sequence: number, override?: RecurrenceOverride, recurrenceId?: number): string[] {
  const start = override?.startAt ?? entity.scheduledAt;
  const end = override?.endAt ?? entity.endAt;
  if (start === null || end === null || end <= start) return [];
  const allDay = override?.isAllDay ?? entity.metadata?.event?.kind === "all-day";
  const title = override?.title ?? entity.title;
  const location = override?.location ?? entity.metadata?.event?.location;
  const lines = ["BEGIN:VEVENT", `UID:${escapeICSText(uid)}`, `SEQUENCE:${Math.max(0, sequence)}`, `DTSTAMP:${formatICSUTC(Date.now())}`];
  if (recurrenceId !== undefined) lines.push(`RECURRENCE-ID:${allDay ? `VALUE=DATE:${formatICSDate(recurrenceId)}` : formatICSUTC(recurrenceId)}`);
  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatICSDate(start)}`, `DTEND;VALUE=DATE:${formatICSDate(end)}`);
  } else {
    lines.push(`DTSTART:${formatICSUTC(start)}`, `DTEND:${formatICSUTC(end)}`);
  }
  lines.push(`SUMMARY:${escapeICSText(title)}`);
  if (location) lines.push(`LOCATION:${escapeICSText(location)}`);
  if (entity.rrule && recurrenceId === undefined) lines.push(`RRULE:${entity.rrule.replace(/^RRULE:/i, "")}`);
  return [...lines, "END:VEVENT"];
}

/** Export a full calendar, including recurrence exclusions and moved occurrence overrides. */
export function buildICSCalendar(entities: TemporalEntity[], calendarName = "DR-Calender"): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DR-Calender//Temporal Engine//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escapeICSText(calendarName)}`];
  for (const entity of entities) {
    if (entity.itemType !== "event" || entity.deletedAt !== null || entity.scheduledAt === null || entity.endAt === null) continue;
    const uid = entity.metadata?.invite?.icsUid ?? `${entity.id}@dr-calender.local`;
    const eventLines = buildEntityLines(entity, uid, entity.metadata?.invite?.sequence ?? entity.syncVersion);
    if (!eventLines.length) continue;
    const exceptions = entity.metadata?.recurrence;
    const allDay = entity.metadata?.event?.kind === "all-day";
    if (exceptions?.excludedStartsAt.length) {
      const dates = exceptions.excludedStartsAt.map(at => allDay ? formatICSDate(at) : formatICSUTC(at));
      eventLines.splice(eventLines.length - 1, 0, `${allDay ? "EXDATE;VALUE=DATE:" : "EXDATE:"}${dates.join(",")}`);
    }
    lines.push(...eventLines);
    for (const [key, override] of Object.entries(exceptions?.overrides ?? {})) {
      const occurrenceLines = buildEntityLines(entity, uid, entity.metadata?.invite?.sequence ?? entity.syncVersion, override, Number(key));
      lines.push(...occurrenceLines);
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r
") + "\r
";
}

/** Parses every VEVENT in a VCALENDAR instead of silently importing only the first. */
export function parseICSCalendar(ics: string): ParsedICSEvent[] {
  if (ics.length > 2_000_000) throw new Error("Calendar file is too large (maximum 2 MB).");
  const unfolded = unfoldLines(ics);
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of unfolded) {
    if (line.toUpperCase() === "BEGIN:VEVENT") {
      if (current) throw new Error("Malformed ICS: nested VEVENT.");
      current = ["BEGIN:VEVENT"];
    } else if (line.toUpperCase() === "END:VEVENT") {
      if (current) { current.push("END:VEVENT"); blocks.push(current); current = null; }
    } else if (current) current.push(line);
  }
  if (current) throw new Error("Malformed ICS: unterminated VEVENT.");
  if (!blocks.length) throw new Error("No events were found in this calendar.");
  if (blocks.length > 1000) throw new Error("Calendar contains too many events (maximum 1000 per import).");
  const method = unfolded.map(splitProperty).find(property => property?.name === "METHOD")?.value;
  return blocks.map(block => parseICS(["BEGIN:VCALENDAR", ...(method ? [`METHOD:${method}`] : []), ...block, "END:VCALENDAR"].join("\r
")));
}
