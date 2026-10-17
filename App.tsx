import "react-native-gesture-handler";
import React, { useEffect, useMemo, useState } from "react";
import {
  Linking,
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
import { expandRecurrence } from "./src/temporal/recurrence";
import { ReminderCenter } from "./src/components/ReminderCenter";
import { cancelNotificationIds, requestNotificationPermission, scheduleEventNotifications, scheduleReminderNotification } from "./src/notifications/notificationService";
import * as Notifications from "expo-notifications";

type ScreenMode = "Day" | "Week" | "Month";
type MainTab = "Calendar" | "Tasks" | "Reminders" | "Spaces";
type Task = { id: string; title: string; due: string; assignee: string; completed: boolean; dueAt?: number | null; hasReminder?: boolean };


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
  success: "#72D6A1",
  accentWash: "#322817",
};

const SHADOWS = {
  card: { shadowColor: "#000000", shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.24, shadowRadius: 14, elevation: 5 },
  floating: { shadowColor: "#FFC247", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 4 },
};

const INITIAL_TASKS: Task[] = [
  { id: "t1", title: "Review onboarding flow", due: "Today · 11:30 AM", assignee: "You", completed: false },
  { id: "t2", title: "Send campaign brief", due: "Today · 2:00 PM", assignee: "AK", completed: false },
  { id: "t3", title: "Update sprint notes", due: "Tomorrow", assignee: "You", completed: true },
];

function TaskRow({ task, onToggle, onRemind }: { task: Task; onToggle: () => void; onRemind: () => void }) {
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
      <Pressable disabled={task.dueAt == null} onPress={onRemind} accessibilityRole="button" accessibilityLabel={task.hasReminder ? "Turn off task reminder" : "Set task reminder"} style={[styles.taskReminderButton, task.dueAt == null && styles.taskReminderDisabled]}><Text style={[styles.taskReminderGlyph, task.hasReminder && styles.taskReminderActive]}>{task.hasReminder ? "◉" : "◷"}</Text></Pressable>
      <View style={styles.avatar}><Text style={styles.avatarText}>{task.assignee === "You" ? "DR" : task.assignee}</Text></View>
    </Animated.View>
  );
}

function EventCard({ event, index, onPress }: { event: TemporalEntity; index: number; onPress: () => void }) {
  const start = event.scheduledAt === null ? null : new Date(event.scheduledAt);
  const end = event.endAt === null ? null : new Date(event.endAt);
  const color = event.isShielded ? COLORS.accent : event.isElastic ? COLORS.coral : COLORS.lavender;
  const isAllDay = event.metadata?.event?.kind === "all-day";
  const timeLabel = isAllDay
    ? "ALL DAY"
    : start
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
  const [activeTab, setActiveTab] = useState<MainTab>("Calendar");
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const selectedDay = selectedDate.getDate();
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [database, setDatabase] = useState<LocalCalendarDatabase | null>(null);
  const [eventEditorVisible, setEventEditorVisible] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TemporalEntity | null>(null);
  const pendingCount = useCalendarStore(state => state.pendingMutations.length);
  const storedEntities = useCalendarStore(state => Object.values(state.entitiesById));

  const eventEditorDate = useMemo(
    () => editingOccurrenceStartAt !== null
      ? new Date(editingEvent?.metadata?.recurrence?.overrides[String(editingOccurrenceStartAt)]?.startAt ?? editingOccurrenceStartAt)
      : editingEvent?.scheduledAt !== null && editingEvent?.scheduledAt !== undefined
        ? new Date(editingEvent.scheduledAt)
        : selectedDate,
    [editingEvent, editingOccurrenceStartAt, selectedDate],
  );
  const dayStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()).getTime();
  const dayEnd = dayStart + 24 * 60 * 60_000;
  const reminders = storedEntities.filter(entity => entity.itemType === "reminder" && entity.deletedAt === null);
  const eventSeries = storedEntities.filter(
    entity => entity.itemType === "event" && entity.deletedAt === null && entity.scheduledAt !== null,
  );

  const expandVisibleEvents = (rangeStart: number, rangeEnd: number): TemporalEntity[] => {
    const expanded: TemporalEntity[] = [];
    for (const entity of eventSeries) {
      try {
        const occurrences = expandRecurrence(entity, { rangeStart, rangeEnd, maxOccurrences: 500 });
        const expandedOriginalStarts = new Set(occurrences.map(occurrence => String(occurrence.startAt)));
        for (const occurrence of occurrences) {
          const exceptions = entity.metadata?.recurrence;
          if (exceptions?.excludedStartsAt.includes(occurrence.startAt)) continue;
          const override = exceptions?.overrides[String(occurrence.startAt)];
          const visibleStartAt = override?.startAt ?? occurrence.startAt;
          const visibleEndAt = override?.endAt ?? occurrence.endAt;
          if (visibleStartAt >= rangeEnd || (visibleEndAt ?? visibleStartAt) < rangeStart) continue;
          expanded.push({
            ...entity,
            id: entity.rrule ? entity.id + "::" + occurrence.startAt : entity.id,
            title: override?.title ?? entity.title,
            scheduledAt: visibleStartAt,
            endAt: visibleEndAt,
            isShielded: override?.isShielded ?? entity.isShielded,
            isElastic: override?.isElastic ?? entity.isElastic,
            metadata: {
              ...entity.metadata,
              event: {
                ...entity.metadata?.event,
                kind: override?.isAllDay ? "all-day" : entity.metadata?.event?.kind ?? "standard",
                commitment: entity.metadata?.event?.commitment ?? (entity.isElastic ? "elastic" : "hard"),
                location: override?.location ?? entity.metadata?.event?.location ?? null,
                meetingUrl: entity.metadata?.event?.meetingUrl ?? null,
                organizerUserId: entity.metadata?.event?.organizerUserId ?? null,
                attendeeUserIds: entity.metadata?.event?.attendeeUserIds ?? [],
                travelBufferMinutes: entity.metadata?.event?.travelBufferMinutes ?? null,
                cooldownBufferMinutes: entity.metadata?.event?.cooldownBufferMinutes ?? null,
              },
              recurrenceOccurrence: { seriesId: entity.id, startAt: occurrence.startAt, isRecurring: occurrence.isRecurring },
            },
          });
        }
        // Render moved overrides even when their original RRULE date is outside this visible range.
        for (const [originalStartKey, override] of Object.entries(entity.metadata?.recurrence?.overrides ?? {})) {
          if (expandedOriginalStarts.has(originalStartKey)) continue;
          if (override.startAt >= rangeEnd || (override.endAt ?? override.startAt) < rangeStart) continue;
          expanded.push({
            ...entity,
            id: entity.id + "::" + originalStartKey,
            title: override.title,
            scheduledAt: override.startAt,
            endAt: override.endAt,
            isShielded: override.isShielded,
            isElastic: override.isElastic,
            metadata: {
              ...entity.metadata,
              event: {
                ...entity.metadata?.event,
                kind: entity.metadata?.event?.kind ?? "standard",
                commitment: entity.metadata?.event?.commitment ?? (override.isElastic ? "elastic" : "hard"),
                location: override.location,
                meetingUrl: entity.metadata?.event?.meetingUrl ?? null,
                organizerUserId: entity.metadata?.event?.organizerUserId ?? null,
                attendeeUserIds: entity.metadata?.event?.attendeeUserIds ?? [],
                travelBufferMinutes: entity.metadata?.event?.travelBufferMinutes ?? null,
                cooldownBufferMinutes: entity.metadata?.event?.cooldownBufferMinutes ?? null,
              },
              recurrenceOccurrence: { seriesId: entity.id, startAt: Number(originalStartKey), isRecurring: true },
            },
          });
        }
      } catch (error) {
        console.warn(`Unable to expand recurrence for event ${entity.id}`, error);
      }
    }
    return expanded.sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  };

  const visibleEvents = expandVisibleEvents(dayStart, dayEnd);
  const monthLabel = selectedDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const shiftCalendarMonth = (amount: number) => {
    setSelectedDate(current => {
      const next = new Date(current);
      const originalDay = current.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + amount);
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(originalDay, lastDay));
      return next;
    });
  };

  const jumpToToday = () => setSelectedDate(new Date());

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
          dueAt,
          hasReminder: entity.metadata?.task?.reminderMinutesBefore != null,
        };
      });
      setTasks(persistedTasks);
      const permission = await Notifications.getPermissionsAsync();
      setPermissionGranted(permission.granted);
      if (permission.granted) {
        for (const entity of entities) {
          if (entity.deletedAt !== null) continue;
          if (entity.itemType === "reminder" && !entity.isCompleted && entity.metadata?.reminder) {
            const meta = entity.metadata.reminder;
            const at = meta.snoozeUntil ?? (meta.trigger.kind === "time" ? meta.trigger.at : null);
            if (at && at > Date.now()) {
              await cancelNotificationIds(meta.notificationId ? [meta.notificationId] : []);
              const notificationId = await scheduleReminderNotification(entity, at);
              const updated = { ...entity, metadata: { ...entity.metadata, reminder: { ...meta, notificationId } } };
              const mutationId = "reminder-reschedule-" + entity.id + "-" + Date.now();
              await local.repository.upsert(updated, mutationId);
              useCalendarStore.getState().upsertEntity(updated, mutationId);
            }
          } else if (entity.itemType === "task" && !entity.isCompleted && entity.metadata?.task?.reminderMinutesBefore != null) {
            const taskMeta = entity.metadata.task;
            const dueAt = taskMeta.dueAt ?? entity.scheduledAt;
            if (dueAt != null) {
              const offset = taskMeta.reminderMinutesBefore ?? 15;
              const at = dueAt - offset * 60_000 > Date.now() ? dueAt - offset * 60_000 : dueAt;
              if (at > Date.now()) {
                await cancelNotificationIds(taskMeta.notificationId ? [taskMeta.notificationId] : []);
                const notificationId = await scheduleReminderNotification(entity, at);
                const updated = { ...entity, metadata: { ...entity.metadata, task: { ...taskMeta, notificationId } } };
                const mutationId = "task-reminder-reschedule-" + entity.id + "-" + Date.now();
                await local.repository.upsert(updated, mutationId);
                useCalendarStore.getState().upsertEntity(updated, mutationId);
              }
            }
          } else if (entity.itemType === "event" && entity.metadata?.event?.reminderMinutesBefore != null) {
            const notificationIds = await scheduleEventNotifications(entity);
            const updated = { ...entity, metadata: { ...entity.metadata, event: { ...entity.metadata.event, notificationIds } } };
            const mutationId = "event-notification-reschedule-" + entity.id + "-" + Date.now();
            await local.repository.upsert(updated, mutationId);
            useCalendarStore.getState().upsertEntity(updated, mutationId);
          }
        }
      }
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
        const taskMeta = entity.metadata?.task;
        if (completed) void cancelNotificationIds(taskMeta?.notificationId ? [taskMeta.notificationId] : []);
        const updated = { ...entity, isCompleted: completed, updatedAt: Date.now(), syncVersion: entity.syncVersion + 1, metadata: { ...entity.metadata, task: taskMeta ? { ...taskMeta, notificationId: completed ? null : taskMeta.notificationId } : undefined } };
        const mutationId = `task-toggle-${id}-${updated.syncVersion}`;
        return database.repository.upsert(updated, mutationId).then(async () => {
          useCalendarStore.getState().upsertEntity(updated, mutationId);
          if (!completed && taskMeta?.reminderMinutesBefore != null && (taskMeta.dueAt ?? updated.scheduledAt) != null && permissionGranted) {
            const dueAt = taskMeta.dueAt ?? updated.scheduledAt!;
            const notifyAt = dueAt - taskMeta.reminderMinutesBefore * 60_000 > Date.now() ? dueAt - taskMeta.reminderMinutesBefore * 60_000 : dueAt;
            const notificationId = await scheduleReminderNotification(updated, notifyAt);
            const rescheduled = { ...updated, syncVersion: updated.syncVersion + 1, updatedAt: Date.now(), metadata: { ...updated.metadata, task: { ...taskMeta, notificationId } } };
            await persistReminderUpdate(rescheduled, "task-reminder-reschedule-" + id + "-" + rescheduled.syncVersion);
          }
        });
      }).catch(error => console.warn("Unable to persist task completion", error));
    }
  };

  const toggleTaskReminder = async (id: string) => {
    if (!database) return;
    const entity = await database.repository.getById(id);
    if (!entity || entity.itemType !== "task") return;
    const current = entity.metadata?.task;
    const dueAt = current?.dueAt ?? entity.scheduledAt;
    if (dueAt == null) return;
    if (current?.reminderMinutesBefore != null) {
      await cancelNotificationIds(current.notificationId ? [current.notificationId] : []);
      const updated = { ...entity, syncVersion: entity.syncVersion + 1, updatedAt: Date.now(), metadata: { ...entity.metadata, task: { ...current, reminderMinutesBefore: null, notificationId: null } } };
      await persistReminderUpdate(updated, "task-reminder-off-" + id + "-" + updated.syncVersion);
      setTasks(currentTasks => currentTasks.map(task => task.id === id ? { ...task, hasReminder: false } : task));
      return;
    }
    const granted = permissionGranted === true || await requestNotificationPermission();
    setPermissionGranted(granted);
    if (!granted) return;
    const notifyAt = dueAt - 15 * 60_000 > Date.now() ? dueAt - 15 * 60_000 : dueAt;
    if (notifyAt <= Date.now()) return;
    const notificationId = await scheduleReminderNotification(entity, notifyAt);
    const updated = { ...entity, syncVersion: entity.syncVersion + 1, updatedAt: Date.now(), metadata: { ...entity.metadata, task: { ...current, dueAt, assignee: current?.assignee ?? { id: "local-user", name: "You", avatarUrl: null }, reminderMinutesBefore: 15, notificationId } } };
    await persistReminderUpdate(updated, "task-reminder-on-" + id + "-" + updated.syncVersion);
    setTasks(currentTasks => currentTasks.map(task => task.id === id ? { ...task, hasReminder: true } : task));
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
    setEditingOccurrenceStartAt(null);
    setEventEditorVisible(true);
  };

  const persistReminderUpdate = async (entity: TemporalEntity, mutationId: string) => {
    useCalendarStore.getState().upsertEntity(entity, mutationId);
    if (database) await database.repository.upsert(entity, mutationId);
  };

  const handleRequestNotifications = async () => {
    const granted = await requestNotificationPermission();
    setPermissionGranted(granted);
    if (!granted) { await Linking.openSettings(); return; }
    if (!database) return;
    const all = await database.repository.queryRange(database.workspaceId, 0, 4102444800000);
    for (const entity of all) {
      if (entity.deletedAt !== null) continue;
      if (entity.itemType === "reminder" && !entity.isCompleted && entity.metadata?.reminder) {
        const meta = entity.metadata.reminder;
        const at = meta.snoozeUntil ?? (meta.trigger.kind === "time" ? meta.trigger.at : null);
        if (at && at > Date.now()) {
          await cancelNotificationIds(meta.notificationId ? [meta.notificationId] : []);
          const notificationId = await scheduleReminderNotification(entity, at);
          const updated = { ...entity, syncVersion: entity.syncVersion + 1, updatedAt: Date.now(), metadata: { ...entity.metadata, reminder: { ...meta, notificationId } } };
          await persistReminderUpdate(updated, "reminder-permission-" + entity.id + "-" + updated.syncVersion);
        }
      } else if (entity.itemType === "event" && entity.metadata?.event?.reminderMinutesBefore != null) {
        const notificationIds = await scheduleEventNotifications(entity);
        const updated = { ...entity, syncVersion: entity.syncVersion + 1, updatedAt: Date.now(), metadata: { ...entity.metadata, event: { ...entity.metadata.event, notificationIds } } };
        await persistReminderUpdate(updated, "event-permission-" + entity.id + "-" + updated.syncVersion);
      }
    }
  };

  const createReminder = async (title: string, at: number) => {
    if (!database) return;
    const now = Date.now();
    const id = "reminder-" + now + "-" + Math.random().toString(36).slice(2, 7);
    const entity: TemporalEntity = {
      id, workspaceId: database.workspaceId, itemType: "reminder", title, scheduledAt: at, endAt: null,
      isCompleted: false, priority: "normal", isShielded: false, isElastic: false, isGhost: false, ghostClusterId: null,
      assignedUserIds: ["local-user"], rrule: null, syncVersion: 1, createdAt: now, updatedAt: now, deletedAt: null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      metadata: { reminder: { trigger: { kind: "time", at }, snoozeUntil: null, snoozeCount: 0, notificationId: null } },
    };
    const granted = permissionGranted === true || await requestNotificationPermission();
    setPermissionGranted(granted);
    const notificationId = granted ? await scheduleReminderNotification(entity, at) : null;
    const saved = { ...entity, metadata: { ...entity.metadata, reminder: { ...entity.metadata!.reminder!, notificationId } } };
    await persistReminderUpdate(saved, "reminder-create-" + id);
  };

  const snoozeReminder = async (reminder: TemporalEntity, minutes: number) => {
    const current = reminder.metadata?.reminder;
    if (!current) return;
    await cancelNotificationIds(current.notificationId ? [current.notificationId] : []);
    const snoozeUntil = Date.now() + minutes * 60_000;
    const base = { ...reminder, updatedAt: Date.now(), syncVersion: reminder.syncVersion + 1, isCompleted: false };
    const notificationId = permissionGranted ? await scheduleReminderNotification(base, snoozeUntil) : null;
    const updated = { ...base, metadata: { ...base.metadata, reminder: { ...current, snoozeUntil, snoozeCount: current.snoozeCount + 1, notificationId } } };
    await persistReminderUpdate(updated, "reminder-snooze-" + reminder.id + "-" + updated.syncVersion);
  };

  const completeReminder = async (reminder: TemporalEntity) => {
    await cancelNotificationIds(reminder.metadata?.reminder?.notificationId ? [reminder.metadata.reminder.notificationId] : []);
    const current = reminder.metadata?.reminder;
    const updated = { ...reminder, isCompleted: true, updatedAt: Date.now(), syncVersion: reminder.syncVersion + 1, metadata: { ...reminder.metadata, reminder: current ? { ...current, notificationId: null } : undefined } };
    await persistReminderUpdate(updated, "reminder-complete-" + reminder.id + "-" + updated.syncVersion);
  };

  const deleteReminder = async (reminder: TemporalEntity) => {
    await cancelNotificationIds(reminder.metadata?.reminder?.notificationId ? [reminder.metadata.reminder.notificationId] : []);
    if (!database) return;
    const mutationId = "reminder-delete-" + reminder.id + "-" + (reminder.syncVersion + 1);
    const tombstone = await database.repository.softDelete(reminder.id, mutationId);
    if (tombstone) useCalendarStore.getState().deleteEntity(reminder.id, mutationId, reminder.workspaceId, "reminder");
  };
  const saveEvent = (draft: EventDraft) => {
    const now = Date.now();
    const existing = editingEvent;
    if (existing && draft.scope === "occurrence" && draft.occurrenceStartAt !== null) {
      const occurrenceKey = String(draft.occurrenceStartAt);
      const current = existing.metadata?.recurrence ?? { excludedStartsAt: [], overrides: {} };
      const entity: TemporalEntity = {
        ...existing, updatedAt: now, syncVersion: existing.syncVersion + 1,
        metadata: { ...existing.metadata, recurrence: {
          ...current,
          excludedStartsAt: current.excludedStartsAt.filter(startAt => startAt !== draft.occurrenceStartAt),
          overrides: { ...current.overrides, [occurrenceKey]: { startAt: draft.startAt, endAt: draft.endAt, title: draft.title, location: draft.location, isShielded: draft.isShielded, isElastic: draft.isElastic, isAllDay: draft.isAllDay } },
        } },
      };
      const mutationId = "event-occurrence-upsert-" + existing.id + "-" + draft.occurrenceStartAt + "-" + entity.syncVersion;
      useCalendarStore.getState().upsertEntity(entity, mutationId);
      setEventEditorVisible(false); setEditingEvent(null); setEditingOccurrenceStartAt(null);
      if (database) database.repository.upsert(entity, mutationId).catch(error => console.warn("Unable to persist event occurrence", error));
      return;
    }
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
      rrule: draft.rrule,
      syncVersion: (existing?.syncVersion ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      metadata: {
        ...existing?.metadata,
        // Occurrence exception keys are anchored to generated start timestamps.
        // If the series schedule changes, discard exceptions tied to the old schedule.
        ...((existing && (
          existing.rrule !== draft.rrule ||
          existing.scheduledAt !== draft.startAt
        )) ? { recurrence: undefined } : {}),
        event: {
          kind: draft.isAllDay ? "all-day" : "standard",
          commitment: draft.isElastic ? "elastic" : "hard",
          location: draft.location,
          meetingUrl: existing?.metadata?.event?.meetingUrl ?? null,
          organizerUserId: existing?.metadata?.event?.organizerUserId ?? "local-user",
          attendeeUserIds: existing?.metadata?.event?.attendeeUserIds ?? [],
          travelBufferMinutes: existing?.metadata?.event?.travelBufferMinutes ?? null,
          cooldownBufferMinutes: existing?.metadata?.event?.cooldownBufferMinutes ?? null,
          reminderMinutesBefore: draft.reminderMinutesBefore,
          notificationIds: existing?.metadata?.event?.notificationIds ?? [],
        },
      },
    };
    const mutationId = `event-upsert-${id}-${entity.syncVersion}`;
    useCalendarStore.getState().upsertEntity(entity, mutationId);
    setEventEditorVisible(false);
    setEditingEvent(null);
    setEditingOccurrenceStartAt(null);
    if (database) {
      database.repository.upsert(entity, mutationId).catch(error => console.warn("Unable to persist event", error));
    }
    if (draft.scope !== "occurrence") {
      if (draft.reminderMinutesBefore === null) {
        void cancelNotificationIds(existing?.metadata?.event?.notificationIds);
      } else {
        requestNotificationPermission().then(granted => {
          setPermissionGranted(granted);
          if (!granted) return;
          return scheduleEventNotifications(entity).then(async notificationIds => {
            const updated = { ...entity, syncVersion: entity.syncVersion + 1, updatedAt: Date.now(), metadata: { ...entity.metadata, event: { ...entity.metadata?.event!, notificationIds } } };
            await persistReminderUpdate(updated, "event-reminder-schedule-" + entity.id + "-" + updated.syncVersion);
          });
        }).catch(error => console.warn("Unable to schedule event reminders", error));
      }
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
    setSelectedDate(new Date(nextStartAt));
    useCalendarStore.getState().upsertEntity(updated, mutationId);
    if (database) {
      database.repository.upsert(updated, mutationId).catch(error => console.warn("Unable to persist moved event", error));
    }
    if (permissionGranted && updated.metadata?.event?.reminderMinutesBefore != null) {
      scheduleEventNotifications(updated).then(async notificationIds => {
        const withNotifications = { ...updated, syncVersion: updated.syncVersion + 1, updatedAt: Date.now(), metadata: { ...updated.metadata, event: { ...updated.metadata?.event!, notificationIds } } };
        await persistReminderUpdate(withNotifications, "event-reminder-move-" + event.id + "-" + withNotifications.syncVersion);
      }).catch(error => console.warn("Unable to reschedule moved event reminder", error));
    }
  };

  const deleteEvent = (event: TemporalEntity, scope: "occurrence" | "series" = "series", occurrenceStartAt: number | null = null) => {
    if (scope === "occurrence" && occurrenceStartAt !== null) {
      const current = event.metadata?.recurrence ?? { excludedStartsAt: [], overrides: {} };
      const updated: TemporalEntity = {
        ...event,
        updatedAt: Date.now(),
        syncVersion: event.syncVersion + 1,
        metadata: {
          ...event.metadata,
          recurrence: {
            ...current,
            excludedStartsAt: Array.from(new Set([...current.excludedStartsAt, occurrenceStartAt])),
            overrides: Object.fromEntries(Object.entries(current.overrides).filter(([key]) => key !== String(occurrenceStartAt))),
          },
        },
      };
      const mutationId = "event-occurrence-delete-" + event.id + "-" + occurrenceStartAt + "-" + updated.syncVersion;
      useCalendarStore.getState().upsertEntity(updated, mutationId);
      setEventEditorVisible(false);
      setEditingEvent(null);
      setEditingOccurrenceStartAt(null);
      if (database) database.repository.upsert(updated, mutationId).catch(error => console.warn("Unable to persist occurrence deletion", error));
      return;
    }
    void cancelNotificationIds(event.metadata?.event?.notificationIds);
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
          <Text style={styles.eyebrow}>YOUR SPACE  ·  PLAN WITH INTENTION</Text>
          <Text style={styles.brand}>Calender<Text style={styles.brandDot}>.</Text></Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="Search" style={styles.iconButton}><Text style={styles.iconGlyph}>⌕</Text></Pressable>
          <Pressable accessibilityLabel="Profile" style={styles.profileButton}><Text style={styles.profileText}>DR</Text></Pressable>
        </View>
      </View>

      {activeTab === "Calendar" ? <>
      <View style={styles.modeBar}>
        <View style={styles.dateHeading}>
          <View>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <Text style={styles.subLabel}>{selectedDate.toLocaleDateString(undefined, { weekday: "long", day: "numeric" })}</Text>
          </View>
          <View style={styles.monthControls}>
            <Pressable
              onPress={() => shiftCalendarMonth(-1)}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              style={styles.monthArrow}
            >
              <Text style={styles.monthArrowGlyph}>‹</Text>
            </Pressable>
            <Pressable
              onPress={jumpToToday}
              accessibilityRole="button"
              accessibilityLabel="Go to today"
              style={styles.todayButton}
            >
              <Text style={styles.todayButtonText}>Today</Text>
            </Pressable>
            <Pressable
              onPress={() => shiftCalendarMonth(1)}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              style={styles.monthArrow}
            >
              <Text style={styles.monthArrowGlyph}>›</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.modeSwitch}>
          {(["Day", "Week", "Month"] as ScreenMode[]).map(item => (
            <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: mode === item }} onPress={() => setMode(item)} style={({ pressed }) => [styles.modeOption, mode === item && styles.modeOptionActive, pressed && styles.pressedControl]}>
              <Text style={[styles.modeText, mode === item && styles.modeTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.weekStrip}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysContent}>
          {days.map(({ day, weekday }) => (
            <Pressable key={day} accessibilityRole="button" accessibilityState={{ selected: selectedDay === day }} onPress={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day))} style={({ pressed }) => [styles.dayItem, selectedDay === day && styles.dayItemActive, pressed && styles.pressedControl]}>
              <Text style={[styles.dayWeekday, selectedDay === day && styles.dayWeekdayActive]}>{weekday}</Text>
              <Text style={[styles.dayNumber, selectedDay === day && styles.dayNumberActive]}>{day}</Text>
              {[5, 9, 14, 18, 23, 27].includes(day) ? <View style={[styles.dayDot, selectedDay === day && styles.dayDotActive]} /> : <View style={styles.dayDotPlaceholder} />}
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionHeading}>
          <View><Text style={styles.sectionTitle}>{mode === "Day" ? "Today’s agenda" : `${mode} overview`}</Text><Text style={styles.sectionCaption}><Text style={styles.captionItalic}>A little structure,</Text> a lot more space.</Text></View>
          <Pressable onPress={openNewEvent} style={({ pressed }) => [styles.addButton, SHADOWS.floating, pressed && styles.pressedControl]} accessibilityRole="button" accessibilityLabel="Create event"><Text style={styles.addGlyph}>＋</Text></Pressable>
        </View>

        {mode === "Day" ? (
          visibleEvents.length ? (
            <DayTimeline
              date={selectedDate}
              events={visibleEvents}
              onEventPress={event => {
                // Occurrence-level editing is not supported yet. Resolve the source entity so
                // tapping an instance opens the series without shifting its DTSTART.
                const seriesId = event.metadata?.recurrenceOccurrence?.seriesId ?? event.id;
                const sourceEvent = eventSeries.find(item => item.id === seriesId) ?? event;
                setEditingOccurrenceStartAt(event.metadata?.recurrenceOccurrence?.startAt ?? null);
                setEditingEvent(sourceEvent);
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
            events={expandVisibleEvents(
              new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1).getTime() - 7 * 86400000,
              new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1).getTime() + 7 * 86400000,
            )}
            onSelectDate={date => {
              setSelectedDate(date);
              if (mode === "Month") setMode("Day");
            }}
          />
        )}

        <View style={styles.tasksSection}>
          <View style={styles.sectionHeading}>
            <View><Text style={styles.sectionTitle}>In the loop</Text><Text style={styles.sectionCaption}><Text style={styles.attentionCount}>{tasks.filter(task => !task.completed).length}</Text> tasks need your attention</Text></View>
            <Pressable onPress={addQuickTask}><Text style={styles.seeAll}>＋ Add</Text></Pressable>
          </View>
          <View style={[styles.tasksCard, SHADOWS.card]}>
            {tasks.map(task => <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task.id)} onRemind={() => toggleTaskReminder(task.id)} />)}
          </View>
        </View>
        <View style={styles.syncNote}><View style={styles.syncDot} /><Text style={styles.syncText}>{pendingCount ? `${pendingCount} changes waiting to sync` : "Offline-first · Ready when you are"}</Text></View>
      </ScrollView></> : activeTab === "Reminders" ? <ReminderCenter reminders={reminders} permissionGranted={permissionGranted} onRequestPermission={handleRequestNotifications} onCreate={createReminder} onSnooze={snoozeReminder} onComplete={completeReminder} onDelete={deleteReminder} /> : <View style={styles.placeholderScreen}><Text style={styles.placeholderTitle}>{activeTab}</Text><Text style={styles.placeholderText}>{activeTab === "Tasks" ? "Task workspace is queued for the next phase." : "Shared spaces will be available in a later phase."}</Text></View>}

      <EventEditor
        visible={activeTab === "Calendar" && eventEditorVisible}
        selectedDate={eventEditorDate}
        event={editingEvent}
        occurrenceStartAt={editingOccurrenceStartAt}
        onClose={() => { setEventEditorVisible(false); setEditingEvent(null); setEditingOccurrenceStartAt(null); }}
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
          <Pressable key={item.label} onPress={() => setActiveTab(item.label as MainTab)} accessibilityRole="button" accessibilityState={{ selected: activeTab === item.label }} style={styles.navItem}>
            <Text style={[styles.navGlyph, activeTab === item.label && styles.navGlyphActive]}>{item.glyph}</Text>
            <Text style={[styles.navLabel, activeTab === item.label && styles.navLabelActive]}>{item.label}</Text>
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
  iconButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center", ...SHADOWS.card },
  iconGlyph: { color: COLORS.text, fontSize: 28, lineHeight: 30 },
  profileButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center", ...SHADOWS.floating },
  profileText: { color: COLORS.background, fontSize: 12, fontWeight: "900" },
  modeBar: { paddingHorizontal: 24, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 10 },
  dateHeading: { flex: 1, gap: 9 },
  monthControls: { flexDirection: "row", alignItems: "center", gap: 6 },
  monthArrow: { width: 29, height: 29, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  monthArrowGlyph: { color: COLORS.text, fontSize: 22, lineHeight: 24, marginTop: -2 },
  todayButton: { paddingHorizontal: 10, height: 29, borderRadius: 9, justifyContent: "center", backgroundColor: "#322817", borderWidth: 1, borderColor: "#72551C" },
  todayButtonText: { color: COLORS.accent, fontSize: 10, fontWeight: "800" },
  monthLabel: { color: COLORS.text, fontSize: 18, fontWeight: "700" },
  subLabel: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  modeSwitch: { flexDirection: "row", padding: 4, backgroundColor: COLORS.surface, borderRadius: 13, borderWidth: 1, borderColor: COLORS.border },
  modeOption: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9 },
  modeOptionActive: { backgroundColor: COLORS.accentWash, borderWidth: 1, borderColor: "#72551C" },
  pressedControl: { opacity: 0.82, transform: [{ scale: 0.97 }] },
  modeText: { color: COLORS.muted, fontSize: 11, fontWeight: "600" },
  modeTextActive: { color: COLORS.text },
  weekStrip: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.border, paddingVertical: 12 },
  daysContent: { paddingHorizontal: 17, gap: 7 },
  dayItem: { width: 42, height: 66, alignItems: "center", justifyContent: "center", borderRadius: 14, gap: 5 },
  dayItemActive: { backgroundColor: COLORS.accent, ...SHADOWS.floating },
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
  sectionCaption: { color: COLORS.muted, fontSize: 11, marginTop: 5, lineHeight: 16 },
  captionItalic: { fontStyle: "italic", color: "#B7C0CF" },
  attentionCount: { color: COLORS.accent, fontWeight: "800" },
  addButton: { height: 42, width: 42, borderRadius: 15, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#FFE09A" },
  addGlyph: { color: COLORS.background, fontSize: 25, fontWeight: "400", marginTop: -2 },
  timeline: { flexDirection: "row", gap: 13 },
  timeRail: { width: 43, justifyContent: "space-between", paddingTop: 3, paddingBottom: 5 },
  timeLabel: { color: COLORS.muted, fontSize: 9, fontWeight: "600", height: 55 },
  eventsColumn: { flex: 1, gap: 9, paddingBottom: 4 },
  timelineLine: { position: "absolute", left: 0, top: 0, bottom: 0, width: 1, backgroundColor: COLORS.border },
  eventCard: { marginLeft: 10, borderLeftWidth: 3, borderRadius: 15, backgroundColor: COLORS.surface, paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderTopColor: COLORS.border, borderRightColor: COLORS.border, borderBottomColor: COLORS.border, ...SHADOWS.card },
  eventTopLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eventTime: { color: COLORS.muted, fontSize: 10, fontWeight: "600" },
  eventTitle: { color: COLORS.text, fontSize: 13, fontWeight: "700", marginTop: 8 },
  eventSubtitle: { color: COLORS.muted, fontSize: 10, marginTop: 4 },
  shieldPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: COLORS.accentWash, borderWidth: 1, borderColor: "#72551C" },
  shieldText: { color: COLORS.accent, fontSize: 8, fontWeight: "800", letterSpacing: 0.7 },
  emptyEvents: { marginLeft: 10, padding: 20, borderRadius: 17, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderStyle: "dashed", gap: 8, ...SHADOWS.card },
  emptyEventsTitle: { color: COLORS.text, fontSize: 13, fontWeight: "700" },
  emptyAdd: { alignSelf: "flex-start", marginTop: 4, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 9, backgroundColor: COLORS.surfaceRaised },
  emptyAddText: { color: COLORS.accent, fontSize: 11, fontWeight: "700" },
  tasksSection: { marginTop: 28 },
  seeAll: { color: COLORS.accent, fontSize: 11, fontWeight: "700" },
  tasksCard: { backgroundColor: COLORS.surface, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, overflow: "hidden" },
  taskRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  checkbox: { width: 21, height: 21, borderRadius: 7, borderWidth: 1.5, borderColor: "#475267", alignItems: "center", justifyContent: "center" },
  checkboxDone: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  checkGlyph: { color: COLORS.background, fontSize: 13, fontWeight: "900" },
  taskCopy: { flex: 1, gap: 5 },
  taskTitle: { color: COLORS.text, fontSize: 12, fontWeight: "600" },
  completedText: { color: COLORS.muted, textDecorationLine: "line-through" },
  taskDue: { color: COLORS.muted, fontSize: 10 },
  taskReminderButton: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border },
  taskReminderDisabled: { opacity: 0.3 },
  taskReminderGlyph: { color: COLORS.muted, fontSize: 15 },
  taskReminderActive: { color: COLORS.accent },
  avatar: { width: 28, height: 28, borderRadius: 10, backgroundColor: COLORS.surfaceRaised, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border },
  avatarText: { color: COLORS.text, fontSize: 9, fontWeight: "800" },
  syncNote: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 22, marginBottom: 5 },
  syncDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.success },
  syncText: { color: COLORS.muted, fontSize: 10 },
  bottomNav: { flexDirection: "row", paddingTop: 11, paddingBottom: 7, backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.border, justifyContent: "space-around" },
  navItem: { alignItems: "center", gap: 5, minWidth: 55 },
  navGlyph: { color: COLORS.muted, fontSize: 19, height: 23 },
  navGlyphActive: { color: COLORS.accent },
  navLabel: { color: COLORS.muted, fontSize: 9, fontWeight: "600" },
  navLabelActive: { color: COLORS.accent },
  placeholderScreen: { flex: 1, padding: 24, justifyContent: "center", gap: 10 },
  placeholderTitle: { color: COLORS.text, fontSize: 24, fontWeight: "800" },
  placeholderText: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
  monthPlaceholder: { padding: 24, borderRadius: 16, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  monthPlaceholderTitle: { color: COLORS.text, fontSize: 15, fontWeight: "700", marginBottom: 8 },
});
