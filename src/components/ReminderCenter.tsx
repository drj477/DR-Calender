import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import type { TemporalEntity } from "../temporal/types";
import { BrandText } from "./BrandText";

const C = { background: "#10141D", surface: "#171C28", raised: "#202838", border: "#30394B", text: "#F4F6FC", muted: "#9BA7BA", accent: "#FFC247", danger: "#FF9A63", wash: "#322817" };

type Props = {
  reminders: TemporalEntity[];
  permissionGranted: boolean | null;
  onRequestPermission: () => void;
  onCreate: (title: string, at: number) => void;
  onSnooze: (reminder: TemporalEntity, minutes: number) => void;
  onComplete: (reminder: TemporalEntity) => void;
  onDelete: (reminder: TemporalEntity) => void;
};

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function timeInputValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function ReminderCenter({ reminders, permissionGranted, onRequestPermission, onCreate, onSnooze, onComplete, onDelete }: Props) {
  const initial = useMemo(() => new Date(Date.now() + 60 * 60_000), []);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => dateInputValue(initial));
  const [time, setTime] = useState(() => timeInputValue(initial));
  const [error, setError] = useState("");
  const reminderTime = (item: TemporalEntity) => { const trigger = item.metadata?.reminder?.trigger; return item.metadata?.reminder?.snoozeUntil ?? (trigger?.kind === "time" ? trigger.at : item.scheduledAt ?? 0); };
  const upcoming = reminders.filter(item => !item.isCompleted && item.deletedAt === null).sort((a, b) => reminderTime(a) - reminderTime(b));
  const completed = reminders.filter(item => item.isCompleted && item.deletedAt === null);

  const submit = () => {
    const cleanTitle = title.trim();
    const matchDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    const matchTime = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!cleanTitle) { setError("Give this reminder a title."); return; }
    if (!matchDate || !matchTime || Number(matchTime[1]) > 23 || Number(matchTime[2]) > 59) { setError("Use a valid date (YYYY-MM-DD) and 24-hour time (HH:MM)."); return; }
    const at = new Date(Number(matchDate[1]), Number(matchDate[2]) - 1, Number(matchDate[3]), Number(matchTime[1]), Number(matchTime[2])).getTime();
    if (new Date(at).getFullYear() !== Number(matchDate[1]) || new Date(at).getMonth() !== Number(matchDate[2]) - 1 || new Date(at).getDate() !== Number(matchDate[3])) { setError("That calendar date does not exist."); return; }
    if (at <= Date.now()) { setError("Choose a future time."); return; }
    onCreate(cleanTitle, at);
    setTitle(""); setError("");
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.intro}>
        <BrandText style={styles.kicker}>STAY A STEP AHEAD</BrandText>
        <BrandText style={styles.heading}>Reminders</BrandText>
        <BrandText style={styles.subheading}>A timely nudge, right when you need it.</BrandText>
      </View>
      {permissionGranted !== true ? (
        <Pressable onPress={onRequestPermission} style={styles.permissionCard} accessibilityRole="button">
          <View style={styles.permissionCopy}><BrandText style={styles.cardTitle}>Enable notifications</BrandText><BrandText style={styles.hint}>{permissionGranted === false ? "Notifications are blocked in system settings. Enable them to receive reminders." : "Allow notifications to receive scheduled reminders and event alerts."}</BrandText></View>
          <BrandText style={styles.action}>{permissionGranted === false ? "Settings" : "Enable →"}</BrandText>
        </Pressable>
      ) : (
        <View style={styles.permissionStatus}><View style={styles.statusDot} /><BrandText style={styles.hint}>Notifications are enabled on this device.</BrandText></View>
      )}
      <View style={styles.formCard}>
        <BrandText style={styles.cardTitle}>Create a reminder</BrandText>
        <TextInput value={title} onChangeText={setTitle} placeholder="What should you remember?" placeholderTextColor={C.muted} style={styles.titleInput} returnKeyType="done" />
        <View style={styles.row}>
          <View style={styles.field}><BrandText style={styles.label}>DATE</BrandText><TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted} style={styles.input} maxLength={10} /></View>
          <View style={styles.field}><BrandText style={styles.label}>TIME (24H)</BrandText><TextInput value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={C.muted} style={styles.input} maxLength={5} /></View>
        </View>
        {error ? <BrandText accessibilityRole="alert" style={styles.error}>{error}</BrandText> : null}
        <Pressable onPress={submit} style={styles.primaryButton} accessibilityRole="button"><BrandText style={styles.primaryText}>＋ Schedule reminder</BrandText></Pressable>
      </View>
      <View style={styles.sectionHeader}><BrandText style={styles.sectionTitle}>Upcoming</BrandText><BrandText style={styles.count}>{upcoming.length}</BrandText></View>
      {upcoming.length ? upcoming.map(item => {
        const trigger = item.metadata?.reminder?.trigger;
        const at = reminderTime(item);
        return <View key={item.id} style={styles.reminderCard}>
          <View style={styles.reminderMark}><BrandText style={styles.reminderMarkText}>◷</BrandText></View>
          <View style={styles.reminderCopy}><BrandText style={styles.reminderTitle}>{item.title}</BrandText><BrandText style={styles.reminderDate}>{new Date(at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</BrandText>
            <View style={styles.actions}><Pressable onPress={() => onComplete(item)} style={styles.doneButton}><BrandText style={styles.doneText}>Done</BrandText></Pressable><Pressable onPress={() => onSnooze(item, 10)} style={styles.smallButton}><BrandText style={styles.smallButtonText}>Snooze 10m</BrandText></Pressable><Pressable onPress={() => onSnooze(item, 60)} style={styles.smallButton}><BrandText style={styles.smallButtonText}>Snooze 1h</BrandText></Pressable><Pressable onPress={() => onDelete(item)} style={styles.deleteButton}><BrandText style={styles.deleteText}>Delete</BrandText></Pressable></View>
          </View>
        </View>;
      }) : <View style={styles.empty}><BrandText style={styles.emptyTitle}>Nothing on the reminder list</BrandText><BrandText style={styles.hint}>Create a reminder above and it will be saved on this device.</BrandText></View>}
      {completed.length ? <View style={styles.sectionHeader}><BrandText style={styles.sectionTitle}>Completed</BrandText><BrandText style={styles.count}>{completed.length}</BrandText></View> : null}
      {completed.map(item => <View key={item.id} style={[styles.reminderCard, styles.completedCard]}><View style={styles.reminderCopy}><BrandText style={styles.reminderTitle}>{item.title}</BrandText><BrandText style={styles.reminderDate}>Completed</BrandText></View><Pressable onPress={() => onDelete(item)}><BrandText style={styles.deleteText}>Remove</BrandText></Pressable></View>)}
      <BrandText style={styles.footer}>Local-first reminders · Scheduled on this device</BrandText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, content: { padding: 18, paddingBottom: 28, gap: 13 },
  intro: { paddingVertical: 8, gap: 5 }, kicker: { color: C.accent, fontSize: 9, letterSpacing: 2, fontWeight: "800" },
  heading: { color: C.text, fontSize: 27, fontWeight: "800", letterSpacing: -0.7 }, subheading: { color: C.muted, fontSize: 11 },
  permissionCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 15, borderRadius: 15, backgroundColor: C.wash, borderWidth: 1, borderColor: "#72551C" },
  permissionCopy: { flex: 1, gap: 5 }, permissionStatus: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 3, paddingVertical: 7 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#72D6A1" }, action: { color: C.accent, fontSize: 11, fontWeight: "800" },
  formCard: { padding: 16, gap: 11, borderRadius: 17, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  cardTitle: { color: C.text, fontSize: 13, fontWeight: "800" }, titleInput: { color: C.text, fontSize: 14, padding: 13, borderRadius: 11, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border },
  row: { flexDirection: "row", gap: 10 }, field: { flex: 1, gap: 6 }, label: { color: C.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
  input: { color: C.text, fontSize: 12, padding: 12, borderRadius: 10, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border },
  primaryButton: { padding: 13, alignItems: "center", borderRadius: 11, backgroundColor: C.accent }, primaryText: { color: C.background, fontSize: 12, fontWeight: "900" },
  error: { color: C.danger, fontSize: 11 }, sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 9 },
  sectionTitle: { color: C.text, fontSize: 15, fontWeight: "800" }, count: { color: C.accent, fontSize: 11, fontWeight: "800" },
  reminderCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 15, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  reminderMark: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: C.wash }, reminderMarkText: { color: C.accent, fontSize: 20 },
  reminderCopy: { flex: 1, gap: 6 }, reminderTitle: { color: C.text, fontSize: 12, fontWeight: "800" }, reminderDate: { color: C.muted, fontSize: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }, smallButton: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border },
  smallButtonText: { color: C.text, fontSize: 9, fontWeight: "700" }, doneButton: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, backgroundColor: "#17372B", borderWidth: 1, borderColor: "#2D6248" }, doneText: { color: "#72D6A1", fontSize: 9, fontWeight: "800" }, deleteButton: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, backgroundColor: "#3A2525" }, deleteText: { color: C.danger, fontSize: 9, fontWeight: "800" },
  empty: { padding: 18, gap: 6, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderStyle: "dashed", borderColor: C.border }, emptyTitle: { color: C.text, fontSize: 12, fontWeight: "700" },
  completedCard: { opacity: 0.65 }, hint: { color: C.muted, fontSize: 10, lineHeight: 15 }, footer: { color: C.muted, fontSize: 9, textAlign: "center", paddingTop: 8 },
});
