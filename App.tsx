import "react-native-gesture-handler";
import React, { useEffect, useMemo, useState } from "react";
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
import { initializeLocalDatabase, makeTaskEntity, type LocalCalendarDatabase } from "./src/persistence/localDatabase";
import { EventEditor, type EventDraft } from "./src/components/EventEditor";
import { DayTimeline } from "./src/components/DayTimeline";
import { CalendarOverview } from "./src/components/CalendarOverview";
import type { TemporalEntity } from "./src/temporal/types";

type ScreenMode = "Day" | "Week" | "Month";
type Task = { id: string; title: string; due: string; assignee: string; completed: boolean };


const COLORS = {
  background: "#10141D",
  surface: "#171C28",
  surfaceRaised: "#202838",
  border: "#30394B",
  text: "#F4F6FC",
  muted: "#9BA7BA",
  accent: "#FFC247",
  lavender: "#F4C45E",
  blue: "#E7B95A",
  coral: "#FF9A63",
};

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

function EventCard({ event, index, onPress }: { event: TemporalEntity; index: number; onPress: () => void }) {
  const start = event.scheduledAt === null ? null : new Date(event.scheduledAt);
  const end = event.endAt === null ? null : new Date(event.endAt);
  const color = event.isShielded ? COLORS.accent : event.isElastic ? COLORS.coral : COLORS.lavender;
  const timeLabel = start
    ? `${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${end ? end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "No end"}`
    : "No time set";
  const location = event.metadata?.event?.location;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Edit ${event.title}`}>
      <Animated.View entering={FadeInDown.delay(index * 18).duration(180)} style={[styles.eventCard, { minHeight: 82, borderLeftColor: color }]}>
        <View style={styles.eventTopLine}>
          <Text style={styles.eventTime}>{timeLabel}</Text>
          {event.isShielded ? <View style={styles.shieldPill}><Text style={styles.shieldText}>SHIELDED</Text></View> : null}
          {event.isElastic ? <View style={styles.shieldPill}><Text style={styles.shieldText}>FLEXIBLE</Text></View> : null}
        </View>
        <Text style={styles.eventTitle}>{event.title}</Text>
        <Text style={styles.eventSubtitle}>{location ?? "Tap to edit event"}</Text>
      </Animated.View>
    </Pressable>
  );
}

function CalendarApp() {
  const [mode, setMode] = useState<ScreenMode>("Day");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const selectedDay = selectedDate.getDate();
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [database, setDatabase] = useState<LocalCalendarDatabase | null>(null);
  const [eventEditorVisible, setEventEditorVisible] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TemporalEntity | null>(null);
  const pendingCount = useCalendarStore(state => state.pendingMutations.length);
  const storedEntities = useCalendarStore(state => Object.values(state.entitiesById));

  const eventEditorDate = useMemo(
    () => editingEvent?.scheduledAt !== null && editingEvent?.scheduledAt !== undefined
      ? new Date(editingEvent.scheduledAt)
      : selectedDate,
    [editingEvent, selectedDate],
  );
  const dayStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()).getTime();
  const dayEnd = dayStart + 24 * 60 * 60_000;
  const visibleEvents = storedEntities
    .filter(entity => entity.itemType === "event" && entity.deletedAt === null && entity.scheduledAt !== null)
    .filter(entity => entity.scheduledAt! < dayEnd && (entity.endAt ?? entity.scheduledAt!) >= dayStart)
    .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  const monthLabel = selectedDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const days = useMemo(() => {
    const count = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
    return Array.from({ length: count }, (_, i) => ({
      day: i + 1,
      weekday: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), i + 1).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1),
    }));
  }, [selectedDate]);

  useEffect(() => {
    let active = true;
    initializeLocalDatabase().then(async local => {
      if (!active) return;
      setDatabase(local);
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 31 * 24 * 60 * 60_000;
      const end = new Date(now.getFullYear(), now.getMonth() + 2, 1).getTime();
      let entities = await local.repository.queryRange(local.workspaceId, start, end);
      if (entities.length === 0) {
        const today = new Date(start);
        const dueTimes = [
          new Date(today.getTime() + 11 * 60 * 60_000 + 30 * 60_000).getTime(),
          new Date(today.getTime() + 14 * 60 * 60_000).getTime(),
          new Date(today.getTime() + 24 * 60 * 60_000 + 10 * 60 * 60_000).getTime(),
        ];
        const seed = INITIAL_TASKS.map((task, index) => ({
          ...makeTaskEntity({ id: task.id, title: task.title, dueAt: dueTimes[index] ?? null }),
          isCompleted: task.completed,
          updatedAt: Date.now(),
        }));
        for (const entity of seed) {
          const mutationId = `seed-${entity.id}`;
          await local.repository.upsert(entity, mutationId);
          useCalendarStore.getState().upsertEntity(entity, mutationId);
        }
        entities = await local.repository.queryRange(local.workspaceId, start, end);
      }
      if (!active) return;
      const pending = await local.repository.listPendingMutations();
      useCalendarStore.getState().hydrate(entities, pending);
      const persistedTasks = entities.filter(entity => entity.itemType === "task").map(entity => {
        const dueAt = entity.metadata?.task?.dueAt ?? entity.scheduledAt;
        const due = dueAt === null
          ? "Today · No time set"
: new Date(dueAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        return {
          id: entity.id,
          title: entity.title,
          due,
          assignee: entity.metadata?.task?.assignee?.name ?? "You",
          completed: entity.isCompleted,
        };
      });
      setTasks(persistedTasks);
    }).catch(error => {
      console.warn("Local calendar database initialization failed", error);
    });
    return () => { active = false; };
  }, []);

  const toggleTask = (id: string) => {
    const existing = tasks.find(task => task.id === id);
    if (!existing) return;
    const completed = !existing.completed;
    setTasks(current => current.map(task => task.id === id ? { ...task, completed } : task));
    if (database) {
      database.repository.getById(id).then(entity => {
        if (!entity) return;
        const updated = { ...entity, isCompleted: completed, updatedAt: Date.now(), syncVersion: entity.syncVersion + 1 };
        const mutationId = `task-toggle-${id}-${updated.syncVersion}`;
        return database.repository.upsert(updated, mutationId).then(() => {
          useCalendarStore.getState().upsertEntity(updated, mutationId);
        });
      }).catch(error => console.warn("Unable to persist task completion", error));
    }
  };

  const addQuickTask = () => {
    const id = `task-${Date.now()}`;
    setTasks(current => [{ id, title: "New task", due: "Today · No time set", assignee: "You", completed: false }, ...current]);
    if (database) {
      const entity = makeTaskEntity({ id, title: "New task", dueAt: null, workspaceId: database.workspaceId });
      const mutationId = `task-create-${id}`;
      database.repository.upsert(entity, mutationId).then(() => {
        useCalendarStore.getState().upsertEntity(entity, mutationId);
      }).catch(error => console.warn("Unable to persist new task", error));
    }
  };

  const openNewEvent = () => {
    setEditingEvent(null);
    setEventEditorVisible(true);
  };

  const saveEvent = (draft: EventDraft) => {
    const now = Date.now();
    const existing = editingEvent;
    const id = existing?.id ?? `event-${now}`;
    const entity: TemporalEntity = {
      id,
      workspaceId: database?.workspaceId ?? "workspace-personal",
      itemType: "event",
      title: draft.title,
      scheduledAt: draft.startAt,
      endAt: draft.endAt,
      isCompleted: false,
      priority: existing?.priority ?? "normal",
      isShielded: draft.isShielded,
      isElastic: draft.isElastic,
      isGhost: false,
      ghostClusterId: null,
      assignedUserIds: existing?.assignedUserIds ?? ["local-user"],
      rrule: existing?.rrule ?? null,
      syncVersion: (existing?.syncVersion ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      metadata: {
        ...existing?.metadata,
        event: {
          kind: existing?.metadata?.event?.kind ?? "standard",
          commitment: draft.isElastic ? "elastic" : "hard",
          location: draft.location,
          meetingUrl: existing?.metadata?.event?.meetingUrl ?? null,
          organizerUserId: existing?.metadata?.event?.organizerUserId ?? "local-user",
          attendeeUserIds: existing?.metadata?.event?.attendeeUserIds ?? [],
          travelBufferMinutes: existing?.metadata?.event?.travelBufferMinutes ?? null,
          cooldownBufferMinutes: existing?.metadata?.event?.cooldownBufferMinutes ?? null,
        },
      },
    };
    const mutationId = `event-upsert-${id}-${entity.syncVersion}`;
    useCalendarStore.getState().upsertEntity(entity, mutationId);
    setEventEditorVisible(false);
    setEditingEvent(null);
    if (database) {
      database.repository.upsert(entity, mutationId).catch(error => console.warn("Unable to persist event", error));
    }
  };

  const moveEvent = (event: TemporalEntity, nextStartAt: number, nextEndAt: number) => {
    const updated: TemporalEntity = {
      ...event,
      scheduledAt: nextStartAt,
      endAt: nextEndAt,
      updatedAt: Date.now(),
      syncVersion: event.syncVersion + 1,
    };
    const mutationId = `event-move-${event.id}-${updated.syncVersion}`;
    useCalendarStore.getState().upsertEntity(updated, mutationId);
    if (database) {
      database.repository.upsert(updated, mutationId).catch(error => console.warn("Unable to persist moved event", error));
    }
  };

  const deleteEvent = (event: TemporalEntity) => {
    const mutationId = `event-delete-${event.id}-${event.syncVersion + 1}`;
    setEventEditorVisible(false);
    setEditingEvent(null);
    if (database) {
      database.repository.softDelete(event.id, mutationId).then(tombstone => {
        if (tombstone) useCalendarStore.getState().deleteEntity(event.id, mutationId, event.workspaceId, "event");
      }).catch(error => console.warn("Unable to delete event", error));
    } else {
      useCalendarStore.getState().deleteEntity(event.id, mutationId, event.workspaceId, "event");
    }
  };

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
          <Text style={styles.subLabel}>{selectedDate.toLocaleDateString(undefined, { weekday: "long", day: "numeric" })}</Text>
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
            <Pressable key={day} onPress={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day))} style={[styles.dayItem, selectedDay === day && styles.dayItemActive]}>
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
          <Pressable onPress={openNewEvent} style={styles.addButton} accessibilityRole="button" accessibilityLabel="Create event"><Text style={styles.addGlyph}>＋</Text></Pressable>
        </View>

        {mode === "Day" ? (
          visibleEvents.length ? (
            <DayTimeline
              date={selectedDate}
              events={visibleEvents}
              onEventPress={event => {
                setEditingEvent(event);
                setEventEditorVisible(true);
              }}
              onEventMove={moveEvent}
            />
          ) : (
            <View style={styles.emptyEvents}>
              <Text style={styles.emptyEventsTitle}>Nothing scheduled yet</Text>
              <Text style={styles.sectionCaption}>Add an event to start shaping this day.</Text>
              <Pressable onPress={openNewEvent} style={styles.emptyAdd}><Text style={styles.emptyAddText}>＋ Create event</Text></Pressable>
            </View>
          )
        ) : (
          <CalendarOverview
            mode={mode}
            date={selectedDate}
            events={storedEntities.filter(entity => entity.itemType === "event" && entity.deletedAt === null)}
            onSelectDate={date => {
              setSelectedDate(date);
              if (mode === "Month") setMode("Day");
            }}
          />
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

      <EventEditor
        visible={eventEditorVisible}
        selectedDate={eventEditorDate}
        event={editingEvent}
        onClose={() => { setEventEditorVisible(false); setEditingEvent(null); }}
        onSave={saveEvent}
        onDelete={deleteEvent}
      />

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
  dayWeekdayActive: { color: "#72551C" },
  dayNumber: { color: COLORS.text, fontSize: 15, fontWeight: "700" },
  dayNumberActive: { color: COLORS.background },
  dayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.lavender },
  dayDotActive: { backgroundColor: COLORS.background },
  dayDotPlaceholder: { width: 4, height: 4 },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 28 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  sectionTitle: { color: COLORS.text, fontSize: 18, fontWeight: "700", letterSpacing: -0.4 },
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
  shieldPill: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: "#322817" },
  shieldText: { color: COLORS.accent, fontSize: 8, fontWeight: "800", letterSpacing: 0.7 },
  emptyEvents: { marginLeft: 10, padding: 18, borderRadius: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, gap: 7 },
  emptyEventsTitle: { color: COLORS.text, fontSize: 13, fontWeight: "700" },
  emptyAdd: { alignSelf: "flex-start", marginTop: 4, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 9, backgroundColor: COLORS.surfaceRaised },
  emptyAddText: { color: COLORS.accent, fontSize: 11, fontWeight: "700" },
  tasksSection: { marginTop: 28 },
  seeAll: { color: COLORS.accent, fontSize: 11, fontWeight: "700" },
  tasksCard: { backgroundColor: COLORS.surface, borderRadius: 17, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14 },
  taskRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  checkbox: { width: 21, height: 21, borderRadius: 7, borderWidth: 1.5, borderColor: "#475267", alignItems: "center", justifyContent: "center" },
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
