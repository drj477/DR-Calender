import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { TemporalEntity } from "../temporal/types";

const C = { background: "#10141D", surface: "#171C28", raised: "#202838", border: "#30394B", text: "#F4F6FC", muted: "#9BA7BA", accent: "#FFC247", danger: "#FF9A63", wash: "#322817" };

type Props = {
  reminders: TemporalEntity[];
  permissionGranted: boolean | null;
  onRequestPermission: () => void;
  onCreate: (title: string, at: number) => void;
  onSnooze: (reminder: TemporalEntity, minutes: number) => void;
  onDelete: (reminder: TemporalEntity) => void;
};

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function timeInputValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function ReminderCenter({ reminders, permissionGranted, onRequestPermission, onCreate, onSnooze, onDelete }: Props) {
  const initial = useMemo(() => new Date(Date.now() + 60 * 60_000), []);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => dateInputValue(initial));
  const [time, setTime] = useState(() => timeInputValue(initial));
  const [error, setError] = useState("");
  const upcoming = reminders.filter(item => !item.isCompleted && item.deletedAt === null).sort((a, b) => (a.metadata?.reminder?.snoozeUntil ?? a.metadata?.reminder?.trigger.kind === "time" && a.metadata.reminder.trigger.at) - (b.metadata?.reminder?.snoozeUntil ?? b.metadata?.reminder?.trigger.kind === "time" && b.metadata.reminder.trigger.at));
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
        <Text style={styles.kicker}>STAY A STEP AHEAD</Text>
        <Text style={styles.heading}>Reminders</Text>
        <Text style={styles.subheading}>A timely nudge, right when you need it.</Text>
      </View>
      {permissionGranted !== true ? (
        <Pressable onPress={onRequestPermission} style={styles.permissionCard} accessibilityRole="button">
          <View style={styles.permissionCopy}><Text style={styles.cardTitle}>Enable notifications</Text><Text style={styles.hint}>{permissionGranted === false ? "Notifications are blocked in system settings. Enable them to receive reminders." : "Allow notifications to receive scheduled reminders and event alerts."}</Text></View>
          <Text style={styles.action}>{permissionGranted === false ? "Settings" : "Enable →"}</Text>
        </Pressable>
      ) : (
        <View style={styles.permissionStatus}><View style={styles.statusDot} /><Text style={styles.hint}>Notifications are enabled on this device.</Text></View>
      )}
      <View style={styles.formCard}>
        <Text style={styles.cardTitle}>Create a reminder</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="What should you remember?" placeholderTextColor={C.muted} style={styles.titleInput} returnKeyType="done" />
        <View style={styles.row}>
          <View style={styles.field}><Text style={styles.label}>DATE</Text><TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted} style={styles.input} maxLength={10} /></View>
          <View style={styles.field}><Text style={styles.label}>TIME (24H)</Text><TextInput value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={C.muted} style={styles.input} maxLength={5} /></View>
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable onPress={submit} style={styles.primaryButton} accessibilityRole="button"><Text style={styles.primaryText}>＋ Schedule reminder</Text></Pressable>
      </View>
      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Upcoming</Text><Text style={styles.count}>{upcoming.length}</Text></View>
      {upcoming.length ? upcoming.map(item => {
        const trigger = item.metadata?.reminder?.trigger;
        const at = item.metadata?.reminder?.snoozeUntil ?? (trigger?.kind === "time" ? trigger.at : item.scheduledAt ?? Date.now());
        return <View key={item.id} style={styles.reminderCard}>
          <View style={styles.reminderMark}><Text style={styles.reminderMarkText}>◷</Text></View>
          <View style={styles.reminderCopy}><Text style={styles.reminderTitle}>{item.title}</Text><Text style={styles.reminderDate}>{new Date(at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Text>
            <View style={styles.actions}><Pressable onPress={() => onSnooze(item, 10)} style={styles.smallButton}><Text style={styles.smallButtonText}>Snooze 10m</Text></Pressable><Pressable onPress={() => onSnooze(item, 60)} style={styles.smallButton}><Text style={styles.smallButtonText}>Snooze 1h</Text></Pressable><Pressable onPress={() => onDelete(item)} style={styles.deleteButton}><Text style={styles.deleteText}>Delete</Text></Pressable></View>
          </View>
        </View>;
      }) : <View style={styles.empty}><Text style={styles.emptyTitle}>Nothing on the reminder list</Text><Text style={styles.hint}>Create a reminder above and it will be saved on this device.</Text></View>}
      {completed.length ? <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Completed</Text><Text style={styles.count}>{completed.length}</Text></View> : null}
      {completed.map(item => <View key={item.id} style={[styles.reminderCard, styles.completedCard]}><View style={styles.reminderCopy}><Text style={styles.reminderTitle}>{item.title}</Text><Text style={styles.reminderDate}>Completed</Text></View><Pressable onPress={() => onDelete(item)}><Text style={styles.deleteText}>Remove</Text></Pressable></View>)}
      <Text style={styles.footer}>Local-first reminders · Scheduled on this device</Text>
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
  smallButtonText: { color: C.text, fontSize: 9, fontWeight: "700" }, deleteButton: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, backgroundColor: "#3A2525" }, deleteText: { color: C.danger, fontSize: 9, fontWeight: "800" },
  empty: { padding: 18, gap: 6, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderStyle: "dashed", borderColor: C.border }, emptyTitle: { color: C.text, fontSize: 12, fontWeight: "700" },
  completedCard: { opacity: 0.65 }, hint: { color: C.muted, fontSize: 10, lineHeight: 15 }, footer: { color: C.muted, fontSize: 9, textAlign: "center", paddingTop: 8 },
});
