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
