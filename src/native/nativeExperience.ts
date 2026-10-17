import { requireOptionalNativeModule } from "expo-modules-core";

export type NativeAlarm = {
  id: string;
  title: string;
  body: string;
  triggerAt: number;
};

type DRCalenderNativeModule = {
  isExactAlarmAllowed(): boolean;
  requestExactAlarmPermission(): Promise<boolean>;
  scheduleExactAlarm(id: string, title: string, body: string, triggerAtMillis: number): Promise<boolean>;
  cancelExactAlarm(id: string): Promise<boolean>;
  isExactAlarmScheduled(id: string): Promise<boolean>;
  cancelExactAlarmsExcept(keepIds: string[]): Promise<number>;
  cancelAllManualAlarms(): Promise<number>;
  publishWidgetSnapshot(title: string, dueLabel: string, assignee: string, deepLink: string): Promise<boolean>;
};

const native = requireOptionalNativeModule<DRCalenderNativeModule>("DRCalenderNative");

export function isNativeBridgeAvailable(): boolean {
  return native !== null;
}

export async function isExactAlarmAllowed(): Promise<boolean> {
  return native ? await native.isExactAlarmAllowed() : false;
}

export async function requestExactAlarmPermission(): Promise<boolean> {
  return native ? await native.requestExactAlarmPermission() : false;
}

export async function scheduleNativeAlarm(alarm: NativeAlarm): Promise<boolean> {
  if (!native) return false;
  return native.scheduleExactAlarm(alarm.id, alarm.title, alarm.body, alarm.triggerAt);
}

export async function isNativeAlarmScheduled(id: string): Promise<boolean> {
  if (!native) return false;
  return native.isExactAlarmScheduled(id);
}

export async function cancelNativeAlarm(id: string): Promise<boolean> {
  if (!native) return false;
  return native.cancelExactAlarm(id);
}

export async function publishNativeWidgetSnapshot(input: {
  title: string;
  dueLabel: string;
  assignee: string;
  deepLink: string;
}): Promise<boolean> {
  if (!native) return false;
  return native.publishWidgetSnapshot(input.title, input.dueLabel, input.assignee, input.deepLink);
}

/** Cancels user-managed native event alarms, for example after a full backup restore. */
export async function cancelAllManualNativeAlarms(): Promise<number> {
  if (!native) return 0;
  return native.cancelAllManualAlarms();
}

/** Removes app-managed native alarms that are no longer part of the desired schedule. */
export async function cancelNativeAlarmsExcept(keepIds: string[]): Promise<number> {
  if (!native) return 0;
  return native.cancelExactAlarmsExcept(keepIds);
}
