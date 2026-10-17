import SwiftUI
import WidgetKit

private let appGroupID = "group.com.drj477.drcalender"

struct CalendarWidgetEntry: TimelineEntry {
    let date: Date
    let title: String
    let dueLabel: String
    let assignee: String
    let deepLink: URL?
}

struct CalendarWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> CalendarWidgetEntry {
        CalendarWidgetEntry(date: .now, title: "Review project plan", dueLabel: "Today, 4:00 PM", assignee: "DR", deepLink: URL(string: "drcalender://tasks"))
    }

    func getSnapshot(in context: Context, completion: @escaping (CalendarWidgetEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CalendarWidgetEntry>) -> Void) {
        let entry = loadEntry()
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: .now) ?? .now.addingTimeInterval(900)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }

    private func loadEntry() -> CalendarWidgetEntry {
        let defaults = UserDefaults(suiteName: appGroupID)
        let title = defaults?.string(forKey: "widget.task.title") ?? "Nothing urgent"
        let dueLabel = defaults?.string(forKey: "widget.task.dueLabel") ?? "You're all caught up"
        let assignee = defaults?.string(forKey: "widget.task.assignee") ?? "DR"
        let urlString = defaults?.string(forKey: "widget.task.deepLink") ?? "drcalender://tasks"
        return CalendarWidgetEntry(date: .now, title: title, dueLabel: dueLabel, assignee: assignee, deepLink: URL(string: urlString))
    }
}

struct CalendarWidgetView: View {
    let entry: CalendarWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("UP NEXT")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .tracking(1.6)
                    .foregroundStyle(.secondary)
                Spacer()
                Image(systemName: "calendar")
                    .foregroundStyle(Color(red: 0.72, green: 0.95, blue: 0.42))
            }
            Link(destination: entry.deepLink ?? URL(string: "drcalender://tasks")!) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(entry.title)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .lineLimit(2)
                        .foregroundStyle(.primary)
                    Text(entry.dueLabel)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                Text(entry.assignee)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.black)
                    .frame(width: 23, height: 23)
                    .background(Color(red: 0.72, green: 0.95, blue: 0.42), in: RoundedRectangle(cornerRadius: 8))
                Text("Assigned to")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                Text(entry.assignee)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.primary)
            }
        }
        .padding(16)
        .containerBackground(Color(red: 0.08, green: 0.10, blue: 0.13), for: .widget)
    }
}

@main
struct DRCalenderWidget: Widget {
    let kind = "DRCalenderWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CalendarWidgetProvider()) { entry in
            CalendarWidgetView(entry: entry)
        }
        .configurationDisplayName("DR Calender")
        .description("Your next task, due time, and assignee at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}
