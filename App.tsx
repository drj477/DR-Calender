import "react-native-gesture-handler";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useCalendarStore } from "./src/store/calendarStore";

type ScreenMode = "Day" | "Week" | "Month";
type Task = { id: string; title: string; due: string; assignee: string; completed: boolean };
type Event = { id: string; start: string; end: string; title: string; subtitle: string; color: string; top: number; height: number };

const COLORS = {
  background: "#0C0F14",
  surface: "#141922",
  surfaceRaised: "#1B222D",
  border: "#252D39",
  text: "#F3F5F8",
  muted: "#8994A5",
  accent: "#B8F36B",
  lavender: "#B7A5FF",
  blue: "#86C7FF",
  coral: "#FFAD9B",
};

const EVENTS: Event[] = [
  { id: "e1", start: "09:00", end: "09:45", title: "Product stand-up", subtitle: "Design team · Meet", color: COLORS.lavender, top: 0, height: 82 },
  { id: "e2", start: "10:30", end: "11:30", title: "Deep work", subtitle: "Focus shield enabled", color: COLORS.accent, top: 0, height: 104 },
  { id: "e3", start: "13:00", end: "13:45", title: "Campaign review", subtitle: "Marketing · Room 02", color: COLORS.blue, top: 0, height: 82 },
  { id: "e4", start: "15:30", end: "16:15", title: "Project planning", subtitle: "DR Calender", color: COLORS.coral, top: 0, height: 82 },
];

const INITIAL_TASKS: Task[] = [
  { id: "t1", title: "Review onboarding flow", due: "Today · 11:30 AM", assignee: "You", completed: false },
  { id: "t2", title: "Send campaign brief", due: "Today · 2:00 PM", assignee: "AK", completed: false },
  { id: "t3", title: "Update sprint notes", due: "Tomorrow", assignee: "You", completed: true },
];

function TaskRow({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const toggle = () => {
    scale.value = withSpring(0.85, { damping: 20, stiffness: 320, mass: 0.6 }, () => {
      scale.value = withSpring(1, { damping: 28, stiffness: 280, mass: 0.8 });
    });
    onToggle();
  };

  return (
    <Animated.View style={[styles.taskRow, animatedStyle]}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: task.completed }} onPress={toggle} style={[styles.checkbox, task.completed && styles.checkboxDone]}>
        {task.completed ? <Text style={styles.checkGlyph}>✓</Text> : null}
      </Pressable>
      <View style={styles.taskCopy}>
        <Text style={[styles.taskTitle, task.completed && styles.completedText]}>{task.title}</Text>
        <Text style={styles.taskDue}>{task.due}</Text>
      </View>
      <View style={styles.avatar}><Text style={styles.avatarText}>{task.assignee === "You" ? "DR" : task.assignee}</Text></View>
    </Animated.View>
  );
}

function EventCard({ event, index }: { event: Event; index: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(index * 18).duration(180)} style={[styles.eventCard, { minHeight: event.height, borderLeftColor: event.color }]}>
      <View style={styles.eventTopLine}>
        <Text style={styles.eventTime}>{event.start} – {event.end}</Text>
        {event.title === "Deep work" ? <View style={styles.shieldPill}><Text style={styles.shieldText}>SHIELDED</Text></View> : null}
      </View>
      <Text style={styles.eventTitle}>{event.title}</Text>
      <Text style={styles.eventSubtitle}>{event.subtitle}</Text>
    </Animated.View>
  );
}

function CalendarApp() {
  const [mode, setMode] = useState<ScreenMode>("Day");
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const pendingCount = useCalendarStore(state => state.pendingMutations.length);
  const today = useMemo(() => new Date(), []);
  const monthLabel = today.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const days = useMemo(() => {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const count = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return Array.from({ length: count }, (_, i) => ({
      day: i + 1,
      weekday: new Date(today.getFullYear(), today.getMonth(), i + 1).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1),
    }));
  }, [today]);

  const toggleTask = (id: string) => setTasks(current => current.map(task => task.id === id ? { ...task, completed: !task.completed } : task));
  const addQuickTask = () => setTasks(current => [
    { id: `t-${Date.now()}`, title: "New task", due: "Today · No time set", assignee: "You", completed: false },
    ...current,
  ]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>YOUR SPACE</Text>
          <Text style={styles.brand}>Calender<Text style={styles.brandDot}>.</Text></Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="Search" style={styles.iconButton}><Text style={styles.iconGlyph}>⌕</Text></Pressable>
          <Pressable accessibilityLabel="Profile" style={styles.profileButton}><Text style={styles.profileText}>DR</Text></Pressable>
        </View>
      </View>

      <View style={styles.modeBar}>
        <View>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <Text style={styles.subLabel}>{today.toLocaleDateString(undefined, { weekday: "long", day: "numeric" })}</Text>
        </View>
        <View style={styles.modeSwitch}>
          {(["Day", "Week", "Month"] as ScreenMode[]).map(item => (
            <Pressable key={item} onPress={() => setMode(item)} style={[styles.modeOption, mode === item && styles.modeOptionActive]}>
              <Text style={[styles.modeText, mode === item && styles.modeTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.weekStrip}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysContent}>
          {days.map(({ day, weekday }) => (
            <Pressable key={day} onPress={() => setSelectedDay(day)} style={[styles.dayItem, selectedDay === day && styles.dayItemActive]}>
              <Text style={[styles.dayWeekday, selectedDay === day && styles.dayWeekdayActive]}>{weekday}</Text>
              <Text style={[styles.dayNumber, selectedDay === day && styles.dayNumberActive]}>{day}</Text>
              {[5, 9, 14, 18, 23, 27].includes(day) ? <View style={[styles.dayDot, selectedDay === day && styles.dayDotActive]} /> : <View style={styles.dayDotPlaceholder} />}
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionHeading}>
          <View><Text style={styles.sectionTitle}>{mode === "Day" ? "Today’s agenda" : `${mode} overview`}</Text><Text style={styles.sectionCaption}>A little structure, a lot more space.</Text></View>
          <Pressable onPress={addQuickTask} style={styles.addButton}><Text style={styles.addGlyph}>＋</Text></Pressable>
        </View>

        {mode === "Month" ? (
          <View style={styles.monthPlaceholder}>
            <Text style={styles.monthPlaceholderTitle}>Monthly overview</Text>
            <Text style={styles.sectionCaption}>Choose a day above to view its schedule.</Text>
          </View>
        ) : (
          <View style={styles.timeline}>
            <View style={styles.timeRail}>
              {["09 AM", "10 AM", "11 AM", "12 PM", "01 PM", "02 PM", "03 PM", "04 PM"].map(time => <Text key={time} style={styles.timeLabel}>{time}</Text>)}
            </View>
            <View style={styles.eventsColumn}>
              <View style={styles.timelineLine} />
              {EVENTS.map((event, index) => <EventCard key={event.id} event={event} index={index} />)}
            </View>
          </View>
        )}

        <View style={styles.tasksSection}>
          <View style={styles.sectionHeading}>
            <View><Text style={styles.sectionTitle}>In the loop</Text><Text style={styles.sectionCaption}>{tasks.filter(task => !task.completed).length} tasks need your attention</Text></View>
            <Pressable onPress={addQuickTask}><Text style={styles.seeAll}>＋ Add</Text></Pressable>
          </View>
          <View style={styles.tasksCard}>
            {tasks.map(task => <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task.id)} />)}
          </View>
        </View>
        <View style={styles.syncNote}><View style={styles.syncDot} /><Text style={styles.syncText}>{pendingCount ? `${pendingCount} changes waiting to sync` : "Offline-first · Ready when you are"}</Text></View>
      </ScrollView>

      <View style={styles.bottomNav}>
        {[
          { glyph: "▦", label: "Calendar", active: true },
          { glyph: "✓", label: "Tasks", active: false },
          { glyph: "◷", label: "Reminders", active: false },
          { glyph: "◉", label: "Spaces", active: false },
        ].map(item => (
          <Pressable key={item.label} style={styles.navItem}>
            <Text style={[styles.navGlyph, item.active && styles.navGlyphActive]}>{item.glyph}</Text>
            <Text style={[styles.navLabel, item.active && styles.navLabelActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider><CalendarApp /></SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: COLORS.muted, fontSize: 10, letterSpacing: 2.4, fontWeight: "700", marginBottom: 4 },
  brand: { color: COLORS.text, fontSize: 29, fontWeight: "800", letterSpacing: -1.2 },
  brandDot: { color: COLORS.accent },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  iconGlyph: { color: COLORS.text, fontSize: 28, lineHeight: 30 },
  profileButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center" },
  profileText: { color: COLORS.background, fontSize: 12, fontWeight: "900" },
  modeBar: { paddingHorizontal: 24, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  monthLabel: { color: COLORS.text, fontSize: 18, fontWeight: "700" },
  subLabel: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  modeSwitch: { flexDirection: "row", padding: 4, backgroundColor: COLORS.surface, borderRadius: 13, borderWidth: 1, borderColor: COLORS.border },
  modeOption: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9 },
  modeOptionActive: { backgroundColor: COLORS.surfaceRaised },
  modeText: { color: COLORS.muted, fontSize: 11, fontWeight: "600" },
  modeTextActive: { color: COLORS.text },
  weekStrip: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.border, paddingVertical: 12 },
  daysContent: { paddingHorizontal: 17, gap: 7 },
  dayItem: { width: 42, height: 66, alignItems: "center", justifyContent: "center", borderRadius: 14, gap: 5 },
  dayItemActive: { backgroundColor: COLORS.accent },
  dayWeekday: { color: COLORS.muted, fontSize: 10, fontWeight: "600" },
  dayWeekdayActive: { color: "#455A2A" },
  dayNumber: { color: COLORS.text, fontSize: 15, fontWeight: "700" },
  dayNumberActive: { color: COLORS.background },
  dayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.lavender },
  dayDotActive: { backgroundColor: COLORS.background },
  dayDotPlaceholder: { width: 4, height: 4 },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 28 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  sectionTitle: { color: COLORS.text, fontSize: 18, fontWeight: "750", letterSpacing: -0.4 },
  sectionCaption: { color: COLORS.muted, fontSize: 11, marginTop: 5 },
  addButton: { height: 38, width: 38, borderRadius: 13, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center" },
  addGlyph: { color: COLORS.background, fontSize: 25, fontWeight: "400", marginTop: -2 },
  timeline: { flexDirection: "row", gap: 13 },
  timeRail: { width: 43, justifyContent: "space-between", paddingTop: 3, paddingBottom: 5 },
  timeLabel: { color: COLORS.muted, fontSize: 9, fontWeight: "600", height: 55 },
  eventsColumn: { flex: 1, gap: 9, paddingBottom: 4 },
  timelineLine: { position: "absolute", left: 0, top: 0, bottom: 0, width: 1, backgroundColor: COLORS.border },
  eventCard: { marginLeft: 10, borderLeftWidth: 3, borderRadius: 13, backgroundColor: COLORS.surface, paddingHorizontal: 13, paddingVertical: 12, borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderTopColor: COLORS.border, borderRightColor: COLORS.border, borderBottomColor: COLORS.border },
  eventTopLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eventTime: { color: COLORS.muted, fontSize: 10, fontWeight: "600" },
  eventTitle: { color: COLORS.text, fontSize: 13, fontWeight: "700", marginTop: 8 },
  eventSubtitle: { color: COLORS.muted, fontSize: 10, marginTop: 4 },
  shieldPill: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: "#28351E" },
  shieldText: { color: COLORS.accent, fontSize: 8, fontWeight: "800", letterSpacing: 0.7 },
  tasksSection: { marginTop: 28 },
  seeAll: { color: COLORS.accent, fontSize: 11, fontWeight: "700" },
  tasksCard: { backgroundColor: COLORS.surface, borderRadius: 17, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14 },
  taskRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  checkbox: { width: 21, height: 21, borderRadius: 7, borderWidth: 1.5, borderColor: "#4B5666", alignItems: "center", justifyContent: "center" },
  checkboxDone: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  checkGlyph: { color: COLORS.background, fontSize: 13, fontWeight: "900" },
  taskCopy: { flex: 1, gap: 5 },
  taskTitle: { color: COLORS.text, fontSize: 12, fontWeight: "600" },
  completedText: { color: COLORS.muted, textDecorationLine: "line-through" },
  taskDue: { color: COLORS.muted, fontSize: 10 },
  avatar: { width: 28, height: 28, borderRadius: 10, backgroundColor: COLORS.surfaceRaised, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border },
  avatarText: { color: COLORS.text, fontSize: 9, fontWeight: "800" },
  syncNote: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 22, marginBottom: 5 },
  syncDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.accent },
  syncText: { color: COLORS.muted, fontSize: 10 },
  bottomNav: { flexDirection: "row", paddingTop: 11, paddingBottom: 7, backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.border, justifyContent: "space-around" },
  navItem: { alignItems: "center", gap: 5, minWidth: 55 },
  navGlyph: { color: COLORS.muted, fontSize: 19, height: 23 },
  navGlyphActive: { color: COLORS.accent },
  navLabel: { color: COLORS.muted, fontSize: 9, fontWeight: "600" },
  navLabelActive: { color: COLORS.accent },
  monthPlaceholder: { padding: 24, borderRadius: 16, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  monthPlaceholderTitle: { color: COLORS.text, fontSize: 15, fontWeight: "700", marginBottom: 8 },
});
