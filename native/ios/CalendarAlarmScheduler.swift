import Foundation
import UserNotifications

/// Native service template for local calendar alarms.
/// Critical-alert delivery requires Apple's entitlement and explicit user authorization.
final class CalendarAlarmScheduler {
    private let center = UNUserNotificationCenter.current()

    func requestAuthorization(completion: @escaping (Bool, Error?) -> Void) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            completion(granted, error)
        }
    }

    func schedule(
        identifier: String,
        title: String,
        body: String,
        fireAt: Date,
        soundName: String? = nil
    ) async throws {
        guard fireAt > Date() else {
            throw NSError(
                domain: "DRCalenderAlarm",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Alarm fire time must be in the future."]
            )
        }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = soundName.map { UNNotificationSound(named: UNNotificationSoundName($0)) } ?? .default

        var date = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: fireAt
        )
        date.calendar = Calendar.current
        let trigger = UNCalendarNotificationTrigger(dateMatching: date, repeats: false)
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
        try await center.add(request)
    }

    func cancel(identifier: String) {
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
    }
}
