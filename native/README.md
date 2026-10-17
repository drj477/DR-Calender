# Native integration and platform boundaries

## Local Expo module

The app now includes `modules/dr-calender-native` and autolinks it through the `expo.autolinking.nativeModulesDir` package setting. `plugins/withDRCalenderNative.js` adds the Android exact-alarm permission and the iOS App Group entitlement `group.com.drj477.drcalender`.

The native module exposes:

- `isExactAlarmAllowed()`
- `requestExactAlarmPermission()`
- `scheduleExactAlarm(id, title, body, triggerAtMillis)`
- `cancelExactAlarm(id)`
- `cancelExactAlarmsExcept(keepIds)` for removing stale app-managed event alarms during reconciliation
- `publishWidgetSnapshot(title, dueLabel, assignee, deepLink)`

After adding/changing native module code or configuration, regenerate/rebuild the native app. Expo Go does not contain this project-specific module.

## Android Glance widget

The module declares `CalendarGlanceWidgetReceiver`, the widget metadata XML, and the Glance dependencies. It reads `task_title`, `task_due`, `task_assignee`, and `task_deep_link` from `drcalender_widget` preferences. Publishing a snapshot updates registered Glance widget instances. The widget opens the supplied `drcalender://` deep link. The app handles task routes (`drcalender://tasks`) and event routes (`drcalender://events/<event-id>`) on warm and cold launch.

Android exact alarms use `AlarmManager.setAlarmClock` and a private broadcast receiver. Scheduled alarm IDs, times, titles, and bodies are persisted in private app preferences. A restoration receiver listens for reboot, wall-clock/time-zone changes, and exact-alarm permission changes, then re-registers future alarms. Android 12+ requires user-granted exact-alarm access. Alarm delivery notifications also depend on notification permission and system policy. No full-screen intent is declared.

## iOS notifications and WidgetKit

The app-side native module schedules/cancels standard `UNUserNotificationCenter` requests and writes `widget.task.*` keys to the `group.com.drj477.drcalender` App Group before requesting a WidgetKit timeline reload.

**Still required for a visible iOS widget:** add `native/ios/CalendarWidget.swift` to a Widget Extension target and configure that extension's App Group entitlement to the same identifier. Widget source is now present in the repository, but the current config plugin only sets the App Group on the app target; it does not create the WidgetKit extension target automatically. Critical-alert entitlement and authorization are not included. iOS does not provide Android-style exact-alarm permission.

## Delivery scope

The app now reconciles a rolling 30-day window of native alarms for events with an explicit reminder offset, expands recurring instances, skips excluded occurrences, respects moved occurrence overrides, and removes stale app-managed alarms after edits/deletions/completion. Android and iOS native alarm notifications attach event deep links; widget task/event links are routed by the app. Native alarm scheduling remains dependent on OS permissions, and events without explicit reminder offsets are not promoted to native alarms. Fully automatic iOS Widget Extension target creation remains open. Native code has not been compiled or tested as requested.
