import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ChecklistItem, TemporalEntity, TemporalPriority } from "../temporal/types";

const C = { bg: "#10141D", surface: "#171C28", raised: "#202838", border: "#30394B", text: "#F4F6FC", muted: "#9BA7BA", accent: "#FFC247", danger: "#FF9A63", green: "#72D6A1", wash: "#322817" };
type Filter = "Inbox" | "Today" | "Upcoming" | "Overdue" | "Completed";
export type TaskDraft = { id?: string; title: string; dueAt: number | null; durationMinutes: number; priority: TemporalPriority; checklist: ChecklistItem[] };

type Props = {
  tasks: TemporalEntity[];
  onSave: (draft: TaskDraft) => void;
  onToggle: (task: TemporalEntity) => void;
  onDelete: (task: TemporalEntity) => void;
  onPlanDay: () => void;
  onRollover: (task: TemporalEntity) => void;
};

const dateValue = (epoch: number | null) => {
  const date = new Date(epoch ?? Date.now());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const timeValue = (epoch: number | null) => {
  const date = new Date(epoch ?? Date.now());
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const priorityLabel: Record<TemporalPriority, string> = { low: "Low", normal: "Normal", high: "High", critical: "Urgent" };

export function TaskCenter({ tasks, onSave, onToggle, onDelete, onPlanDay, onRollover }: Props) {
  const [filter, setFilter] = useState<Filter>("Inbox");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TemporalEntity | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(dateValue(Date.now() + 60 * 60_000));
  const [time, setTime] = useState(timeValue(Date.now() + 60 * 60_000));
  const [hasDue, setHasDue] = useState(true);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [priority, setPriority] = useState<TemporalPriority>("normal");
  const [checklistText, setChecklistText] = useState("");
  const [error, setError] = useState("");
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const today = new Date();
  const tomorrowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  const liveTasks = useMemo(() => tasks.filter(t => t.itemType === "task" && t.deletedAt === null), [tasks]);
  const overdue = (task: TemporalEntity) => !task.isCompleted && (task.metadata?.task?.dueAt ?? task.scheduledAt) !== null && (task.metadata?.task?.dueAt ?? task.scheduledAt)! < todayStart;
  const counts: Record<Filter, number> = {
    Inbox: liveTasks.filter(t => !t.isCompleted && (t.metadata?.task?.dueAt ?? t.scheduledAt) === null).length,
    Today: liveTasks.filter(t => !t.isCompleted && (t.metadata?.task?.dueAt ?? t.scheduledAt) !== null && (t.metadata?.task?.dueAt ?? t.scheduledAt)! >= todayStart && (t.metadata?.task?.dueAt ?? t.scheduledAt)! < tomorrowStart).length,
    Upcoming: liveTasks.filter(t => !t.isCompleted && (t.metadata?.task?.dueAt ?? t.scheduledAt) !== null && (t.metadata?.task?.dueAt ?? t.scheduledAt)! >= tomorrowStart).length,
    Overdue: liveTasks.filter(overdue).length,
    Completed: liveTasks.filter(t => t.isCompleted).length,
  };
  const visible = liveTasks.filter(task => {
    const due = task.metadata?.task?.dueAt ?? task.scheduledAt;
    if (filter === "Completed") return task.isCompleted;
    if (filter === "Inbox") return !task.isCompleted && due === null;
    if (filter === "Today") return !task.isCompleted && due !== null && due >= todayStart && due < tomorrowStart;
    if (filter === "Upcoming") return !task.isCompleted && due !== null && due >= tomorrowStart;
    return overdue(task);
  }).sort((a, b) => {
    const dueA = a.metadata?.task?.dueAt ?? a.scheduledAt ?? Number.MAX_SAFE_INTEGER;
    const dueB = b.metadata?.task?.dueAt ?? b.scheduledAt ?? Number.MAX_SAFE_INTEGER;
    return (a.isCompleted ? 1 : 0) - (b.isCompleted ? 1 : 0) || ({ critical: 0, high: 1, normal: 2, low: 3 }[a.priority] - { critical: 0, high: 1, normal: 2, low: 3 }[b.priority]) || dueA - dueB;
  });
  const openEditor = (task: TemporalEntity | null = null) => {
    setEditing(task); setTitle(task?.title ?? ""); setHasDue((task?.metadata?.task?.dueAt ?? task?.scheduledAt ?? null) !== null);
    const due = task?.metadata?.task?.dueAt ?? task?.scheduledAt ?? Date.now() + 60 * 60_000;
    setDate(dateValue(due)); setTime(timeValue(due)); setPriority(task?.priority ?? "normal"); setDurationMinutes(task?.metadata?.task?.durationMinutes ?? (task?.endAt && task?.scheduledAt ? Math.max(15,Math.round((task.endAt-task.scheduledAt)/60000)) : 30));
    setChecklistText((task?.metadata?.task?.checklist ?? []).map(item => item.title).join("\n")); setError(""); setEditorOpen(true);
  };
  const save = () => {
    if (!title.trim()) { setError("Enter a task title."); return; }
    let dueAt: number | null = null;
    if (hasDue) {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
      const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
      if (!d || !t || Number(t[1]) > 23 || Number(t[2]) > 59) { setError("Use date YYYY-MM-DD and time HH:MM (24-hour)."); return; }
      dueAt = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2])).getTime();
      const actual = new Date(dueAt);
      if (actual.getFullYear() !== Number(d[1]) || actual.getMonth() !== Number(d[2]) - 1 || actual.getDate() !== Number(d[3])) { setError("That date does not exist."); return; }
    }
    const existing = editing?.metadata?.task?.checklist ?? [];
    const lines = checklistText.split("\n").map(line => line.trim()).filter(Boolean);
    const checklist: ChecklistItem[] = lines.map((line, index) => {
      const match = existing.find(item => item.title === line);
      return match ?? { id: `check-${Date.now()}-${index}`, title: line, isCompleted: false, assignedUserId: null, updatedAt: Date.now() };
    });
    onSave({ id: editing?.id, title: title.trim(), dueAt, durationMinutes, priority, checklist });
    setEditorOpen(false);
  };
  const toggleChecklistItem = (task: TemporalEntity, item: ChecklistItem) => {
    const current = task.metadata?.task?.checklist ?? [];
    onSave({ id: task.id, title: task.title, dueAt: task.metadata?.task?.dueAt ?? task.scheduledAt, durationMinutes: task.metadata?.task?.durationMinutes ?? (task.endAt && task.scheduledAt ? Math.max(15,Math.round((task.endAt-task.scheduledAt)/60000)) : 30), priority: task.priority, checklist: current.map(entry => entry.id === item.id ? { ...entry, isCompleted: !entry.isCompleted, updatedAt: Date.now() } : entry) });
  };

  return <View style={s.root}>
    <View style={s.hero}>
      <View style={{ flex: 1, gap: 5 }}><Text style={s.kicker}>MAKE ROOM FOR WHAT MATTERS</Text><Text style={s.heading}>Tasks</Text><Text style={s.subtitle}>{liveTasks.filter(t => !t.isCompleted).length} open · {counts.Overdue} overdue</Text></View>
      <Pressable onPress={() => { setFilter("Today"); onPlanDay(); }} style={s.planButton} accessibilityRole="button"><Text style={s.planText}>✦ Plan my day</Text></Pressable>
    </View>
    <View style={s.actions}><Pressable onPress={() => openEditor()} style={s.addButton} accessibilityRole="button"><Text style={s.addText}>＋ New task</Text></Pressable><Text style={s.helper}>Tasks save locally and enter the sync outbox.</Text></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
      {(["Inbox", "Today", "Upcoming", "Overdue", "Completed"] as Filter[]).map(item => <Pressable key={item} onPress={() => setFilter(item)} accessibilityRole="button" accessibilityState={{ selected: filter === item }} style={[s.filter, filter === item && s.filterActive]}><Text style={[s.filterText, filter === item && s.filterTextActive]}>{item}</Text><Text style={[s.filterCount, filter === item && s.filterTextActive]}>{counts[item]}</Text></Pressable>)}
    </ScrollView>
    <ScrollView style={s.list} contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
      {visible.length ? visible.map(task => {
        const due = task.metadata?.task?.dueAt ?? task.scheduledAt;
        const checklist = task.metadata?.task?.checklist ?? [];
        const done = checklist.filter(item => item.isCompleted).length;
        return <View key={task.id} style={s.card}>
          <Pressable onPress={() => onToggle(task)} accessibilityRole="checkbox" accessibilityState={{ checked: task.isCompleted }} style={[s.check, task.isCompleted && s.checkDone]}><Text style={s.checkGlyph}>{task.isCompleted ? "✓" : ""}</Text></Pressable>
          <View style={s.taskMain}>
            <Pressable onPress={() => openEditor(task)} accessibilityRole="button"><Text style={[s.taskTitle, task.isCompleted && s.completed]}>{task.title}</Text></Pressable>
            <View style={s.metaRow}><View style={[s.priorityPill, task.priority === "critical" || task.priority === "high" ? s.priorityHot : null]}><Text style={s.priorityText}>{priorityLabel[task.priority]}</Text></View><Text style={[s.dueText, overdue(task) && s.overdueText]}>{due === null ? "No due date" : overdue(task) ? "OVERDUE · " : ""}{due === null ? "" : new Date(due).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Text>{checklist.length ? <Text style={s.checklistCount}>{done}/{checklist.length} steps</Text> : null}</View>
            {checklist.length ? <View style={s.checklist}>{checklist.map(item => <Pressable key={item.id} onPress={() => toggleChecklistItem(task, item)} style={s.checklistRow} accessibilityRole="checkbox" accessibilityState={{ checked: item.isCompleted }}><Text style={[s.checklistMark, item.isCompleted && s.checklistMarkDone]}>{item.isCompleted ? "✓" : "○"}</Text><Text style={[s.checklistText, item.isCompleted && s.completed]}>{item.title}</Text></Pressable>)}</View> : null}
            {overdue(task) ? <Pressable onPress={() => onRollover(task)} style={s.rollover}><Text style={s.rolloverText}>Move to today →</Text></Pressable> : null}
          </View>
          <Pressable onPress={() => openEditor(task)} accessibilityRole="button" accessibilityLabel={`Edit ${task.title}`} style={s.editButton}><Text style={s.editGlyph}>···</Text></Pressable>
          <Pressable onPress={() => onDelete(task)} accessibilityRole="button" accessibilityLabel={`Delete ${task.title}`} style={s.deleteButton}><Text style={s.deleteGlyph}>×</Text></Pressable>
        </View>;
      }) : <View style={s.empty}><Text style={s.emptyTitle}>{filter === "Completed" ? "Nothing completed yet" : filter === "Overdue" ? "You’re clear of overdue tasks" : "A little breathing room"}</Text><Text style={s.helper}>{filter === "Inbox" ? "Capture a task without a due date, then decide when it belongs." : "Tasks in this view will appear here."}</Text></View>}
    </ScrollView>
    <Modal visible={editorOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditorOpen(false)}>
      <View style={s.modal}>
        <View style={s.modalHeader}><Pressable onPress={() => setEditorOpen(false)}><Text style={s.cancel}>Cancel</Text></Pressable><Text style={s.modalTitle}>{editing ? "Edit task" : "New task"}</Text><Pressable onPress={save}><Text style={s.save}>Save</Text></Pressable></View>
        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          <Text style={s.label}>TASK</Text><TextInput value={title} onChangeText={setTitle} placeholder="What needs doing?" placeholderTextColor={C.muted} style={s.input} autoFocus={!editing} />
          <Pressable onPress={() => setHasDue(value => !value)} style={s.dueToggle} accessibilityRole="checkbox" accessibilityState={{ checked: hasDue }}><Text style={s.formTitle}>Due date and time</Text><Text style={s.toggleValue}>{hasDue ? "On ✓" : "No due date"}</Text></Pressable>
          {hasDue ? <View style={s.row}><View style={s.field}><Text style={s.label}>DATE</Text><TextInput value={date} onChangeText={setDate} style={s.input} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted} /></View><View style={s.field}><Text style={s.label}>TIME (24H)</Text><TextInput value={time} onChangeText={setTime} style={s.input} placeholder="HH:MM" placeholderTextColor={C.muted} /></View></View> : null}
          <Text style={s.label}>ESTIMATED WORK DURATION</Text><View style={s.priorityChoices}>{([15,30,45,60,90,120] as const).map(value => <Pressable key={value} onPress={() => setDurationMinutes(value)} style={[s.priorityChoice,durationMinutes===value&&s.priorityChoiceActive]}><Text style={[s.priorityText,durationMinutes===value&&s.prioritySelected]}>{value<60?value+" min":value/60+" hr"+(value===60?"":"s")}</Text></Pressable>)}</View>
          <Text style={s.label}>PRIORITY</Text><View style={s.priorityChoices}>{(["low", "normal", "high", "critical"] as TemporalPriority[]).map(value => <Pressable key={value} onPress={() => setPriority(value)} style={[s.priorityChoice, priority === value && s.priorityChoiceActive]}><Text style={[s.priorityText, priority === value && s.prioritySelected]}>{priorityLabel[value]}</Text></Pressable>)}</View>
          <Text style={s.label}>CHECKLIST</Text><Text style={s.helper}>One step per line. Completed steps are preserved when you edit a task.</Text><TextInput multiline value={checklistText} onChangeText={setChecklistText} placeholder={"Prepare notes\nReview details\nSend it"} placeholderTextColor={C.muted} style={[s.input, s.multiline]} />
          {error ? <Text style={s.error}>{error}</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg }, hero: { paddingHorizontal: 20, paddingTop: 17, paddingBottom: 13, flexDirection: "row", alignItems: "center", gap: 10 }, kicker: { color: C.accent, fontSize: 9, letterSpacing: 1.5, fontWeight: "800" }, heading: { color: C.text, fontSize: 28, fontWeight: "900" }, subtitle: { color: C.muted, fontSize: 11 },
  planButton: { backgroundColor: C.wash, borderWidth: 1, borderColor: "#72551C", paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12 }, planText: { color: C.accent, fontSize: 10, fontWeight: "900" }, actions: { paddingHorizontal: 20, gap: 7 }, addButton: { alignSelf: "flex-start", backgroundColor: C.accent, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 13 }, addText: { color: C.bg, fontSize: 11, fontWeight: "900" }, helper: { color: C.muted, fontSize: 10, lineHeight: 15 },
  filters: { paddingHorizontal: 18, paddingVertical: 14, gap: 7 }, filter: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }, filterActive: { backgroundColor: C.wash, borderColor: C.accent }, filterText: { color: C.muted, fontSize: 10, fontWeight: "800" }, filterTextActive: { color: C.accent }, filterCount: { color: C.muted, fontSize: 9 },
  list: { flex: 1 }, listContent: { paddingHorizontal: 16, paddingBottom: 22, gap: 9 }, card: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 13, borderRadius: 15, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }, check: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: C.border, alignItems: "center", justifyContent: "center", marginTop: 1 }, checkDone: { backgroundColor: C.accent, borderColor: C.accent }, checkGlyph: { color: C.bg, fontWeight: "900" }, taskMain: { flex: 1, gap: 7 }, taskTitle: { color: C.text, fontSize: 12, fontWeight: "800" }, completed: { color: C.muted, textDecorationLine: "line-through" }, metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 }, priorityPill: { backgroundColor: C.raised, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4 }, priorityHot: { backgroundColor: "#3A2525" }, priorityText: { color: C.muted, fontSize: 9, fontWeight: "800" }, dueText: { color: C.muted, fontSize: 9 }, overdueText: { color: C.danger, fontWeight: "900" }, checklistCount: { color: C.accent, fontSize: 9, fontWeight: "800" },
  checklist: { gap: 5, paddingTop: 3 }, checklistRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 3 }, checklistMark: { color: C.muted, fontSize: 13 }, checklistMarkDone: { color: C.green }, checklistText: { color: C.text, fontSize: 10, flex: 1 }, rollover: { alignSelf: "flex-start", backgroundColor: C.wash, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, marginTop: 2 }, rolloverText: { color: C.accent, fontSize: 10, fontWeight: "800" }, editButton: { paddingHorizontal: 3, paddingVertical: 1 }, editGlyph: { color: C.muted, fontSize: 17 }, deleteButton: { paddingHorizontal: 2 }, deleteGlyph: { color: C.danger, fontSize: 20 }, empty: { padding: 22, backgroundColor: C.surface, borderRadius: 14, gap: 7, borderWidth: 1, borderColor: C.border, borderStyle: "dashed" }, emptyTitle: { color: C.text, fontSize: 13, fontWeight: "800" },
  modal: { flex: 1, backgroundColor: C.bg }, modalHeader: { minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 22, borderBottomWidth: 1, borderColor: C.border }, cancel: { color: C.muted, fontSize: 13 }, modalTitle: { color: C.text, fontSize: 15, fontWeight: "800" }, save: { color: C.accent, fontSize: 13, fontWeight: "900" }, form: { padding: 22, gap: 10, paddingBottom: 44 }, label: { color: C.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1.3, marginTop: 10 }, input: { color: C.text, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13, fontSize: 12 }, multiline: { minHeight: 110, textAlignVertical: "top" }, dueToggle: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12 }, formTitle: { color: C.text, fontSize: 12, fontWeight: "800" }, toggleValue: { color: C.accent, fontSize: 10, fontWeight: "800" }, row: { flexDirection: "row", gap: 9 }, field: { flex: 1, gap: 4 }, priorityChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, priorityChoice: { padding: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 9 }, priorityChoiceActive: { borderColor: C.accent, backgroundColor: C.wash }, prioritySelected: { color: C.accent }, error: { color: C.danger, fontSize: 11 },
});
