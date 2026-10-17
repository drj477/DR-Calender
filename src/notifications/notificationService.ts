import * as Notifications from "expo-notifications";
import type { TemporalEntity } from "../temporal/types";
import { expandRecurrence } from "../temporal/recurrence";

const EVENT_HORIZON_DAYS = 14;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function cancelNotificationIds(ids: string[] | undefined): Promise<void> {
  if (!ids?.length) return;
  await Promise.all(ids.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
}

export async function scheduleReminderNotification(
  entity: TemporalEntity,
  at: number,
): Promise<string | null> {
  if (at <= Date.now()) return null;
  const permitted = await requestNotificationPermission();
  if (!permitted) return null;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: entity.title,
      body: "Your DR Calender reminder is due.",
      sound: "default",
      data: { entityId: entity.id, itemType: entity.itemType, deepLink: `drcalender://reminders/${entity.id}` },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
  });
}

/** Schedules the next 14 days of reminders for a recurring or one-off event. */
export async function scheduleEventNotifications(entity: TemporalEntity): Promise<string[]> {
  await cancelNotificationIds(entity.metadata?.event?.notificationIds);
  const minutesBefore = entity.metadata?.event?.reminderMinutesBefore ?? null;
  if (minutesBefore === null || entity.scheduledAt === null || entity.deletedAt !== null) return [];
  const now = Date.now();
  const horizon = now + EVENT_HORIZON_DAYS * 24 * 60 * 60_000;
  const occurrences = expandRecurrence(entity, {
    rangeStart: now + minutesBefore * 60_000,
    rangeEnd: horizon + minutesBefore * 60_000,
    maxOccurrences: 80,
  });
  const permitted = await requestNotificationPermission();
  if (!permitted) return [];
  const ids: string[] = [];
  for (const occurrence of occurrences) {
    const triggerAt = occurrence.startAt - minutesBefore * 60_000;
    if (triggerAt <= now || triggerAt > horizon) continue;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: entity.title,
        body: minutesBefore === 0 ? "Your event starts now." : `Your event starts in ${minutesBefore >= 1440 ? `${minutesBefore / 1440} day(s)` : minutesBefore >= 60 ? `${minutesBefore / 60} hour(s)` : `${minutesBefore} minutes`}.`,
        sound: "default",
        data: { entityId: entity.id, itemType: "event", occurrenceStartAt: occurrence.startAt, deepLink: `drcalender://events/${entity.id}` },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(triggerAt) },
    });
    ids.push(id);
  }
  return ids;
}
