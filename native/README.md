# Native integration sources

This folder holds native widget source templates for the Expo prebuild application.

## iOS WidgetKit

- Add `ios/CalendarWidget.swift` to a Widget Extension target in Xcode.
- Configure the App Group identifier to match `group.com.drj477.drcalender` for both the main app and widget extension.
- The app must write the `widget.task.*` keys into the shared App Group store and call `WidgetCenter.shared.reloadTimelines(ofKind:)`.
- WidgetKit extension targets and entitlements must be configured through an Expo config plugin or Xcode project configuration; placing this file in the repository alone does not register the extension.

## Android Glance

- Add the source to the Android app module and include the matching AndroidX Glance dependencies.
- Register `CalendarGlanceWidgetReceiver` and its widget metadata XML in the app manifest/resources.
- Publish widget snapshots into the `drcalender_widget` shared preferences and trigger widget updates after committed local changes.

## Alarm limitations

Exact alarm scheduling, full-screen intents, and iOS critical alerts require platform permissions/entitlements and user authorization. These APIs cannot guarantee bypassing all device focus, silent, or manufacturer-specific restrictions.
