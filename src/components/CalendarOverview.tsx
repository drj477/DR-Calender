import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TemporalEntity } from "../temporal/types";

const COLORS = {
  surface: "#171C28",
  raised: "#202838",
  border: "#30394B",
  text: "#F4F6FC",
  muted: "#9BA7BA",
  accent: "#FFC247",
  lavender: "#F4C45E",
  coral: "#FF9A63",
};

const SURFACE_SHADOW = { shadowColor: "#000000", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.2, shadowRadius: 11, elevation: 4 };

type OverviewMode = "Week" | "Month";

interface CalendarOverviewProps {
  mode: OverviewMode;
  date: Date;
  events: TemporalEntity[];
  onSelectDate: (date: Date) => void;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function eventsForDate(events: TemporalEntity[], date: Date): TemporalEntity[] {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = start + 24 * 60 * 60_000;
  return events.filter(event =>
    event.scheduledAt !== null &&
    event.scheduledAt < end &&
    (event.endAt ?? event.scheduledAt) >= start,
  ).sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
}

export function CalendarOverview({ mode, date, events, onSelectDate }: CalendarOverviewProps) {
  const days = useMemo(() => {
    if (mode === "Week") {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const weekday = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - weekday);
      return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(start);
        day.setDate(start.getDate() + index);
        return day;
      });
    }
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      return day;
    });
  }, [date, mode]);

  const weekdays = ["M", "T", "W", "T", "F", "S", "S"];

  if (mode === "Week") {
    return (
      <View style={styles.weekContainer}>
        <View style={styles.weekHeader}>
          <Text style={styles.overviewTitle}>This week</Text>
          <Text style={styles.overviewSubtitle}>{days[0]?.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {days[6]?.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Text>
        </View>
        {days.map(day => {
          const dayEvents = eventsForDate(events, day);
          const selected = dayKey(day) === dayKey(date);
          return (
            <Pressable key={dayKey(day)} onPress={() => onSelectDate(day)} style={[styles.weekDay, selected && styles.weekDaySelected]}>
              <View style={styles.weekDayDate}>
                <Text style={[styles.weekdayName, selected && styles.selectedText]}>{day.toLocaleDateString(undefined, { weekday: "short" })}</Text>
                <Text style={[styles.weekdayNumber, selected && styles.selectedText]}>{day.getDate()}</Text>
              </View>
              <View style={styles.weekEventList}>
                {dayEvents.length ? dayEvents.slice(0, 3).map(event => (
                  <View key={event.id} style={[styles.weekEvent, { borderLeftColor: event.isShielded ? COLORS.accent : event.isElastic ? COLORS.coral : COLORS.lavender }]}>
                    <Text numberOfLines={1} style={styles.weekEventTitle}>{event.title}</Text>
                    <Text style={styles.weekEventTime}>{event.scheduledAt === null ? "" : new Date(event.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
                  </View>
                )) : <Text style={styles.noEvents}>No events</Text>}
                {dayEvents.length > 3 ? <Text style={styles.moreEvents}>+{dayEvents.length - 3} more</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={styles.monthContainer}>
      <View style={styles.monthHeader}>
        {weekdays.map((weekday, index) => <Text key={`${weekday}-${index}`} style={styles.monthWeekday}>{weekday}</Text>)}
      </View>
      <View style={styles.monthGrid}>
        {days.map(day => {
          const selected = dayKey(day) === dayKey(date);
          const inMonth = day.getMonth() === date.getMonth();
          const count = eventsForDate(events, day).length;
          return (
            <Pressable key={dayKey(day)} onPress={() => onSelectDate(day)} style={[styles.monthDay, selected && styles.monthDaySelected]}>
              <Text style={[styles.monthDayNumber, !inMonth && styles.outsideMonth, selected && styles.selectedText]}>{day.getDate()}</Text>
              <View style={styles.monthDots}>
                {Array.from({ length: Math.min(count, 3) }, (_, index) => <View key={index} style={[styles.monthDot, selected && styles.monthDotSelected]} />)}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.monthFooter}>
        <Text style={styles.overviewTitle}>{date.toLocaleDateString(undefined, { month: "long", day: "numeric" })}</Text>
        <Text style={styles.overviewSubtitle}>{eventsForDate(events, date).length} events · Tap a date to open its day view</Text>
        <Pressable onPress={() => onSelectDate(date)} style={styles.openDayButton}><Text style={styles.openDayText}>Open selected day →</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  weekContainer: { gap: 9 },
  weekHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 },
  overviewTitle: { color: COLORS.text, fontSize: 14, fontWeight: "800" },
  overviewSubtitle: { color: COLORS.muted, fontSize: 10, marginTop: 5 },
  weekDay: { flexDirection: "row", gap: 12, padding: 12, borderRadius: 15, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, minHeight: 74, ...SURFACE_SHADOW },
  weekDaySelected: { borderColor: COLORS.accent, backgroundColor: "#242A32" },
  weekDayDate: { width: 44, alignItems: "center", justifyContent: "center", gap: 5 },
  weekdayName: { color: COLORS.muted, fontSize: 10, fontWeight: "700" },
  weekdayNumber: { color: COLORS.text, fontSize: 17, fontWeight: "800" },
  selectedText: { color: COLORS.accent },
  weekEventList: { flex: 1, gap: 4, justifyContent: "center" },
  weekEvent: { borderLeftWidth: 2, paddingLeft: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 18 },
  weekEventTitle: { color: COLORS.text, fontSize: 10, fontWeight: "600", flex: 1 },
  weekEventTime: { color: COLORS.muted, fontSize: 9 },
  noEvents: { color: COLORS.muted, fontSize: 10 },
  moreEvents: { color: COLORS.accent, fontSize: 9, fontWeight: "700" },
  monthContainer: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 19, padding: 13, ...SURFACE_SHADOW },
  monthHeader: { flexDirection: "row", marginBottom: 8 },
  monthWeekday: { width: "14.2857%", textAlign: "center", color: COLORS.muted, fontSize: 10, fontWeight: "800", paddingVertical: 8 },
  monthGrid: { flexDirection: "row", flexWrap: "wrap" },
  monthDay: { width: "14.2857%", height: 49, alignItems: "center", paddingTop: 7, borderRadius: 9 },
  monthDaySelected: { backgroundColor: "#322817", borderWidth: 1, borderColor: COLORS.accent },
  monthDayNumber: { color: COLORS.text, fontSize: 12, fontWeight: "600" },
  outsideMonth: { color: "#596274" },
  monthDots: { flexDirection: "row", gap: 3, marginTop: 5, height: 4 },
  monthDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.lavender },
  monthDotSelected: { backgroundColor: COLORS.accent },
  monthFooter: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 10, paddingTop: 13 },
  openDayButton: { alignSelf: "flex-start", marginTop: 10, backgroundColor: "#322817", borderWidth: 1, borderColor: "#72551C", paddingVertical: 10, paddingHorizontal: 13, borderRadius: 11 },
  openDayText: { color: COLORS.accent, fontSize: 11, fontWeight: "700" },
});
