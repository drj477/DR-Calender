import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { TemporalEntity } from "../temporal/types";

const palette = {
  background: "#10141D",
  surface: "#171C28",
  raised: "#202838",
  border: "#30394B",
  text: "#F4F6FC",
  muted: "#9BA7BA",
  accent: "#FFC247",
  danger: "#FF9A63",
  accentWash: "#322817",
  dangerWash: "#3A2525",
};

const editorShadow = { shadowColor: "#000000", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 4 };

export interface EventDraft {
  title: string;
  startAt: number;
  endAt: number;
  location: string | null;
  isShielded: boolean;
  isElastic: boolean;
  isAllDay: boolean;
  reminderMinutesBefore: number | null;
  rrule: string | null;
  scope: "occurrence" | "series";
  occurrenceStartAt: number | null;
  timeZone: string;
}

interface EventEditorProps {
  visible: boolean;
  selectedDate: Date;
  event: TemporalEntity | null;
  onClose: () => void;
  onSave: (draft: EventDraft) => void;
  occurrenceStartAt?: number | null;
  onDelete?: (event: TemporalEntity, scope: "occurrence" | "series", occurrenceStartAt: number | null) => void;
}

function formatClock(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "00";
  return value("hour") + ":" + value("minute");
}
function zonedParts(timestamp: number, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23" }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}
function zonedEpoch(year:number,month:number,day:number,hour:number,minute:number,timeZone:string):number {
  const resolve = (target:number):number[] => {
    const offsets=new Set<number>();
    for(const delta of [-36,-12,0,12,36]){
      const sample=target+delta*60*60_000;
      const p=zonedParts(sample,timeZone);
      const represented=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute));
      offsets.add(represented-sample);
    }
    return [...offsets].map(offset=>target-offset).filter(candidate=>{
      const p=zonedParts(candidate,timeZone);
      return Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute))===target;
    }).sort((a,b)=>a-b);
  };
  const target=Date.UTC(year,month-1,day,hour,minute);
  const exact=resolve(target);
  if(exact.length)return exact[0]!;
  for(let offset=1;offset<=180;offset++){
    const candidates=resolve(target+offset*60_000);
    if(candidates.length)return candidates[0]!;
  }
  throw new RangeError("Could not resolve this local time in the selected time zone.");
}
function ruleFromRecurrence(value: string): string | null {
  if (value === "daily") return "FREQ=DAILY";
  if (value === "weekdays") return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
  if (value === "weekly") return "FREQ=WEEKLY";
  if (value === "monthly") return "FREQ=MONTHLY";
  return null;
}

function recurrenceFromRule(rule: string): string {
  const normalized = rule.replace(/^RRULE:/i, "").toUpperCase();
  if (normalized === "FREQ=DAILY") return "daily";
  if (normalized === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR") return "weekdays";
  if (normalized === "FREQ=WEEKLY") return "weekly";
  if (normalized === "FREQ=MONTHLY") return "monthly";
  return "custom";
}

export function EventEditor({ visible, selectedDate, event, occurrenceStartAt = null, onClose, onSave, onDelete }: EventEditorProps) {
  const [title, setTitle] = useState("");
  const [startClock, setStartClock] = useState("09:00");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [shielded, setShielded] = useState(false);
  const [elastic, setElastic] = useState(false);
  const [allDay, setAllDay] = useState(false);
  const [allDayDays, setAllDayDays] = useState("1");
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState<number | null>(null);
  const [recurrence, setRecurrence] = useState("none");
  const [scope, setScope] = useState<"occurrence" | "series">("series");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setTitle(event?.title ?? "");
    const zone = event?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setTimeZone(zone);
    setScope(occurrenceStartAt !== null && event?.rrule ? "occurrence" : "series");
    const override = occurrenceStartAt !== null ? event?.metadata?.recurrence?.overrides[String(occurrenceStartAt)] : undefined;
    const start = override?.startAt ?? occurrenceStartAt ?? event?.scheduledAt ?? new Date(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 9, 0,
    ).getTime();
    const end = override?.endAt ?? (event?.endAt !== null && event?.endAt !== undefined ? start + ((event.endAt - (event.scheduledAt ?? start)) || 60 * 60_000) : start + 60 * 60_000);
    setStartClock(formatClock(new Date(start), zone));
    setDuration(String(Math.max(5, Math.round((end - start) / 60_000))));
    setLocation(override?.location ?? event?.metadata?.event?.location ?? "");
    setShielded(override?.isShielded ?? event?.isShielded ?? false);
    setElastic(override?.isElastic ?? event?.isElastic ?? false);
    setReminderMinutesBefore(event?.metadata?.event?.reminderMinutesBefore ?? null);
    setAllDay(override?.isAllDay ?? event?.metadata?.event?.kind === "all-day");
    const existingEnd = override?.endAt ?? event?.endAt;
    setAllDayDays(String(Math.max(1, Math.round(((existingEnd ?? start + 86400000) - new Date(new Date(start).getFullYear(), new Date(start).getMonth(), new Date(start).getDate()).getTime()) / 86400000))));
    if (override?.title) setTitle(override.title);
    setRecurrence(event?.rrule ? recurrenceFromRule(event.rrule) : "none");
    setError("");
  }, [visible, selectedDate, event, occurrenceStartAt]);

  const selectScope = (nextScope: "occurrence" | "series") => {
    setScope(nextScope);
    if (!event || occurrenceStartAt === null) return;

    const override = event.metadata?.recurrence?.overrides[String(occurrenceStartAt)];
    const occurrenceStart = override?.startAt ?? occurrenceStartAt;
    const seriesStart = event.scheduledAt ?? occurrenceStartAt;
    const baseStart = nextScope === "series" ? seriesStart : occurrenceStart;
    const baseEnd = nextScope === "series"
      ? event.endAt ?? seriesStart + 60 * 60_000
      : override?.endAt ?? occurrenceStart + Math.max(5 * 60_000, (event.endAt ?? seriesStart + 60 * 60_000) - seriesStart);

    setTitle(nextScope === "series" ? event.title : override?.title ?? event.title);
    setStartClock(formatClock(new Date(baseStart), event.timeZone || timeZone));
    setDuration(String(Math.max(5, Math.round((baseEnd - baseStart) / 60_000))));
    setLocation(nextScope === "series"
      ? event.metadata?.event?.location ?? ""
      : override?.location ?? event.metadata?.event?.location ?? "");
    setShielded(nextScope === "series" ? event.isShielded : override?.isShielded ?? event.isShielded);
    setElastic(nextScope === "series" ? event.isElastic : override?.isElastic ?? event.isElastic);
    setReminderMinutesBefore(event.metadata?.event?.reminderMinutesBefore ?? null);
    setAllDay(override?.isAllDay ?? event.metadata?.event?.kind === "all-day");
    setAllDayDays("1");
    setRecurrence(event.rrule ? recurrenceFromRule(event.rrule) : "none");
    setError("");
  };

  const save = () => {
    const cleanTitle = title.trim();
    try { new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date()); } catch { setError("Enter a valid IANA time zone, such as Asia/Kolkata or America/New_York."); return; }
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(startClock.trim());
    const minutes = Number(duration);
    if (!cleanTitle) {
      setError("Give your event a title.");
      return;
    }
    if (!allDay && (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59)) {
      setError("Enter a valid 24-hour time, such as 09:30.");
      return;
    }
    const days = Number(allDayDays);
    if (allDay && (!Number.isInteger(days) || days < 1 || days > 365)) {
      setError("All-day events must last between 1 and 365 calendar days.");
      return;
    }
    if (!allDay && (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440)) {
      setError("Duration must be between 5 and 1440 minutes.");
      return;
    }

    const dateForSave = scope === "series" && occurrenceStartAt !== null && event?.scheduledAt !== null && event?.scheduledAt !== undefined
      ? new Date(event.scheduledAt)
      : selectedDate;
    const useSeriesWallDate = scope === "series" && occurrenceStartAt !== null && event?.scheduledAt !== null && event?.scheduledAt !== undefined;
    const parts = useSeriesWallDate ? zonedParts(dateForSave.getTime(), timeZone) : null;
    const year = parts ? Number(parts.year) : dateForSave.getFullYear();
    const month = parts ? Number(parts.month) : dateForSave.getMonth() + 1;
    const day = parts ? Number(parts.day) : dateForSave.getDate();
    const startAt = allDay
      ? zonedEpoch(year, month, day, 0, 0, timeZone)
      : zonedEpoch(year, month, day, Number(timeMatch![1]), Number(timeMatch![2]), timeZone);
    const endDate = new Date(Date.UTC(year, month - 1, day + (allDay ? days : 1)));
    const allDayEnd = zonedEpoch(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, endDate.getUTCDate(), 0, 0, timeZone);
    onSave({
      title: cleanTitle,
      startAt,
      endAt: allDay ? allDayEnd : startAt + minutes * 60_000,
      location: location.trim() || null,
      isShielded: shielded,
      isElastic: elastic,
      isAllDay: allDay,
      reminderMinutesBefore,
      rrule: ruleFromRecurrence(recurrence),
      scope: event?.rrule && occurrenceStartAt !== null ? scope : "series",
      occurrenceStartAt: event?.rrule && occurrenceStartAt !== null ? occurrenceStartAt : null,
      timeZone,
    });
  };

  return (
    <Modal visible={visible} animationType="none" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"} onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}><Text style={styles.cancel}>Cancel</Text></Pressable>
          <Text style={styles.heading}>{event ? "Edit event" : "New event"}</Text>
          <Pressable onPress={save} accessibilityRole="button" hitSlop={8}><Text style={styles.save}>Save</Text></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          {event?.rrule && occurrenceStartAt !== null ? (
            <View style={styles.seriesNotice} accessibilityRole="summary">
              <Text style={styles.seriesNoticeTitle}>Edit recurring event</Text>
              <View style={styles.recurrenceOptions}>
                {([{ label: "This occurrence", value: "occurrence" }, { label: "Entire series", value: "series" }] as const).map(option => (
                  <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: scope === option.value }} onPress={() => selectScope(option.value)} style={[styles.recurrenceOption, scope === option.value && styles.recurrenceOptionActive]}>
                    <Text style={[styles.recurrenceText, scope === option.value && styles.recurrenceTextActive]}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.optionHint}>{scope === "occurrence" ? "Only this date is changed. The recurring schedule stays intact." : "Changes apply to every occurrence. The series keeps its original start date."}</Text>
              {scope === "series" && (Object.keys(event.metadata?.recurrence?.overrides ?? {}).length > 0 || (event.metadata?.recurrence?.excludedStartsAt.length ?? 0) > 0) ? (
                <Text style={styles.exceptionWarning}>Changing the series repeat rule or start time clears existing occurrence-specific edits and exclusions.</Text>
              ) : null}
            </View>
          ) : event?.rrule ? (
            <View style={styles.seriesNotice} accessibilityRole="summary">
              <Text style={styles.seriesNoticeTitle}>Recurring series</Text>
              <Text style={styles.optionHint}>Changes here apply to the entire series.</Text>
            </View>
          ) : null}

          <Text style={styles.label}>EVENT TITLE</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What are you planning?"
            placeholderTextColor={palette.muted}
            autoFocus={!event}
            style={styles.titleInput}
            returnKeyType="done"
          />

          <Text style={styles.label}>DATE</Text>
          <View style={[styles.readOnlyField, editorShadow]}>
            <Text style={styles.fieldText}>{(scope === "series" && occurrenceStartAt !== null && event?.scheduledAt !== null && event?.scheduledAt !== undefined ? new Date(event.scheduledAt) : selectedDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</Text>
          </View>

          <Pressable onPress={() => setAllDay(value => !value)} accessibilityRole="checkbox" accessibilityState={{ checked: allDay }} style={styles.optionRow}>
            <View style={styles.optionCopy}><Text style={styles.optionTitle}>All-day event</Text><Text style={styles.optionHint}>Reserve the whole local calendar day without a start time.</Text></View>
            <View style={[styles.toggle, allDay && styles.toggleOn]}><View style={[styles.toggleThumb, allDay && styles.toggleThumbOn]} /></View>
          </Pressable>

          {!allDay ? <View style={styles.twoColumns}>
            <View style={styles.column}>
              <Text style={styles.label}>START TIME (24H)</Text>
              <TextInput value={startClock} onChangeText={setStartClock} placeholder="09:00" placeholderTextColor={palette.muted} keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.input, editorShadow]} />
            </View>
            <View style={styles.column}>
              <Text style={styles.label}>DURATION (MIN)</Text>
              <TextInput value={duration} onChangeText={setDuration} placeholder="60" placeholderTextColor={palette.muted} keyboardType="number-pad" maxLength={4} style={styles.input} />
            </View>
          </View> : <View style={styles.column}><Text style={styles.label}>CALENDAR DAYS</Text><TextInput value={allDayDays} onChangeText={setAllDayDays} placeholder="1" placeholderTextColor={palette.muted} keyboardType="number-pad" maxLength={3} style={styles.input} /><Text style={styles.optionHint}>Ends at local midnight after the final day. Use 2 or more for multi-day events.</Text></View>}

          <Text style={styles.label}>EVENT TIME ZONE (IANA)</Text>
          <TextInput value={timeZone} onChangeText={setTimeZone} autoCapitalize="none" autoCorrect={false} placeholder="Asia/Kolkata" placeholderTextColor={palette.muted} style={styles.input} />
          <Text style={styles.optionHint}>Event times and recurring occurrences are saved in this time zone. Use an IANA name such as Asia/Kolkata, Europe/London, or America/New_York.</Text>

          <Text style={styles.label}>LOCATION (OPTIONAL)</Text>
          <TextInput value={location} onChangeText={setLocation} placeholder="Add a room or address" placeholderTextColor={palette.muted} style={styles.input} />

          {scope === "occurrence" && occurrenceStartAt !== null ? (
            <View style={styles.seriesNotice}>
              <Text style={styles.optionHint}>Repeat settings belong to the entire series. Choose “Entire series” to change the schedule.</Text>
            </View>
          ) : (
          <>
          <Text style={styles.label}>REPEAT</Text>
          <View style={styles.recurrenceOptions}>
            {[
              { label: "Never", value: "none" },
              { label: "Daily", value: "daily" },
              { label: "Weekdays", value: "weekdays" },
              { label: "Weekly", value: "weekly" },
              { label: "Monthly", value: "monthly" },
            ].map(option => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: recurrence === option.value }}
                onPress={() => setRecurrence(option.value)}
                style={[styles.recurrenceOption, recurrence === option.value && styles.recurrenceOptionActive, recurrence === option.value && editorShadow]}
              >
                <Text style={[styles.recurrenceText, recurrence === option.value && styles.recurrenceTextActive]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          {recurrence === "custom" ? <Text style={styles.optionHint}>This event has a custom recurrence rule. Choose a preset to replace it.</Text> : null}
          </>
          )}

          {scope !== "occurrence" ? <>
            <Text style={styles.label}>REMIND ME</Text>
            <View style={styles.recurrenceOptions}>
              {[
                { label: "Off", value: null },
                { label: "At start", value: 0 },
                { label: "5 min", value: 5 },
                { label: "15 min", value: 15 },
                { label: "30 min", value: 30 },
                { label: "1 hour", value: 60 },
                { label: "1 day", value: 1440 },
              ].map(option => (
                <Pressable key={String(option.value)} accessibilityRole="button" accessibilityState={{ selected: reminderMinutesBefore === option.value }} onPress={() => setReminderMinutesBefore(option.value)} style={[styles.recurrenceOption, reminderMinutesBefore === option.value && styles.recurrenceOptionActive]}>
                  <Text style={[styles.recurrenceText, reminderMinutesBefore === option.value && styles.recurrenceTextActive]}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.optionHint}>Recurring events schedule notifications for upcoming occurrences over the next 14 days.</Text>
          </> : null}

          <Text style={styles.label}>EVENT BEHAVIOUR</Text>
          <Pressable onPress={() => setShielded(value => !value)} style={styles.optionRow}>
            <View style={styles.optionCopy}><Text style={styles.optionTitle}>Focus shield</Text><Text style={styles.optionHint}>Mark this event as protected focus time.</Text></View>
            <View style={[styles.toggle, shielded && styles.toggleOn]}><View style={[styles.toggleThumb, shielded && styles.toggleThumbOn]} /></View>
          </Pressable>
          <Pressable onPress={() => setElastic(value => !value)} style={styles.optionRow}>
            <View style={styles.optionCopy}><Text style={styles.optionTitle}>Flexible event</Text><Text style={styles.optionHint}>Allow the scheduler to propose a new slot.</Text></View>
            <View style={[styles.toggle, elastic && styles.toggleOn]}><View style={[styles.toggleThumb, elastic && styles.toggleThumbOn]} /></View>
          </Pressable>

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {event && onDelete ? (
            <Pressable style={styles.deleteButton} onPress={() => onDelete(event, event.rrule && occurrenceStartAt !== null ? scope : "series", occurrenceStartAt)}>
              <Text style={styles.deleteText}>{event.rrule && occurrenceStartAt !== null && scope === "occurrence" ? "Delete this occurrence" : event.rrule ? "Delete entire series" : "Delete event"}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  header: { minHeight: 60, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: palette.border },
  heading: { color: palette.text, fontSize: 16, fontWeight: "700" },
  cancel: { color: palette.muted, fontSize: 14 },
  save: { color: palette.accent, fontSize: 14, fontWeight: "800" },
  body: { padding: 22, paddingBottom: 42, gap: 10 },
  label: { color: palette.muted, fontSize: 10, letterSpacing: 1.4, fontWeight: "800", marginTop: 13, marginBottom: 3 },
  titleInput: { color: palette.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.6, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: palette.border, marginBottom: 8 },
  readOnlyField: { padding: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 13 },
  fieldText: { color: palette.text, fontSize: 13 },
  twoColumns: { flexDirection: "row", gap: 12 },
  column: { flex: 1 },
  input: { color: palette.text, fontSize: 14, fontWeight: "600", paddingHorizontal: 14, paddingVertical: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 14 },
  recurrenceOptions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  recurrenceOption: { paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  recurrenceOptionActive: { backgroundColor: palette.accentWash, borderColor: palette.accent },
  recurrenceText: { color: palette.muted, fontSize: 11, fontWeight: "700" },
  recurrenceTextActive: { color: palette.accent },
  optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: palette.border, gap: 16 },
  optionCopy: { flex: 1, gap: 4 },
  optionTitle: { color: palette.text, fontSize: 13, fontWeight: "700" },
  optionHint: { color: palette.muted, fontSize: 11, lineHeight: 17, fontStyle: "italic" },
  toggle: { width: 43, height: 25, borderRadius: 13, padding: 3, backgroundColor: palette.raised, borderWidth: 1, borderColor: palette.border, justifyContent: "center" },
  toggleOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  toggleThumb: { width: 17, height: 17, borderRadius: 9, backgroundColor: palette.muted },
  toggleThumbOn: { alignSelf: "flex-end", backgroundColor: palette.background },
  error: { color: palette.danger, fontSize: 12, marginTop: 8 },
  seriesNotice: { padding: 13, gap: 5, backgroundColor: palette.accentWash, borderWidth: 1, borderColor: palette.accent, borderRadius: 13 },
  seriesNoticeTitle: { color: palette.accent, fontSize: 12, fontWeight: "800" },
  exceptionWarning: { color: palette.danger, fontSize: 11, lineHeight: 16, fontWeight: "600" },
  deleteButton: { marginTop: 25, padding: 15, alignItems: "center", backgroundColor: palette.dangerWash, borderWidth: 1, borderColor: "#5A332A", borderRadius: 14 },
  deleteText: { color: palette.danger, fontSize: 13, fontWeight: "700" },
});
