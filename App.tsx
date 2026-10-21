import "react-native-gesture-handler";
import React, { useEffect, useMemo, useState } from "react";
import {
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useCalendarStore } from "./src/store/calendarStore";
import { useShallow } from "zustand/react/shallow";
import { DEFAULT_WORKSPACE_ID, initializeLocalDatabase, makeTaskEntity, type LocalCalendarDatabase } from "./src/persistence/localDatabase";
import { EventEditor, type EventDraft } from "./src/components/EventEditor";
import { DayTimeline } from "./src/components/DayTimeline";
import { CalendarOverview } from "./src/components/CalendarOverview";
import type { TemporalEntity } from "./src/temporal/types";
import { expandRecurrence } from "./src/temporal/recurrence";
import { ReminderCenter } from "./src/components/ReminderCenter";
import { TaskCenter, type TaskDraft } from "./src/components/TaskCenter";
import { AccountCenter } from "./src/components/AccountCenter";
import { SharingCenter } from "./src/components/SharingCenter";
import { NativeExperienceCenter } from "./src/components/NativeExperienceCenter";
import { publishNativeWidgetSnapshot } from "./src/native/nativeExperience";
import { reconcileNativeEventAlarms } from "./src/native/alarmReconciliation";
import { cancelAllManualNativeAlarms, cancelNativeAlarm, isExactAlarmAllowed, isNativeBridgeAvailable } from "./src/native/nativeExperience";
import { DataSafetyCenter } from "./src/components/DataSafetyCenter";
import { AppErrorBoundary } from "./src/components/AppErrorBoundary";
import { isSupportedTimeZone, parseICSDateTime, type ParsedICSEvent } from "./src/temporal/ics";
import type { RSVPStatus } from "./src/temporal/types";
import { cancelNotificationIds, requestNotificationPermission, scheduleEventNotifications, scheduleReminderNotification } from "./src/notifications/notificationService";
import * as Notifications from "expo-notifications";
import { useFonts } from "expo-font";
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from "@expo-google-fonts/manrope";
import { BrandText } from "./src/components/BrandText";

type ScreenMode = "Day" | "Week" | "Month";
type MainTab = "Calendar" | "Tasks" | "Reminders" | "Sharing" | "Native" | "Data" | "Spaces";
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
        {task.completed ? <BrandText style={styles.checkGlyph}>✓</BrandText> : null}
      </Pressable>
      <View style={styles.taskCopy}>
        <BrandText style={[styles.taskTitle, task.completed && styles.completedText]}>{task.title}</BrandText>
        <BrandText style={styles.taskDue}>{task.due}</BrandText>
      </View>
      <Pressable disabled={task.dueAt == null} onPress={onRemind} accessibilityRole="button" accessibilityLabel={task.hasReminder ? "Turn off task reminder" : "Set task reminder"} style={[styles.taskReminderButton, task.dueAt == null && styles.taskReminderDisabled]}><BrandText style={[styles.taskReminderGlyph, task.hasReminder && styles.taskReminderActive]}>{task.hasReminder ? "◉" : "◷"}</BrandText></Pressable>
      <View style={styles.avatar}><BrandText style={styles.avatarText}>{task.assignee === "You" ? "DR" : task.assignee}</BrandText></View>
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
      <Animated.View entering={FadeIn.delay(index * 18).duration(180)} style={[styles.eventCard, { minHeight: 82, borderLeftColor: color }]}>
        <View style={styles.eventTopLine}>
          <BrandText style={styles.eventTime}>{timeLabel}</BrandText>
          {event.isShielded ? <View style={styles.shieldPill}><BrandText style={styles.shieldText}>SHIELDED</BrandText></View> : null}
          {event.isElastic ? <View style={styles.shieldPill}><BrandText style={styles.shieldText}>FLEXIBLE</BrandText></View> : null}
        </View>
        <BrandText style={styles.eventTitle}>{event.title}</BrandText>
        <BrandText style={styles.eventSubtitle}>{location ?? "Tap to edit event"}</BrandText>
      </Animated.View>
    </Pressable>
  );
}

function CalendarApp() {
  const [mode, setMode] = useState<ScreenMode>("Day");
  const [activeTab, setActiveTab] = useState<MainTab>("Calendar");
  const sharingEntities = useCalendarStore(useShallow(state => Object.values(state.entitiesById)));
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const selectedDay = selectedDate.getDate();
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [database, setDatabase] = useState<LocalCalendarDatabase | null>(null);
  const [calendarHydrated, setCalendarHydrated] = useState(false);
  const [eventEditorVisible, setEventEditorVisible] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TemporalEntity | null>(null);
  const [editingOccurrenceStartAt, setEditingOccurrenceStartAt] = useState<number | null>(null);
  const pendingCount = useCalendarStore(state => state.pendingMutations.length);
  const storedEntities = useCalendarStore(useShallow(state => Object.values(state.entitiesById)));

  const [appForegroundRevision, setAppForegroundRevision] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") setAppForegroundRevision(value => value + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const now = Date.now();
    const live = storedEntities.filter(entity => entity.deletedAt === null && !entity.isCompleted);
    const nextTask = live.filter(entity => entity.itemType === "task").sort((a,b) => {
      const ad = a.metadata?.task?.dueAt ?? a.scheduledAt ?? Number.MAX_SAFE_INTEGER;
      const bd = b.metadata?.task?.dueAt ?? b.scheduledAt ?? Number.MAX_SAFE_INTEGER;
      return ad - bd;
    })[0];
    const nextEvent = live.filter(entity => entity.itemType === "event" && entity.scheduledAt !== null && entity.scheduledAt > now).sort((a,b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0))[0];
    const primary = nextTask ?? nextEvent;
    const dueAt = nextTask ? (nextTask.metadata?.task?.dueAt ?? nextTask.scheduledAt) : nextEvent?.scheduledAt ?? null;
    void publishNativeWidgetSnapshot({
      title: primary?.title ?? "Nothing urgent",
      dueLabel: dueAt === null ? "You're all caught up" : new Date(dueAt).toLocaleString(undefined,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}),
      assignee: nextTask?.metadata?.task?.assignee?.name ?? "You",
      deepLink: nextTask ? "drcalender://tasks" : nextEvent ? "drcalender://events/" + nextEvent.id : "drcalender://tasks",
    }).catch(() => undefined);
  }, [storedEntities]);

  // Keep native OS alarms aligned with the active workspace. The native module
  // removes obsolete alarms after edits, moves, exclusions, completion and deletion.
  useEffect(() => {
    if (!database || !calendarHydrated) return;
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        let entitiesForReconciliation = storedEntities;
        // On Android, exact AlarmManager delivery replaces the Expo reminder for
        // the same event. Clear those Expo requests first to prevent duplicate alerts.
        if (Platform.OS === "android" && isNativeBridgeAvailable() && await isExactAlarmAllowed() && (await Notifications.getPermissionsAsync()).granted) {
          const updates: TemporalEntity[] = [];
          for (const entity of storedEntities) {
            const meta = entity.metadata?.event;
            if (entity.itemType !== "event" || entity.deletedAt !== null || entity.isCompleted ||
                meta?.reminderMinutesBefore == null || !meta.notificationIds?.length) continue;
            try {
              await cancelNotificationIds(meta.notificationIds);
              const updated: TemporalEntity = {
                ...entity,
                updatedAt: Date.now(),
                syncVersion: entity.syncVersion + 1,
                metadata: { ...entity.metadata, event: { ...meta, notificationIds: [] } },
              };
              await database.repository.upsert(updated, "native-reminder-handoff-" + entity.id + "-" + updated.syncVersion);
              updates.push(updated);
            } catch (error) {
              console.warn("Unable to hand off event reminder to native AlarmManager", error);
            }
          }
          if (active && updates.length) {
            for (const entity of updates) useCalendarStore.getState().upsertEntity(entity, "native-reminder-handoff-" + entity.id + "-" + entity.syncVersion);
            const changed = new Map(updates.map(entity => [entity.id, entity]));
            entitiesForReconciliation = storedEntities.map(entity => changed.get(entity.id) ?? entity);
          }
        }
        if (active) await reconcileNativeEventAlarms(entitiesForReconciliation);
      })().catch(error => console.warn("Native alarm reconciliation failed", error));
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [storedEntities, database, calendarHydrated, appForegroundRevision]);

  // Refill missing Expo notification schedules after returning from Settings or
  // after an OS permission change. Android exact alarms are handled by the native
  // reconciler above, so they do not also receive Expo event notifications.
  useEffect(() => {
    if (!database || !calendarHydrated || appForegroundRevision === 0) return;
    let active = true;
    void (async () => {
      const permission = await Notifications.getPermissionsAsync();
      setPermissionGranted(permission.granted);
      if (!permission.granted) return;
      const pendingNotifications = await Notifications.getAllScheduledNotificationsAsync();
      const pendingNotificationIds = new Set(pendingNotifications.map(item => item.identifier));
      for (const entity of storedEntities) {
        if (!active || entity.deletedAt !== null || entity.isCompleted) continue;
        let updated: TemporalEntity | null = null;
        if (entity.itemType === "reminder" && entity.metadata?.reminder && (!entity.metadata.reminder.notificationId || !pendingNotificationIds.has(entity.metadata.reminder.notificationId))) {
          const meta = entity.metadata.reminder;
          const at = meta.snoozeUntil ?? (meta.trigger.kind === "time" ? meta.trigger.at : null);
          if (at !== null && at > Date.now()) {
            const notificationId = await scheduleReminderNotification(entity, at);
            if (notificationId) updated = { ...entity, updatedAt: Date.now(), syncVersion: entity.syncVersion + 1,
              metadata: { ...entity.metadata, reminder: { ...meta, notificationId } } };
          }
        } else if (entity.itemType === "task" && entity.metadata?.task &&
          entity.metadata.task.reminderMinutesBefore != null && (!entity.metadata.task.notificationId || !pendingNotificationIds.has(entity.metadata.task.notificationId))) {
          const meta = entity.metadata.task;
          const dueAt = meta.dueAt ?? entity.scheduledAt;
          if (dueAt !== null) {
            const reminderMinutesBefore = meta.reminderMinutesBefore ?? 0;
            const at = dueAt - reminderMinutesBefore * 60_000 > Date.now()
              ? dueAt - reminderMinutesBefore * 60_000 : dueAt;
            if (at > Date.now()) {
              const notificationId = await scheduleReminderNotification(entity, at);
              if (notificationId) updated = { ...entity, updatedAt: Date.now(), syncVersion: entity.syncVersion + 1,
                metadata: { ...entity.metadata, task: { ...meta, notificationId } } };
            }
          }
        } else if (entity.itemType === "event" && entity.metadata?.event?.reminderMinutesBefore != null &&
          (!entity.metadata.event.notificationIds?.length || !entity.metadata.event.notificationIds.some(id => pendingNotificationIds.has(id)))) {
          const useNativeAndroidAlarm = Platform.OS === "android" && isNativeBridgeAvailable() && await isExactAlarmAllowed();
          if (!useNativeAndroidAlarm) {
            const notificationIds = await scheduleEventNotifications(entity);
            if (notificationIds.length) updated = { ...entity, updatedAt: Date.now(), syncVersion: entity.syncVersion + 1,
              metadata: { ...entity.metadata, event: { ...entity.metadata.event, notificationIds } } };
          }
        }
        if (updated && active) {
          const mutationId = "foreground-notification-reconcile-" + updated.id + "-" + updated.syncVersion;
          await database.repository.upsert(updated, mutationId);
          useCalendarStore.getState().upsertEntity(updated, mutationId);
        }
      }
    })().catch(error => console.warn("Unable to restore notification schedules on foreground", error));
    return () => { active = false; };
  }, [appForegroundRevision, database, calendarHydrated, storedEntities]);

  // Widgets and alarm notifications open the app through the drcalender:// scheme.
  // Resolve event IDs after hydration so cold-start links are not lost.
  const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(null);
  useEffect(() => {
    const openNotificationRoute = (response: Notifications.NotificationResponse | null) => {
      const value = response?.notification.request.content.data?.deepLink;
      if (typeof value === "string" && value.startsWith("drcalender://")) {
        setPendingDeepLink(value);
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      }
    };
    void Notifications.getLastNotificationResponseAsync().then(openNotificationRoute).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(openNotificationRoute);
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    let active = true;
    const receiveUrl = (url: string | null) => {
      if (active && url) setPendingDeepLink(url);
    };
    void Linking.getInitialURL().then(receiveUrl).catch(() => undefined);
    const subscription = Linking.addEventListener("url", event => receiveUrl(event.url));
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!pendingDeepLink) return;
    let parsed: URL;
    try { parsed = new URL(pendingDeepLink); } catch { setPendingDeepLink(null); return; }
    const route = parsed.hostname || parsed.pathname.replace(/^\//, "");
    if (route === "tasks" || parsed.pathname === "/tasks") {
      setActiveTab("Tasks");
      setPendingDeepLink(null);
      return;
    }
    if (route === "reminders" || parsed.pathname.startsWith("/reminders/")) {
      setActiveTab("Reminders");
      setPendingDeepLink(null);
      return;
    }
    if (route === "events" || parsed.pathname.startsWith("/events/")) {
      // Keep cold-start event links queued until the database has hydrated.
      if (!calendarHydrated) return;
      const rawId = parsed.pathname.replace(/^\/+/, "").startsWith("events/")
        ? parsed.pathname.replace(/^\/+/, "").slice("events/".length)
        : parsed.pathname.replace(/^\/+/, "");
      const eventId = decodeURIComponent(rawId);
      const event = storedEntities.find(item =>
        item.itemType === "event" && item.deletedAt === null &&
        (item.id === eventId || eventId.startsWith(item.id + "::"))
      );
      if (event) {
        const occurrenceSuffix = eventId.startsWith(event.id + "::") ? eventId.slice(event.id.length + 2) : null;
        const occurrenceStartAt = occurrenceSuffix !== null && /^\d+$/.test(occurrenceSuffix) ? Number(occurrenceSuffix) : null;
        const override = occurrenceStartAt === null ? null : event.metadata?.recurrence?.overrides[String(occurrenceStartAt)];
        setActiveTab("Calendar");
        setSelectedDate(new Date(override?.startAt ?? occurrenceStartAt ?? event.scheduledAt ?? Date.now()));
        setEditingEvent(event);
        setEditingOccurrenceStartAt(occurrenceStartAt);
        setEventEditorVisible(true);
        setPendingDeepLink(null);
      } else if (database) {
        // Database is hydrated; the target is missing/deleted, so avoid an endless retry.
        setActiveTab("Calendar");
        setPendingDeepLink(null);
      }
    } else {
      setPendingDeepLink(null);
    }
  }, [pendingDeepLink, storedEntities, database, calendarHydrated]);

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
  const taskEntities = storedEntities.filter(entity => entity.itemType === "task" && entity.deletedAt === null);
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
      const start = new Date(now.getFullYear() - 1, now.getMonth(), 1).getTime();
      const end = new Date(now.getFullYear() + 5, now.getMonth() + 1, 1).getTime();
      let entities = await local.repository.queryRange(local.workspaceId, start, end);
      if (entities.length === 0) {
        const today = new Date();
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
      const pending = await local.repository.listPendingMutations(1000, local.workspaceId);
      useCalendarStore.getState().hydrate(entities, pending);
      setCalendarHydrated(true);
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
            const eventMeta = entity.metadata.event;
            const useNativeAndroidAlarm = Platform.OS === "android" && isNativeBridgeAvailable() && await isExactAlarmAllowed();
            if (useNativeAndroidAlarm && !eventMeta.notificationIds?.length) continue;
            let notificationIds: string[];
            if (useNativeAndroidAlarm) {
              await cancelNotificationIds(eventMeta.notificationIds);
              notificationIds = [];
            } else {
              notificationIds = await scheduleEventNotifications(entity);
            }
            const updated = { ...entity, updatedAt: Date.now(), syncVersion: entity.syncVersion + 1, metadata: { ...entity.metadata, event: { ...eventMeta, notificationIds } } };
            const mutationId = "event-notification-reschedule-" + entity.id + "-" + updated.syncVersion;
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
        const updated = { ...entity, isCompleted: completed, updatedAt: Date.now(), syncVersion: entity.syncVersion + 1, metadata: { ...entity.metadata, ...(taskMeta ? { task: { ...taskMeta, ...(completed ? { notificationId: null } : taskMeta.notificationId !== undefined ? { notificationId: taskMeta.notificationId } : {}) } } : {}) } };
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

  const reconcileWorkspaceNotifications = async (
    nextDatabase: LocalCalendarDatabase,
    sourceEntities: TemporalEntity[],
  ): Promise<TemporalEntity[]> => {
    // A workspace switch or restore invalidates the previous workspace's
    // scheduled OS requests. Rebuild them from the now-active local dataset.
    await Notifications.cancelAllScheduledNotificationsAsync();
    const permission = await Notifications.getPermissionsAsync();
    setPermissionGranted(permission.granted);
    const entities = [...sourceEntities];
    const now = Date.now();
    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index]!;
      let updated: TemporalEntity | null = null;
      if (entity.itemType === "reminder" && entity.metadata?.reminder) {
        const meta = entity.metadata.reminder;
        const at = entity.deletedAt === null && !entity.isCompleted
          ? meta.snoozeUntil ?? (meta.trigger.kind === "time" ? meta.trigger.at : null)
          : null;
        const notificationId = permission.granted && at !== null && at > now
          ? await scheduleReminderNotification(entity, at)
          : null;
        if ((meta.notificationId ?? null) !== notificationId) {
          updated = { ...entity, updatedAt: now, syncVersion: entity.syncVersion + 1,
            metadata: { ...entity.metadata, reminder: { ...meta, notificationId } } };
        }
      } else if (entity.itemType === "task" && entity.metadata?.task) {
        const meta = entity.metadata.task;
        const dueAt = meta.dueAt ?? entity.scheduledAt;
        const triggerAt = dueAt === null ? null : dueAt - (meta.reminderMinutesBefore ?? 15) * 60_000 > now
          ? dueAt - (meta.reminderMinutesBefore ?? 15) * 60_000
          : dueAt;
        const notificationId = permission.granted && entity.deletedAt === null && !entity.isCompleted &&
          meta.reminderMinutesBefore != null && triggerAt !== null && triggerAt > now
          ? await scheduleReminderNotification(entity, triggerAt)
          : null;
        if ((meta.notificationId ?? null) !== notificationId) {
          updated = { ...entity, updatedAt: now, syncVersion: entity.syncVersion + 1,
            metadata: { ...entity.metadata, task: { ...meta, notificationId } } };
        }
      } else if (entity.itemType === "event" && entity.metadata?.event) {
        const meta = entity.metadata.event;
        const useNativeAndroidAlarm = Platform.OS === "android" && isNativeBridgeAvailable() &&
          permission.granted && await isExactAlarmAllowed();
        const notificationIds = permission.granted && entity.deletedAt === null && !entity.isCompleted &&
          meta.reminderMinutesBefore != null && !useNativeAndroidAlarm
          ? await scheduleEventNotifications(entity)
          : [];
        const currentIds = meta.notificationIds ?? [];
        if (currentIds.length !== notificationIds.length || currentIds.some((id, i) => id !== notificationIds[i])) {
          updated = { ...entity, updatedAt: now, syncVersion: entity.syncVersion + 1,
            metadata: { ...entity.metadata, event: { ...meta, notificationIds } } };
        }
      }
      if (updated) {
        const mutationId = "workspace-notification-reconcile-" + updated.id + "-" + updated.syncVersion;
        await nextDatabase.repository.upsert(updated, mutationId);
        useCalendarStore.getState().upsertEntity(updated, mutationId);
        entities[index] = updated;
      }
    }
    return entities;
  };

  const refreshWorkspaceData = async (nextDatabase: LocalCalendarDatabase) => {
    setCalendarHydrated(false);
    try { await cancelAllManualNativeAlarms(); }
    catch (error) { console.warn("Unable to clear manual alarms before workspace reload", error); }
    setDatabase(nextDatabase);
    const now = new Date();
    const start = new Date(now.getFullYear() - 1, now.getMonth(), 1).getTime();
    const end = new Date(now.getFullYear() + 5, now.getMonth() + 1, 1).getTime();
    let entities = await nextDatabase.repository.queryRange(nextDatabase.workspaceId, start, end);
    const pending = await nextDatabase.repository.listPendingMutations(1000, nextDatabase.workspaceId);
    useCalendarStore.getState().hydrate(entities, pending);
    entities = await reconcileWorkspaceNotifications(nextDatabase, entities);
    setCalendarHydrated(true);
    setTasks(entities.filter(entity => entity.itemType === "task").map(entity => {
      const dueAt = entity.metadata?.task?.dueAt ?? entity.scheduledAt;
      return { id: entity.id, title: entity.title, due: dueAt === null ? "No due date" : new Date(dueAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), assignee: entity.metadata?.task?.assignee?.name ?? "You", completed: entity.isCompleted, dueAt, hasReminder: entity.metadata?.task?.reminderMinutesBefore != null };
    }));
    setSelectedDate(new Date());
  };

  const refreshAfterSync = async () => {
    if (!database) return;
    const now = new Date();
    const start = new Date(now.getFullYear() - 1, now.getMonth(), 1).getTime();
    const end = new Date(now.getFullYear() + 5, now.getMonth() + 1, 1).getTime();
    const entities = await database.repository.queryRange(database.workspaceId, start, end);
    const pending = await database.repository.listPendingMutations(1000, database.workspaceId);
    useCalendarStore.getState().hydrate(entities, pending);
    setTasks(entities.filter(entity => entity.itemType === "task").map(entity => {
      const dueAt = entity.metadata?.task?.dueAt ?? entity.scheduledAt;
      return { id: entity.id, title: entity.title, due: dueAt === null ? "No due date" : new Date(dueAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), assignee: entity.metadata?.task?.assignee?.name ?? "You", completed: entity.isCompleted, dueAt, hasReminder: entity.metadata?.task?.reminderMinutesBefore != null };
    }));
  };

  const importICSItems = async (items: ParsedICSEvent[], strategy: "skip" | "update") => {
    if (!database) throw new Error("Local calendar storage is not ready.");
    const current = await database.repository.queryRange(database.workspaceId, 0, 4102444800000);
    const replies = items.filter(item => item.method === "REPLY");
    let imported = 0;
    for (const reply of replies) {
      const event = current.find(entity => entity.itemType === "event" && entity.metadata?.invite?.icsUid === reply.uid);
      if (!event || !event.metadata?.invite) continue;
      const attendeeReply = reply.attendees[0];
      if (!attendeeReply || attendeeReply.rsvpStatus === "needs-action") continue;
      const attendeeExists = event.metadata.invite.attendeeList.some(attendee => attendee.email.toLowerCase() === attendeeReply.email.toLowerCase());
      if (!attendeeExists) continue;
      const updated: TemporalEntity = { ...event, updatedAt:Date.now(), syncVersion:event.syncVersion+1, metadata:{ ...event.metadata, invite:{ ...event.metadata.invite, attendeeList:event.metadata.invite.attendeeList.map(attendee => attendee.email.toLowerCase() === attendeeReply.email.toLowerCase() ? { ...attendee, rsvpStatus:attendeeReply.rsvpStatus } : attendee), sequence:event.metadata.invite.sequence+1 } } };
      const mutationId = "ics-rsvp-" + event.id + "-" + updated.syncVersion;
      await database.repository.upsert(updated,mutationId);
      useCalendarStore.getState().upsertEntity(updated,mutationId);
      imported++;
    }
    const masters = items.filter(item => item.method !== "REPLY" && item.recurrenceId === null);
    const exceptions = items.filter(item => item.method !== "REPLY" && item.recurrenceId !== null);
    for (const item of masters) {
      if (!item.start) continue;
      const startAt = parseICSDateTime(item.start,item.timeZone);
      if (!Number.isFinite(startAt)) continue;
      const allDay = item.isAllDay;
      const endAt = item.end ? parseICSDateTime(item.end,item.timeZone) : startAt + (allDay ? 86_400_000 : 3_600_000);
      if (!Number.isFinite(endAt) || endAt <= startAt) continue;
      const deterministicId = "ics-" + item.uid.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
      const existing = current.find(entity => entity.itemType === "event" && entity.metadata?.invite?.icsUid === item.uid) ?? await database.repository.getByIdIncludingDeleted(deterministicId);
      if (existing && strategy === "skip") continue;
      const now = Date.now();
      const id = existing?.id ?? deterministicId;
      const attendeeList = item.attendees;
      const matchingExceptions = exceptions.filter(exception => exception.uid === item.uid);
      const overrides: Record<string, { startAt:number; endAt:number; title:string; location:string|null; isShielded:boolean; isElastic:boolean; isAllDay?:boolean }> = {};
      for (const exception of matchingExceptions) {
        if (exception.status === "CANCELLED" || !exception.recurrenceId || !exception.start) continue;
        const originalAt = parseICSDateTime(exception.recurrenceId,exception.timeZone ?? item.timeZone);
        const movedAt = parseICSDateTime(exception.start,exception.timeZone ?? item.timeZone);
        if (!Number.isFinite(originalAt) || !Number.isFinite(movedAt)) continue;
        const exceptionEnd = exception.end ? parseICSDateTime(exception.end,exception.timeZone ?? item.timeZone) : movedAt + (allDay ? 86_400_000 : 3_600_000);
        overrides[String(originalAt)] = { startAt:movedAt, endAt:exceptionEnd, title:exception.summary || item.summary, location:exception.location ?? item.location, isShielded:false, isElastic:false, isAllDay:exception.isAllDay };
      }
      const excludedStartsAt = [...item.excludedDates.map(value => parseICSDateTime(value,item.timeZone)), ...matchingExceptions.filter(exception => exception.status === "CANCELLED" && exception.recurrenceId).map(exception => parseICSDateTime(exception.recurrenceId!,exception.timeZone ?? item.timeZone))].filter(Number.isFinite);
      const entity: TemporalEntity = {
        id, workspaceId:database.workspaceId, itemType:"event", title:item.summary || "(Untitled event)",
        scheduledAt:startAt, endAt, isCompleted:false, priority:existing?.priority??"normal",
        isShielded:existing?.isShielded??false, isElastic:existing?.isElastic??false, isGhost:false, ghostClusterId:null,
        assignedUserIds:existing?.assignedUserIds??["local-user"], rrule:item.recurrenceRule, syncVersion:(existing?.syncVersion??0)+1,
        createdAt:existing?.createdAt??now, updatedAt:now, deletedAt:item.status==="CANCELLED"?now:null, timeZone:isSupportedTimeZone(item.timeZone)?item.timeZone!:Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC",
        metadata:{
          ...existing?.metadata,
          recurrence: { excludedStartsAt, overrides:{ ...(existing?.metadata?.recurrence?.overrides??{}), ...overrides } },
          event:{ kind:allDay?"all-day":"standard", commitment:"hard", location:item.location, meetingUrl:existing?.metadata?.event?.meetingUrl??null, organizerUserId:existing?.metadata?.event?.organizerUserId??null, attendeeUserIds:existing?.metadata?.event?.attendeeUserIds??[], travelBufferMinutes:null, cooldownBufferMinutes:null, reminderMinutesBefore:existing?.metadata?.event?.reminderMinutesBefore??null, notificationIds:existing?.metadata?.event?.notificationIds??[] },
          invite:{ organizerEmail:item.organizerEmail??"", attendeeList, rsvpStatus:"needs-action", icsUid:item.uid, sequence:item.sequence },
        },
      };
      const mutationId="ics-import-"+id+"-"+entity.syncVersion;
      await database.repository.upsert(entity,mutationId);
      useCalendarStore.getState().upsertEntity(entity,mutationId);
      imported++;
    }
    await refreshWorkspaceData(database);
    if (imported===0) throw new Error("No new or updated master events were imported. Check duplicates, event dates, and recurrence exceptions.");
  };

  const updateEventRSVP = async (event: TemporalEntity, email: string, status: Exclude<RSVPStatus,"needs-action">) => {
    if (!database) throw new Error("Local calendar storage is not ready.");
    const current = await database.repository.getById(event.id);
    if (!current) throw new Error("Event no longer exists in this workspace.");
    const attendees = current.metadata?.invite?.attendeeList ?? [];
    const attendeeExists = attendees.some(attendee => attendee.email.toLowerCase() === email.trim().toLowerCase());
    if (!attendeeExists) throw new Error("Attendee was not found on the event.");
    const updated: TemporalEntity = { ...current, updatedAt:Date.now(), syncVersion:current.syncVersion+1, metadata:{ ...current.metadata, invite:{ ...(current.metadata?.invite ?? { organizerEmail:"", attendeeList:[], rsvpStatus:"needs-action" as const, icsUid:current.id+"@dr-calender.local", sequence:0 }), attendeeList:attendees.map(attendee=>attendee.email.toLowerCase()===email.trim().toLowerCase()?{...attendee,rsvpStatus:status}:attendee), sequence:(current.metadata?.invite?.sequence??0)+1 } } };
    const mutationId="event-rsvp-"+current.id+"-"+updated.syncVersion;
    await database.repository.upsert(updated,mutationId);
    useCalendarStore.getState().upsertEntity(updated,mutationId);
  };

  const addEventAttendee = async (event: TemporalEntity, email: string) => {
    if (!database) throw new Error("Local calendar storage is not ready.");
    const current = await database.repository.getById(event.id);
    if (!current) throw new Error("Event no longer exists in this workspace.");
    const attendees = current.metadata?.invite?.attendeeList ?? [];
    if (attendees.some(attendee => attendee.email.toLowerCase() === email.trim().toLowerCase())) throw new Error("This attendee is already on the event.");
    const updated: TemporalEntity = { ...current, updatedAt:Date.now(), syncVersion:current.syncVersion+1, metadata:{ ...current.metadata, invite:{ ...(current.metadata?.invite ?? { organizerEmail:"", attendeeList:[], rsvpStatus:"needs-action" as const, icsUid:current.id+"@dr-calender.local", sequence:0 }), attendeeList:[...attendees,{email:email.trim().toLowerCase(),displayName:null,userId:null,rsvpStatus:"needs-action" as const}], sequence:(current.metadata?.invite?.sequence??0)+1 } } };
    const mutationId="event-attendee-"+current.id+"-"+updated.syncVersion;
    await database.repository.upsert(updated,mutationId);
    useCalendarStore.getState().upsertEntity(updated,mutationId);
  };

  const saveTask = async (draft: TaskDraft) => {
    if (!database) return;
    const existing = draft.id ? await database.repository.getById(draft.id) : null;
    const now = Date.now();
    const id = existing?.id ?? "task-" + now + "-" + Math.random().toString(36).slice(2, 7);
    const oldTaskMeta = existing?.metadata?.task;
    if (oldTaskMeta?.notificationId) await cancelNotificationIds([oldTaskMeta.notificationId]);
    const entity: TemporalEntity = {
      id, workspaceId: database.workspaceId, itemType: "task", title: draft.title,
      scheduledAt: draft.dueAt, endAt: draft.dueAt === null ? null : draft.dueAt + (draft.durationMinutes ?? oldTaskMeta?.durationMinutes ?? 30) * 60_000, isCompleted: existing?.isCompleted ?? false,
      priority: draft.priority, isShielded: false, isElastic: false, isGhost: false, ghostClusterId: null,
      assignedUserIds: existing?.assignedUserIds ?? ["local-user"], rrule: null,
      syncVersion: (existing?.syncVersion ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
      deletedAt: null, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      metadata: { ...existing?.metadata, task: {
        dueAt: draft.dueAt,
        durationMinutes: draft.durationMinutes ?? oldTaskMeta?.durationMinutes ?? 30,
        assignee: oldTaskMeta?.assignee ?? { id: "local-user", name: "You", avatarUrl: null },
        checklist: draft.checklist,
        reminderMinutesBefore: oldTaskMeta?.reminderMinutesBefore ?? null,
        notificationId: null,
      } },
    };
    const mutationId = "task-save-" + id + "-" + entity.syncVersion;
    await database.repository.upsert(entity, mutationId);
    useCalendarStore.getState().upsertEntity(entity, mutationId);
    if (!entity.isCompleted && entity.metadata?.task?.reminderMinutesBefore != null && draft.dueAt != null) {
      const granted = permissionGranted === true;
      const notifyAt = draft.dueAt - entity.metadata.task.reminderMinutesBefore * 60_000 > now
        ? draft.dueAt - entity.metadata.task.reminderMinutesBefore * 60_000 : draft.dueAt;
      const notificationId = granted && notifyAt > now ? await scheduleReminderNotification(entity, notifyAt) : null;
      if (notificationId) {
        const scheduled = { ...entity, syncVersion: entity.syncVersion + 1, updatedAt: Date.now(), metadata: { ...entity.metadata, task: { ...entity.metadata.task!, notificationId } } };
        await persistReminderUpdate(scheduled, "task-save-notification-" + id + "-" + scheduled.syncVersion);
      }
    }
    setTasks(current => {
      const next = { id, title: entity.title, due: draft.dueAt === null ? "No due date" : new Date(draft.dueAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), assignee: "You", completed: entity.isCompleted, dueAt: draft.dueAt, hasReminder: entity.metadata?.task?.reminderMinutesBefore != null };
      return existing ? current.map(task => task.id === id ? next : task) : [next, ...current];
    });
  };

  const toggleTaskEntity = async (task: TemporalEntity) => {
    if (!database) return;
    const existing = await database.repository.getById(task.id);
    if (!existing || existing.itemType !== "task") return;
    const completed = !existing.isCompleted;
    const taskMeta = existing.metadata?.task;
    if (completed) await cancelNotificationIds(taskMeta?.notificationId ? [taskMeta.notificationId] : []);
    const updated: TemporalEntity = { ...existing, isCompleted: completed, updatedAt: Date.now(), syncVersion: existing.syncVersion + 1, metadata: { ...existing.metadata, ...(taskMeta ? { task: { ...taskMeta, ...(completed ? { notificationId: null } : taskMeta.notificationId !== undefined ? { notificationId: taskMeta.notificationId } : {}) } } : {}) } };
    await database.repository.upsert(updated, "task-complete-" + updated.id + "-" + updated.syncVersion);
    useCalendarStore.getState().upsertEntity(updated, "task-complete-" + updated.id + "-" + updated.syncVersion);
    setTasks(current => current.map(item => item.id === updated.id ? { ...item, completed, hasReminder: taskMeta?.reminderMinutesBefore != null } : item));
    if (!completed && taskMeta?.reminderMinutesBefore != null && (taskMeta.dueAt ?? updated.scheduledAt) != null && permissionGranted) {
      const dueAt = taskMeta.dueAt ?? updated.scheduledAt!;
      const notifyAt = dueAt - taskMeta.reminderMinutesBefore * 60_000 > Date.now() ? dueAt - taskMeta.reminderMinutesBefore * 60_000 : dueAt;
      const notificationId = await scheduleReminderNotification(updated, notifyAt);
      const rescheduled = { ...updated, syncVersion: updated.syncVersion + 1, updatedAt: Date.now(), metadata: { ...updated.metadata, task: { ...taskMeta, notificationId } } };
      await persistReminderUpdate(rescheduled, "task-reopen-notification-" + rescheduled.id + "-" + rescheduled.syncVersion);
    }
  };

  const deleteTaskEntity = async (task: TemporalEntity) => {
    if (!database) return;
    await cancelNotificationIds(task.metadata?.task?.notificationId ? [task.metadata.task.notificationId] : []);
    const mutationId = "task-delete-" + task.id + "-" + (task.syncVersion + 1);
    const tombstone = await database.repository.softDelete(task.id, mutationId);
    if (tombstone) {
      useCalendarStore.getState().deleteEntity(task.id, mutationId, task.workspaceId, "task");
      setTasks(current => current.filter(item => item.id !== task.id));
    }
  };

  const rolloverTask = async (task: TemporalEntity) => {
    const today = new Date();
    const dueAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 17, 0).getTime();
    await saveTask({ id: task.id, title: task.title, dueAt, durationMinutes: task.metadata?.task?.durationMinutes ?? (task.endAt !== null && task.scheduledAt !== null ? Math.max(15, Math.round((task.endAt - task.scheduledAt) / 60_000)) : 30), priority: task.priority, checklist: task.metadata?.task?.checklist ?? [] });
  };

  const planMyDay = async () => {
    if (!database) return;
    const now = Date.now();
    const day = new Date();
    const startOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const endOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    const busy = storedEntities
      .filter(entity => entity.deletedAt === null && !entity.isCompleted && entity.id !== "" && (entity.itemType === "event" || entity.itemType === "task") && entity.scheduledAt !== null && entity.scheduledAt < endOfDay && (entity.endAt ?? entity.scheduledAt + 30 * 60_000) > startOfDay)
      .map(entity => ({ start: Math.max(startOfDay, entity.scheduledAt!), end: Math.min(endOfDay, entity.endAt ?? entity.scheduledAt! + 30 * 60_000) }));
    const pending = taskEntities.filter(task => !task.isCompleted && (task.metadata?.task?.dueAt ?? task.scheduledAt) === null || (!task.isCompleted && (task.metadata?.task?.dueAt ?? task.scheduledAt) !== null && (task.metadata?.task?.dueAt ?? task.scheduledAt)! < startOfDay))
      .sort((a, b) => ({ critical: 0, high: 1, normal: 2, low: 3 }[a.priority] - { critical: 0, high: 1, normal: 2, low: 3 }[b.priority] || a.createdAt - b.createdAt));
    let cursor = Math.max(now, new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0).getTime());
    const workdayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 18, 0).getTime();
    let planned = 0;
    for (const task of pending) {
      const durationMs = (task.metadata?.task?.durationMinutes ?? 30) * 60_000;
      let slot = cursor;
      while (slot + durationMs <= workdayEnd && busy.some(block => slot < block.end && block.start < slot + durationMs)) {
        const blockerEnd = Math.max(...busy.filter(block => slot < block.end && block.start < slot + durationMs).map(block => block.end));
        slot = Math.ceil(blockerEnd / (15 * 60_000)) * 15 * 60_000;
      }
      if (slot + durationMs > workdayEnd) break;
      const updated: TemporalEntity = {
        ...task, scheduledAt: slot, endAt: slot + durationMs, updatedAt: Date.now(), syncVersion: task.syncVersion + 1,
        metadata: { ...task.metadata, task: { ...task.metadata?.task!, dueAt: slot, durationMinutes: task.metadata?.task?.durationMinutes ?? 30, assignee: task.metadata?.task?.assignee ?? { id: "local-user", name: "You", avatarUrl: null } } },
      };
      const mutationId = "task-plan-day-" + task.id + "-" + updated.syncVersion;
      await database.repository.upsert(updated, mutationId);
      useCalendarStore.getState().upsertEntity(updated, mutationId);
      busy.push({ start: slot, end: slot + durationMs });
      cursor = slot + durationMs;
      planned += 1;
    }
    setActiveTab("Tasks");
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

  const refreshEventNotifications = async (entity: TemporalEntity) => {
    const eventMeta = entity.metadata?.event;
    if (!eventMeta || (eventMeta.reminderMinutesBefore == null && !eventMeta.notificationIds?.length)) return;
    let notificationIds: string[];
    if (Platform.OS === "android" && isNativeBridgeAvailable() && await isExactAlarmAllowed() && eventMeta.reminderMinutesBefore != null) {
      await cancelNotificationIds(eventMeta.notificationIds);
      notificationIds = [];
    } else {
      notificationIds = await scheduleEventNotifications(entity);
    }
    const updated = { ...entity, syncVersion: entity.syncVersion + 1, updatedAt: Date.now(), metadata: { ...entity.metadata, event: { ...eventMeta, notificationIds } } };
    await persistReminderUpdate(updated, "event-notifications-refresh-" + entity.id + "-" + updated.syncVersion);
    const permission = await Notifications.getPermissionsAsync();
    setPermissionGranted(permission.granted);
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
    const updated = { ...reminder, isCompleted: true, updatedAt: Date.now(), syncVersion: reminder.syncVersion + 1, metadata: { ...reminder.metadata, ...(current ? { reminder: { ...current, notificationId: null } } : {}) } };
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
    if (existing && draft.scope !== "occurrence") {
      void cancelNativeAlarm("native-event-manual-" + existing.id).catch(error => console.warn("Unable to cancel stale manual native alarm", error));
    }
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
      refreshEventNotifications(entity).catch(error => console.warn("Unable to refresh occurrence reminders", error));
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
      timeZone: draft.timeZone,
      metadata: {
        ...existing?.metadata,
        // Occurrence exception keys are anchored to generated start timestamps.
        // If the series schedule changes, discard exceptions tied to the old schedule.
        ...((existing && (existing.rrule !== draft.rrule || existing.scheduledAt !== draft.startAt)) ? { recurrence: { excludedStartsAt: [], overrides: {} } } : {}),
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
      refreshEventNotifications(entity).catch(error => console.warn("Unable to schedule event reminders", error));
    }
  };

  const moveEvent = (event: TemporalEntity, nextStartAt: number, nextEndAt: number) => {
    void cancelNativeAlarm("native-event-manual-" + event.id).catch(error => console.warn("Unable to cancel moved event's manual native alarm", error));
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
    refreshEventNotifications(updated).catch(error => console.warn("Unable to reschedule moved event reminder", error));
  };

  const deleteEvent = (event: TemporalEntity, scope: "occurrence" | "series" = "series", occurrenceStartAt: number | null = null) => {
    if (scope === "series") {
      void cancelNativeAlarm("native-event-manual-" + event.id).catch(error => console.warn("Unable to cancel deleted event's manual native alarm", error));
    }
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
      refreshEventNotifications(updated).catch(error => console.warn("Unable to refresh occurrence reminders", error));
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
          <BrandText style={styles.eyebrow}>YOUR SPACE  ·  PLAN WITH INTENTION</BrandText>
          <BrandText style={styles.brand}>Calender<BrandText style={styles.brandDot}>.</BrandText></BrandText>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="Search" style={styles.iconButton}><BrandText style={styles.iconGlyph}>⌕</BrandText></Pressable>
          <Pressable accessibilityLabel="Profile" style={styles.profileButton}><BrandText style={styles.profileText}>DR</BrandText></Pressable>
        </View>
      </View>

      {activeTab === "Calendar" ? <>
      <View style={styles.modeBar}>
        <View style={styles.dateHeading}>
          <View>
            <BrandText style={styles.monthLabel}>{monthLabel}</BrandText>
            <BrandText style={styles.subLabel}>{selectedDate.toLocaleDateString(undefined, { weekday: "long", day: "numeric" })}</BrandText>
          </View>
          <View style={styles.monthControls}>
            <Pressable
              onPress={() => shiftCalendarMonth(-1)}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              style={styles.monthArrow}
            >
              <BrandText style={styles.monthArrowGlyph}>‹</BrandText>
            </Pressable>
            <Pressable
              onPress={jumpToToday}
              accessibilityRole="button"
              accessibilityLabel="Go to today"
              style={styles.todayButton}
            >
              <BrandText style={styles.todayButtonText}>Today</BrandText>
            </Pressable>
            <Pressable
              onPress={() => shiftCalendarMonth(1)}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              style={styles.monthArrow}
            >
              <BrandText style={styles.monthArrowGlyph}>›</BrandText>
            </Pressable>
          </View>
        </View>
        <View style={styles.modeSwitch}>
          {(["Day", "Week", "Month"] as ScreenMode[]).map(item => (
            <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: mode === item }} onPress={() => setMode(item)} style={({ pressed }) => [styles.modeOption, mode === item && styles.modeOptionActive, pressed && styles.pressedControl]}>
              <BrandText style={[styles.modeText, mode === item && styles.modeTextActive]}>{item}</BrandText>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.weekStrip}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysContent}>
          {days.map(({ day, weekday }) => (
            <Pressable key={day} accessibilityRole="button" accessibilityState={{ selected: selectedDay === day }} onPress={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day))} style={({ pressed }) => [styles.dayItem, selectedDay === day && styles.dayItemActive, pressed && styles.pressedControl]}>
              <BrandText style={[styles.dayWeekday, selectedDay === day && styles.dayWeekdayActive]}>{weekday}</BrandText>
              <BrandText style={[styles.dayNumber, selectedDay === day && styles.dayNumberActive]}>{day}</BrandText>
              {[5, 9, 14, 18, 23, 27].includes(day) ? <View style={[styles.dayDot, selectedDay === day && styles.dayDotActive]} /> : <View style={styles.dayDotPlaceholder} />}
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionHeading}>
          <View><BrandText style={styles.sectionTitle}>{mode === "Day" ? "Today’s agenda" : `${mode} overview`}</BrandText><BrandText style={styles.sectionCaption}><BrandText style={styles.captionItalic}>A little structure,</BrandText> a lot more space.</BrandText></View>
          <Pressable onPress={openNewEvent} style={({ pressed }) => [styles.addButton, SHADOWS.floating, pressed && styles.pressedControl]} accessibilityRole="button" accessibilityLabel="Create event"><BrandText style={styles.addGlyph}>＋</BrandText></Pressable>
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
              <BrandText style={styles.emptyEventsTitle}>Nothing scheduled yet</BrandText>
              <BrandText style={styles.sectionCaption}>Add an event to start shaping this day.</BrandText>
              <Pressable onPress={openNewEvent} style={styles.emptyAdd}><BrandText style={styles.emptyAddText}>＋ Create event</BrandText></Pressable>
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
            <View><BrandText style={styles.sectionTitle}>In the loop</BrandText><BrandText style={styles.sectionCaption}><BrandText style={styles.attentionCount}>{tasks.filter(task => !task.completed).length}</BrandText> tasks need your attention</BrandText></View>
            <Pressable onPress={addQuickTask}><BrandText style={styles.seeAll}>＋ Add</BrandText></Pressable>
          </View>
          <View style={[styles.tasksCard, SHADOWS.card]}>
            {tasks.map(task => <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task.id)} onRemind={() => toggleTaskReminder(task.id)} />)}
          </View>
        </View>
        <View style={styles.syncNote}><View style={styles.syncDot} /><BrandText style={styles.syncText}>{pendingCount ? `${pendingCount} changes waiting to sync` : "Offline-first · Ready when you are"}</BrandText></View>
      </ScrollView></> : activeTab === "Tasks" ? <TaskCenter tasks={taskEntities} onSave={draft => { void saveTask(draft).catch(error => console.warn("Unable to save task", error)); }} onToggle={task => { void toggleTaskEntity(task).catch(error => console.warn("Unable to update task", error)); }} onDelete={task => { void deleteTaskEntity(task).catch(error => console.warn("Unable to delete task", error)); }} onPlanDay={() => { void planMyDay().catch(error => console.warn("Unable to plan day", error)); }} onRollover={task => { void rolloverTask(task).catch(error => console.warn("Unable to roll task forward", error)); }} /> : activeTab === "Reminders" ? <ReminderCenter reminders={reminders} permissionGranted={permissionGranted} onRequestPermission={handleRequestNotifications} onCreate={createReminder} onSnooze={snoozeReminder} onComplete={completeReminder} onDelete={deleteReminder} /> : activeTab === "Sharing" ? <SharingCenter events={sharingEntities} onImport={importICSItems} onRSVP={updateEventRSVP} onAddAttendee={addEventAttendee} /> : activeTab === "Native" ? <NativeExperienceCenter entities={sharingEntities} /> : activeTab === "Data" ? <DataSafetyCenter database={database} onRestored={refreshWorkspaceData} /> : <AccountCenter database={database} onSynced={refreshAfterSync} onWorkspaceChanged={refreshWorkspaceData} />}

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
          { glyph: "⇄", label: "Sharing", active: false },
          { glyph: "◫", label: "Native", active: false },
          { glyph: "◇", label: "Data", active: false },
          { glyph: "◉", label: "Spaces", active: false },
        ].map(item => (
          <Pressable key={item.label} onPress={() => setActiveTab(item.label as MainTab)} accessibilityRole="button" accessibilityState={{ selected: activeTab === item.label }} style={styles.navItem}>
            <BrandText style={[styles.navGlyph, activeTab === item.label && styles.navGlyphActive]}>{item.glyph}</BrandText>
            <BrandText style={[styles.navLabel, activeTab === item.label && styles.navLabelActive]}>{item.label}</BrandText>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider><AppErrorBoundary><CalendarApp /></AppErrorBoundary></SafeAreaProvider>
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
