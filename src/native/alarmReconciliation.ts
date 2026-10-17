import { Platform } from "react-native";
import type { TemporalEntity } from "../temporal/types";
import { expandRecurrence } from "../temporal/recurrence";
import { cancelNativeAlarm, cancelNativeAlarmsExcept, isExactAlarmAllowed, isNativeBridgeAvailable, scheduleNativeAlarm } from "./nativeExperience";

const HORIZON_DAYS = 30;
const MAX_ALARMS = 120;

/**
 * Android uses AlarmManager for exact event delivery. iOS stays on the Expo
 * notification path so a second UNUserNotificationCenter request cannot duplicate
 * the same reminder. Only events with an explicit reminder offset are promoted.
 */
export async function reconcileNativeEventAlarms(entities: TemporalEntity[]): Promise<{scheduled:number;cancelled:number;skipped:boolean}> {
  if (Platform.OS !== "android" || !isNativeBridgeAvailable()) return {scheduled:0,cancelled:0,skipped:true};
  if (!await isExactAlarmAllowed()) {
    let cancelled = 0;
    try { cancelled = await cancelNativeAlarmsExcept([]); }
    catch (error) { console.warn("Unable to clear native alarms while exact-alarm access is unavailable",error); }
    return {scheduled:0,cancelled,skipped:true};
  }

  const now = Date.now();
  const horizon = now + HORIZON_DAYS * 24 * 60 * 60_000;
  const desired = new Map<string,{id:string;title:string;body:string;triggerAt:number}>();
  for (const entity of entities) {
    if (entity.itemType !== "event" || entity.deletedAt !== null || entity.isCompleted || entity.scheduledAt === null) continue;
    const reminder = entity.metadata?.event?.reminderMinutesBefore;
    if (reminder == null) continue;
    try {
      const occurrences = expandRecurrence(entity,{rangeStart:now-24*60*60_000,rangeEnd:horizon,maxOccurrences:MAX_ALARMS});
      const expandedOriginalStarts = new Set(occurrences.map(occurrence=>String(occurrence.startAt)));
      for (const occurrence of occurrences) {
        const recurrence = entity.metadata?.recurrence;
        if (recurrence?.excludedStartsAt.includes(occurrence.startAt)) continue;
        const override = recurrence?.overrides[String(occurrence.startAt)];
        const startAt = override?.startAt ?? occurrence.startAt;
        const triggerAt = startAt - Math.max(0,reminder) * 60_000;
        if (triggerAt <= now || triggerAt > horizon) continue;
        const id = "native-event-auto-" + entity.id + "-" + occurrence.startAt;
        const title = override?.title ?? entity.title;
        desired.set(id,{id,title,body:reminder>0 ? title+" starts in "+reminder+" minute(s)." : title+" starts now.",triggerAt});
      }
      // A moved exception can enter the horizon even when its original RRULE
      // date does not. Keep the original occurrence start as the stable identity.
      for (const [originalStartKey, override] of Object.entries(entity.metadata?.recurrence?.overrides ?? {})) {
        const originalStart = Number(originalStartKey);
        if (expandedOriginalStarts.has(originalStartKey) || entity.metadata?.recurrence?.excludedStartsAt.includes(originalStart)) continue;
        const triggerAt = override.startAt - Math.max(0,reminder) * 60_000;
        if (triggerAt <= now || triggerAt > horizon) continue;
        const id = "native-event-auto-" + entity.id + "-" + originalStartKey;
        const title = override.title ?? entity.title;
        desired.set(id,{id,title,body:reminder>0 ? title+" starts in "+reminder+" minute(s)." : title+" starts now.",triggerAt});
      }
    } catch (error) {
      console.warn("Unable to expand native alarm occurrences for "+entity.id,error);
    }
  }

  const alarms = [...desired.values()].sort((a,b)=>a.triggerAt-b.triggerAt).slice(0,MAX_ALARMS);
  const keep = alarms.map(alarm=>alarm.id);
  let scheduled=0;
  for (const alarm of alarms) {
    try {
      if (await scheduleNativeAlarm(alarm)) scheduled++;
    } catch (error) {
      console.warn("Unable to reconcile native alarm "+alarm.id,error);
    }
  }
  let cancelled=0;
  try { cancelled=await cancelNativeAlarmsExcept(keep); }
  catch (error) { console.warn("Unable to cancel stale native alarms",error); }
  return {scheduled,cancelled,skipped:false};
}

/** Cancels all native alarms for a deleted or disabled event series. */
export async function cancelNativeEventAlarms(eventId:string):Promise<void> {
  await cancelNativeAlarm("native-event-manual-"+eventId);
  // Occurrence alarms are removed by the next workspace reconciliation.
}
