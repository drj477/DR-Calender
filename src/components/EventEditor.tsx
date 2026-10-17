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
};

export interface EventDraft {
  title: string;
  startAt: number;
  endAt: number;
  location: string | null;
  isShielded: boolean;
  isElastic: boolean;
}

interface EventEditorProps {
  visible: boolean;
  selectedDate: Date;
  event: TemporalEntity | null;
  onClose: () => void;
  onSave: (draft: EventDraft) => void;
  onDelete?: (event: TemporalEntity) => void;
}

function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function EventEditor({ visible, selectedDate, event, onClose, onSave, onDelete }: EventEditorProps) {
  const [title, setTitle] = useState("");
  const [startClock, setStartClock] = useState("09:00");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [shielded, setShielded] = useState(false);
  const [elastic, setElastic] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setTitle(event?.title ?? "");
    const start = event?.scheduledAt ?? new Date(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 9, 0,
    ).getTime();
    const end = event?.endAt ?? start + 60 * 60_000;
    setStartClock(formatClock(new Date(start)));
    setDuration(String(Math.max(5, Math.round((end - start) / 60_000))));
    setLocation(event?.metadata?.event?.location ?? "");
    setShielded(event?.isShielded ?? false);
    setElastic(event?.isElastic ?? false);
    setError("");
  }, [visible, selectedDate, event]);

  const save = () => {
    const cleanTitle = title.trim();
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(startClock.trim());
    const minutes = Number(duration);
    if (!cleanTitle) {
      setError("Give your event a title.");
      return;
    }
    if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59) {
      setError("Enter a valid 24-hour time, such as 09:30.");
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
      setError("Duration must be between 5 and 1440 minutes.");
      return;
    }

    const startAt = new Date(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
      Number(timeMatch[1]), Number(timeMatch[2]), 0, 0,
    ).getTime();
    onSave({
      title: cleanTitle,
      startAt,
      endAt: startAt + minutes * 60_000,
      location: location.trim() || null,
      isShielded: shielded,
      isElastic: elastic,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable onPress={onClose} accessibilityRole="button"><Text style={styles.cancel}>Cancel</Text></Pressable>
          <Text style={styles.heading}>{event ? "Edit event" : "New event"}</Text>
          <Pressable onPress={save} accessibilityRole="button"><Text style={styles.save}>Save</Text></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
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
          <View style={styles.readOnlyField}>
            <Text style={styles.fieldText}>{selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</Text>
          </View>

          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <Text style={styles.label}>START TIME (24H)</Text>
              <TextInput value={startClock} onChangeText={setStartClock} placeholder="09:00" placeholderTextColor={palette.muted} keyboardType="numbers-and-punctuation" maxLength={5} style={styles.input} />
            </View>
            <View style={styles.column}>
              <Text style={styles.label}>DURATION (MIN)</Text>
              <TextInput value={duration} onChangeText={setDuration} placeholder="60" placeholderTextColor={palette.muted} keyboardType="number-pad" maxLength={4} style={styles.input} />
            </View>
          </View>

          <Text style={styles.label}>LOCATION (OPTIONAL)</Text>
          <TextInput value={location} onChangeText={setLocation} placeholder="Add a room or address" placeholderTextColor={palette.muted} style={styles.input} />

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
            <Pressable style={styles.deleteButton} onPress={() => onDelete(event)}>
              <Text style={styles.deleteText}>Delete event</Text>
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
  titleInput: { color: palette.text, fontSize: 23, fontWeight: "700", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: palette.border, marginBottom: 8 },
  readOnlyField: { padding: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 13 },
  fieldText: { color: palette.text, fontSize: 13 },
  twoColumns: { flexDirection: "row", gap: 12 },
  column: { flex: 1 },
  input: { color: palette.text, fontSize: 14, paddingHorizontal: 13, paddingVertical: 13, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 13 },
  optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: palette.border, gap: 16 },
  optionCopy: { flex: 1, gap: 4 },
  optionTitle: { color: palette.text, fontSize: 13, fontWeight: "700" },
  optionHint: { color: palette.muted, fontSize: 11, lineHeight: 16 },
  toggle: { width: 43, height: 25, borderRadius: 13, padding: 3, backgroundColor: palette.raised, borderWidth: 1, borderColor: palette.border, justifyContent: "center" },
  toggleOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  toggleThumb: { width: 17, height: 17, borderRadius: 9, backgroundColor: palette.muted },
  toggleThumbOn: { alignSelf: "flex-end", backgroundColor: palette.background },
  error: { color: palette.danger, fontSize: 12, marginTop: 8 },
  deleteButton: { marginTop: 25, padding: 15, alignItems: "center", borderWidth: 1, borderColor: "#5A332A", borderRadius: 13 },
  deleteText: { color: palette.danger, fontSize: 13, fontWeight: "700" },
});
