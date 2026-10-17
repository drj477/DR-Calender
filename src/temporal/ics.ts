import type { InviteAttendee, RSVPStatus, TemporalEntity, RecurrenceOverride } from "./types";

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
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function unescapeICSText(value: string): string {
  return value.replace(/\\[nN]/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
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
  return chunks.join("\r\n");
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
  const normalized = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const unfolded: string[] = [];
  for (const line of normalized.split("\n")) {
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
  return year + "-" + month + "-" + day + "T" + hour + ":" + minute + ":" + second + (zulu ? "Z" : "");
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
    isAllDay: first("DTSTART")?.params.VALUE?.toUpperCase() === "DATE" || /^\d{8}$/.test(first("DTSTART")?.value ?? ""),
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
  return lines.map(foldLine).join("\r\n") + "\r\n";
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
    "UID:" + escapeICSText(input.uid),
    "SEQUENCE:" + Math.max(0, Math.trunc(input.sequence)),
    "DTSTAMP:" + formatUTC(new Date()),
    "ATTENDEE;PARTSTAT=" + partstat + ":mailto:" + input.attendeeEmail.trim(),
  ];
  if (input.summary) lines.push("SUMMARY:" + escapeICSText(input.summary));
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function partsInZone(timestamp: number, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23" }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}
function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(0); return timeZone; } catch { return "UTC"; }
}
function formatICSDate(timestamp: number, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"): string {
  const p = partsInZone(timestamp, timeZone);
  return p.year + p.month + p.day;
}
function formatICSLocal(timestamp: number, timeZone: string): string {
  const p = partsInZone(timestamp, timeZone);
  return p.year + p.month + p.day + "T" + p.hour + p.minute + p.second;
}
/** Convert a floating ICS local date-time into epoch milliseconds in its TZID. */
export type CustomZoneTransition = { at:number; local:number; offsetFrom:number; offsetTo:number };
const customTimeZones = new Map<string, CustomZoneTransition[]>();
function parseOffset(value:string|undefined):number|null {
  if(!value)return null;
  const match=/^([+-])(\\d{2})(\\d{2})(?:\\d{2})?$/.exec(value);
  if(!match)return null;
  const minutes=Number(match[2])*60+Number(match[3]);
  return (match[1]==="-"?-1:1)*minutes;
}
function wallParts(value:string):{year:number;month:number;day:number;hour:number;minute:number;second:number}|null {
  const match=/^(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})?$/.exec(value);
  if(!match)return null;
  return {year:Number(match[1]),month:Number(match[2]),day:Number(match[3]),hour:Number(match[4]),minute:Number(match[5]),second:Number(match[6]??0)};
}
function nthWeekday(year:number,month:number,weekday:number,ordinal:number):number {
  if(ordinal>0)return 1+((weekday-new Date(Date.UTC(year,month-1,1)).getUTCDay()+7)%7)+(ordinal-1)*7;
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  return last-((new Date(Date.UTC(year,month-1,last)).getUTCDay()-weekday+7)%7)+(ordinal+1)*7;
}
function loadCustomTimeZones(lines:string[]):void {
  customTimeZones.clear();
  let zoneId:string|null=null;
  let observance:string[]|null=null;
  const raw=new Map<string,CustomZoneTransition[]>();
  const pushObservance=()=>{
    if(!zoneId||!observance)return;
    const props=observance.map(splitProperty).filter((item):item is NonNullable<typeof item>=>item!==null);
    const get=(name:string)=>props.find(item=>item.name===name)?.value;
    const startText=get("DTSTART"),from=parseOffset(get("TZOFFSETFROM")),to=parseOffset(get("TZOFFSETTO"));
    const start= startText ? wallParts(startText) : null;
    if(!start||from===null||to===null)return;
    const rules=props.filter(item=>item.name==="RRULE").map(item=>item.value);
    const transitions=raw.get(zoneId)??[];
    const add=(year:number,month:number,day:number)=>{
      const local=Date.UTC(year,month-1,day,start.hour,start.minute,start.second);
      transitions.push({local,at:local-from*60_000,offsetFrom:from,offsetTo:to});
    };
    add(start.year,start.month,start.day);
    for(const rule of rules){
      const fields=Object.fromEntries(rule.split(";").map(piece=>{const i=piece.indexOf("=");return [piece.slice(0,i).toUpperCase(),piece.slice(i+1)]}));
      if(fields.FREQ!=="YEARLY")continue;
      const month=Number(fields.BYMONTH??start.month);
      if(!Number.isInteger(month)||month<1||month>12)continue;
      const weekdayRule=/^([+-]?\\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(fields.BYDAY??"");
      const weekdays:Record<string,number>={SU:0,MO:1,TU:2,WE:3,TH:4,FR:5,SA:6};
      for(let year=Math.max(start.year+1,1970);year<=2100;year++){
        let day:number;
        if(fields.BYMONTHDAY){day=Number(fields.BYMONTHDAY);const last=new Date(Date.UTC(year,month,0)).getUTCDate();if(day<0)day=last+day+1;if(day<1||day>last)continue;}
        else if(weekdayRule){day=nthWeekday(year,month,weekdays[weekdayRule[2]],Number(weekdayRule[1]??1));}
        else day=start.day;
        add(year,month,day);
      }
    }
    raw.set(zoneId,transitions);
  };
  for(const line of lines){
    const upper=line.toUpperCase();
    if(upper==="BEGIN:VTIMEZONE"){zoneId=null;observance=null;continue;}
    if(upper==="END:VTIMEZONE"){pushObservance();zoneId=null;observance=null;continue;}
    if(!zoneId&&!observance){
      const property=splitProperty(line);
      if(property?.name==="TZID")zoneId=property.value;
    }
    if(upper==="BEGIN:STANDARD"||upper==="BEGIN:DAYLIGHT"){pushObservance();observance=[];continue;}
    if(upper==="END:STANDARD"||upper==="END:DAYLIGHT"){pushObservance();observance=null;continue;}
    if(observance)observance.push(line);
  }
  for(const [id,transitions] of raw)customTimeZones.set(id,transitions.sort((a,b)=>a.at-b.at));
}
function customZoneOffsetAt(epoch:number,transitions:CustomZoneTransition[]):number {
  if(!transitions.length)return 0;
  let offset=transitions[0].offsetFrom;
  for(const transition of transitions){if(epoch>=transition.at)offset=transition.offsetTo;else break;}
  return offset;
}
function parseCustomWallTime(value:string,timeZone:string):number|null {
  const transitions=customTimeZones.get(timeZone);
  const wall=wallParts(value.replace(/-/g,"").replace(/:/g,""));
  if(!transitions||!wall)return null;
  const target=Date.UTC(wall.year,wall.month-1,wall.day,wall.hour,wall.minute,wall.second);
  const offsets=[...new Set(transitions.flatMap(item=>[item.offsetFrom,item.offsetTo]))];
  const resolve=(local:number)=>{
    const candidates=offsets.map(offset=>local-offset*60_000).filter(epoch=>customZoneOffsetAt(epoch,transitions)===offsetForCandidate(epoch,local,offset));
    return candidates.filter(epoch=>{
      const offset=customZoneOffsetAt(epoch,transitions);
      return epoch+offset*60_000===local;
    }).sort((a,b)=>a-b);
  };
  for(let minute=0;minute<=180;minute++){
    const local=target+minute*60_000;
    const candidates=resolve(local);
    if(candidates.length)return candidates[0];
  }
  return null;
}
function offsetForCandidate(_epoch:number,_local:number,offset:number):number { return offset; }

function parseICSDateTime(value: string, timeZone: string | null = null): number {
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const absolute = new Date(value).getTime();
    if (!Number.isFinite(absolute)) throw new Error("Invalid ICS date-time: " + value);
    return absolute;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Unsupported ICS date-time: " + value);
  const [,y,mo,d,h,mi,se] = match;
  const target = Date.UTC(Number(y),Number(mo)-1,Number(d),Number(h),Number(mi),Number(se));
  if (!timeZone) return new Date(Number(y),Number(mo)-1,Number(d),Number(h),Number(mi),Number(se)).getTime();
  let guess = target;
  for (let i=0;i<4;i++) {
    const p = partsInZone(guess,timeZone);
    const represented = Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
    const delta = target-represented;
    guess += delta;
    if (delta===0) break;
  }
  return guess;
}
function buildEntityLines(entity: TemporalEntity, uid: string, sequence: number, override?: RecurrenceOverride, recurrenceId?: number): string[] {
  const start = override?.startAt ?? entity.scheduledAt;
  const end = override?.endAt ?? entity.endAt;
  if (start === null || end === null || end <= start) return [];
  const allDay = override?.isAllDay ?? entity.metadata?.event?.kind === "all-day";
  const timeZone = safeTimeZone(entity.timeZone);
  const title = override?.title ?? entity.title;
  const location = override?.location ?? entity.metadata?.event?.location;
  const lines = ["BEGIN:VEVENT", "UID:" + escapeICSText(uid), "SEQUENCE:" + Math.max(0,sequence), "DTSTAMP:" + formatICSUTC(Date.now())];
  if (recurrenceId !== undefined) lines.push(allDay ? "RECURRENCE-ID;VALUE=DATE:" + formatICSDate(recurrenceId,timeZone) : "RECURRENCE-ID;TZID=" + timeZone + ":" + formatICSLocal(recurrenceId,timeZone));
  if (allDay) {
    lines.push("DTSTART;VALUE=DATE:" + formatICSDate(start,timeZone), "DTEND;VALUE=DATE:" + formatICSDate(end,timeZone));
  } else {
    lines.push("DTSTART;TZID=" + timeZone + ":" + formatICSLocal(start,timeZone), "DTEND;TZID=" + timeZone + ":" + formatICSLocal(end,timeZone));
  }
  lines.push("SUMMARY:" + escapeICSText(title));
  if (location) lines.push("LOCATION:" + escapeICSText(location));
  if (recurrenceId === undefined && entity.metadata?.invite?.organizerEmail) lines.push("ORGANIZER:mailto:" + entity.metadata.invite.organizerEmail.trim());
  if (recurrenceId === undefined) for (const attendee of entity.metadata?.invite?.attendeeList ?? []) {
    const partstat = attendee.rsvpStatus === "accepted" ? "ACCEPTED" : attendee.rsvpStatus === "declined" ? "DECLINED" : attendee.rsvpStatus === "tentative" ? "TENTATIVE" : "NEEDS-ACTION";
    const cn = attendee.displayName ? ";CN=\"" + attendee.displayName.replace(/["\\]/g,"") + "\"" : "";
    lines.push("ATTENDEE;RSVP=TRUE;PARTSTAT=" + partstat + cn + ":mailto:" + attendee.email.trim());
  }
  if (entity.rrule && recurrenceId === undefined) lines.push("RRULE:" + entity.rrule.replace(/^RRULE:/i,""));
  return lines.concat(["END:VEVENT"]);
}
function zoneOffsetMinutes(timestamp:number,timeZone:string):number {
  const p=partsInZone(timestamp,timeZone);
  return Math.round((Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second))-timestamp)/60_000);
}
function offsetToken(minutes:number):string {
  const sign=minutes<0?"-":"+";
  const absolute=Math.abs(minutes);
  return sign+String(Math.floor(absolute/60)).padStart(2,"0")+String(absolute%60).padStart(2,"0");
}
function zoneName(timestamp:number,timeZone:string):string {
  const part=new Intl.DateTimeFormat("en-US",{timeZone,timeZoneName:"short"}).formatToParts(new Date(timestamp)).find(p=>p.type==="timeZoneName")?.value;
  return (part||timeZone).replace(/[^A-Za-z0-9+_-]/g,"")||timeZone.replace(/[^A-Za-z0-9+_-]/g,"");
}
function timezoneTransitions(timeZone:string,firstYear:number,lastYear:number):string[] {
  const lines=["BEGIN:VTIMEZONE","TZID:"+timeZone,"X-LIC-LOCATION:"+timeZone];
  let found=false;
  for(let year=firstYear;year<=lastYear;year++){
    let previous=Date.UTC(year,0,1);
    let previousOffset=zoneOffsetMinutes(previous,timeZone);
    for(let sample=previous+7*86400_000;sample<=Date.UTC(year+1,0,1);sample+=7*86400_000){
      const current=Math.min(sample,Date.UTC(year+1,0,1));
      const currentOffset=zoneOffsetMinutes(current,timeZone);
      if(currentOffset!==previousOffset){
        let low=Math.floor(previous/60_000),high=Math.floor(current/60_000);
        while(high-low>1){
          const middle=Math.floor((low+high)/2);
          if(zoneOffsetMinutes(middle*60_000,timeZone)===previousOffset)low=middle;else high=middle;
        }
        const transition=high*60_000;
        const toOffset=zoneOffsetMinutes(transition,timeZone);
        if(toOffset!==previousOffset){
          found=true;
          const localBefore=transition+previousOffset*60_000;
          const local=new Date(localBefore);
          const stamp=String(local.getUTCFullYear()).padStart(4,"0")+String(local.getUTCMonth()+1).padStart(2,"0")+String(local.getUTCDate()).padStart(2,"0")+"T"+String(local.getUTCHours()).padStart(2,"0")+String(local.getUTCMinutes()).padStart(2,"0")+"00";
          const kind=toOffset>previousOffset?"DAYLIGHT":"STANDARD";
          lines.push("BEGIN:"+kind,"DTSTART:"+stamp,"TZOFFSETFROM:"+offsetToken(previousOffset),"TZOFFSETTO:"+offsetToken(toOffset),"TZNAME:"+zoneName(transition,timeZone),"END:"+kind);
        }
      }
      previous=current;previousOffset=currentOffset;
      if(current===Date.UTC(year+1,0,1))break;
    }
  }
  if(!found){
    const offset=zoneOffsetMinutes(Date.UTC(firstYear,0,1),timeZone);
    lines.push("BEGIN:STANDARD","DTSTART:19700101T000000","TZOFFSETFROM:"+offsetToken(offset),"TZOFFSETTO:"+offsetToken(offset),"TZNAME:"+zoneName(Date.UTC(firstYear,0,1),timeZone),"END:STANDARD");
  }
  lines.push("END:VTIMEZONE");
  return lines;
}
/** Export events, recurrence exclusions, moved occurrences, attendees and time zones. */
export function buildICSCalendar(entities: TemporalEntity[], calendarName = "DR-Calender"): string {
  const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//DR-Calender//Temporal Engine//EN","CALSCALE:GREGORIAN","X-WR-CALNAME:" + escapeICSText(calendarName)];
  const exportable = entities.filter(entity => entity.itemType === "event" && entity.deletedAt === null && entity.scheduledAt !== null && entity.endAt !== null);
  const zones = [...new Set(exportable.map(entity => safeTimeZone(entity.timeZone)))];
  const years = exportable.flatMap(entity => [new Date(entity.scheduledAt!).getUTCFullYear(),new Date(entity.endAt!).getUTCFullYear()]);
  const firstYear = Math.max(1970,Math.min(...(years.length?years:[new Date().getUTCFullYear()]))-1);
  const lastYear = Math.min(2100,Math.max(...(years.length?years:[new Date().getUTCFullYear()]))+1);
  for (const zone of zones) lines.push(...timezoneTransitions(zone,firstYear,lastYear));
  for (const entity of entities) {
    if (entity.itemType !== "event" || entity.deletedAt !== null || entity.scheduledAt === null || entity.endAt === null) continue;
    const uid = entity.metadata?.invite?.icsUid ?? entity.id + "@dr-calender.local";
    const sequence = entity.metadata?.invite?.sequence ?? entity.syncVersion;
    const eventLines = buildEntityLines(entity,uid,sequence);
    if (!eventLines.length) continue;
    const exceptions = entity.metadata?.recurrence;
    const allDay = entity.metadata?.event?.kind === "all-day";
    if (exceptions?.excludedStartsAt.length) {
      const dates = exceptions.excludedStartsAt.map(at => allDay ? formatICSDate(at,safeTimeZone(entity.timeZone)) : formatICSLocal(at,safeTimeZone(entity.timeZone)));
      const prefix = allDay ? "EXDATE;VALUE=DATE:" : "EXDATE;TZID=" + safeTimeZone(entity.timeZone) + ":";
      eventLines.splice(eventLines.length-1,0,prefix+dates.join(","));
    }
    lines.push(...eventLines);
    for (const [key,override] of Object.entries(exceptions?.overrides ?? {})) {
      lines.push(...buildEntityLines(entity,uid,sequence,override,Number(key)));
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
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
      if (current) {
        current.push("END:VEVENT");
        blocks.push(current);
        current = null;
      }
    } else if (current) current.push(line);
  }
  if (current) throw new Error("Malformed ICS: unterminated VEVENT.");
  if (!blocks.length) throw new Error("No events were found in this calendar.");
  if (blocks.length > 1000) throw new Error("Calendar contains too many events (maximum 1000 per import).");
  const method = unfolded.map(splitProperty).find(property => property?.name === "METHOD")?.value;
  const parsed = blocks.map(block => parseICS([
    "BEGIN:VCALENDAR",
    ...(method ? ["METHOD:" + method] : []),
    ...block,
    "END:VCALENDAR",
  ].join("\r\n")));
  const masterUIDs = new Set<string>();
  for (const event of parsed) {
    if (event.method !== "REPLY" && event.recurrenceId === null) {
      if (masterUIDs.has(event.uid)) throw new Error("Calendar contains duplicate master events with UID " + event.uid + ".");
      masterUIDs.add(event.uid);
    }
    if (event.method === "REPLY" && !event.start) continue;
    if (!event.start) throw new Error('Event "' + event.summary + '" is missing DTSTART.');
    const start = parseICSDateTime(event.start, event.timeZone);
    if (event.end) {
      const end = parseICSDateTime(event.end, event.timeZone);
      if (end <= start) throw new Error('Event "' + event.summary + '" has an invalid end date.');
    }
  }
  return parsed;
}
