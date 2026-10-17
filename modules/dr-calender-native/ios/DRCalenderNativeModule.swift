import ExpoModulesCore
import Foundation
import UserNotifications
import WidgetKit

public final class DRCalenderNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DRCalenderNative")

    Function("isExactAlarmAllowed") { () -> Bool in
      // iOS does not expose Android-style exact-alarm access. Standard local
      // notifications are scheduled at the requested date subject to OS policy.
      return true
    }

    AsyncFunction("requestExactAlarmPermission") { () -> Bool in
      let center = UNUserNotificationCenter.current()
      let settings = await center.notificationSettings()
      if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {
        return true
      }
      return try await center.requestAuthorization(options: [.alert, .sound, .badge])
    }

    AsyncFunction("scheduleExactAlarm") { (id: String, title: String, body: String, triggerAtMillis: Double) async throws -> Bool in
      let fireDate = Date(timeIntervalSince1970: triggerAtMillis / 1000)
      guard fireDate > Date() else {
        throw NSError(domain: "DRCalenderNative", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Alarm must be scheduled in the future."])
      }
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = .default
      content.categoryIdentifier = "DR_CALENDER_ALARM"
      let trigger = UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents(
        [.year, .month, .day, .hour, .minute, .second], from: fireDate), repeats: false)
      try await UNUserNotificationCenter.current().add(UNNotificationRequest(
        identifier: id, content: content, trigger: trigger))
      return true
    }

    AsyncFunction("cancelExactAlarm") { (id: String) async -> Bool in
      UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
      UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
      return true
    }

    AsyncFunction("publishWidgetSnapshot") { (title: String, dueLabel: String, assignee: String, deepLink: String) async -> Bool in
      guard let defaults = UserDefaults(suiteName: "group.com.drj477.drcalender") else {
        throw NSError(domain: "DRCalenderNative", code: 2,
          userInfo: [NSLocalizedDescriptionKey: "App Group is not configured for this app."])
      }
      defaults.set(title, forKey: "widget.task.title")
      defaults.set(dueLabel, forKey: "widget.task.dueLabel")
      defaults.set(assignee, forKey: "widget.task.assignee")
      defaults.set(deepLink, forKey: "widget.task.deepLink")
      WidgetCenter.shared.reloadTimelines(ofKind: "DRCalenderWidget")
      return true
    }
  }
}
