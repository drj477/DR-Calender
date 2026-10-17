import React, { useMemo, useRef } from "react";
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TemporalEntity } from "../temporal/types";
import { calculateOverlappingLayout } from "../temporal/overlap";
import { resizeTemporalRange } from "../temporal/drag";

const COLORS = {
  surface: "#171C28",
  border: "#30394B",
  text: "#F4F6FC",
  muted: "#9BA7BA",
  accent: "#FFC247",
  lavender: "#F4C45E",
  coral: "#FF9A63",
};

const EVENT_SHADOW = { shadowColor: "#000000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 8, elevation: 4 };

const START_HOUR = 6;
const END_HOUR = 22;
const HOUR_HEIGHT = 64;
const MINUTE_HEIGHT = HOUR_HEIGHT / 60;
const GRID_MINUTES = 15;
const LABEL_WIDTH = 44;

interface DayTimelineProps {
  date: Date;
  events: TemporalEntity[];
  onEventPress: (event: TemporalEntity) => void;
  onEventMove: (event: TemporalEntity, nextStartAt: number, nextEndAt: number) => void;
}

function clockLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function DraggableEvent({
  event,
  top,
  height,
  left,
  width,
  onPress,
  onMove,
}: {
  event: TemporalEntity;
  top: number;
  height: number;
  left: string;
  width: string;
  onPress: () => void;
  onMove: (event: TemporalEntity, startAt: number, endAt: number) => void;
}) {
  const dragY = useRef(new Animated.Value(0)).current;
  const startResizeY = useRef(new Animated.Value(0)).current;
  const endResizeY = useRef(new Animated.Value(0)).current;
  const duration = Math.max(5 * 60_000, (event.endAt ?? (event.scheduledAt ?? 0) + 30 * 60_000) - (event.scheduledAt ?? 0));
  const eventStart = event.scheduledAt ?? 0;
  const eventEnd = event.endAt ?? eventStart + duration;
  const dayStart = new Date(eventStart);
  dayStart.setHours(START_HOUR, 0, 0, 0);
  const dayEnd = new Date(eventStart);
  dayEnd.setHours(END_HOUR, 0, 0, 0);
  const makeResizeResponder = (edge: "start" | "end", animated: Animated.Value) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 2,
    onPanResponderGrant: () => animated.setValue(0),
    onPanResponderMove: (_event, gesture) => animated.setValue(gesture.dy),
    onPanResponderRelease: (_event, gesture) => {
      Animated.spring(animated, { toValue: 0, useNativeDriver: false, damping: 20, stiffness: 220 }).start();
      const proposedAt = (edge === "start" ? eventStart : eventEnd) + gesture.dy / MINUTE_HEIGHT * 60_000;
      const next = resizeTemporalRange(
        { startAt: eventStart, endAt: eventEnd },
        edge,
        proposedAt,
        { snapMinutes: GRID_MINUTES, minimumDurationMinutes: 15, dayStartAt: dayStart.getTime(), dayEndAt: dayEnd.getTime() },
      );
      if (next.startAt !== eventStart || next.endAt !== eventEnd) onMove(event, next.startAt, next.endAt);
    },
  });
  const startResizeResponder = useMemo(() => makeResizeResponder("start", startResizeY), [event, onMove]);
  const endResizeResponder = useMemo(() => makeResizeResponder("end", endResizeY), [event, onMove]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) =>
      (Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx)) ||
      (Math.abs(gesture.dx) > 45 && Math.abs(gesture.dx) > Math.abs(gesture.dy)),
    onPanResponderGrant: () => { dragY.setValue(0); },
    onPanResponderMove: (_event, gesture) => { dragY.setValue(gesture.dy); },
    onPanResponderRelease: (_event, gesture) => {
      Animated.spring(dragY, { toValue: 0, useNativeDriver: false, damping: 20, stiffness: 220 }).start();
      if (event.scheduledAt === null) return;
      if (Math.abs(gesture.dx) > 45 && Math.abs(gesture.dx) > Math.abs(gesture.dy)) {
        const nextStart = event.scheduledAt + (gesture.dx < 0 ? 1 : -1) * 24 * 60 * 60_000;
        onMove(event, nextStart, nextStart + duration);
        return;
      }
      const deltaMinutes = Math.round((gesture.dy / MINUTE_HEIGHT) / GRID_MINUTES) * GRID_MINUTES;
      if (!deltaMinutes) return;
      const dayStart = new Date(event.scheduledAt);
      dayStart.setHours(START_HOUR, 0, 0, 0);
      const dayEnd = new Date(event.scheduledAt);
      dayEnd.setHours(END_HOUR, 0, 0, 0);
      const minStart = dayStart.getTime();
      const maxStart = dayEnd.getTime() - duration;
      const nextStart = Math.max(minStart, Math.min(maxStart, event.scheduledAt + deltaMinutes * 60_000));
      if (nextStart !== event.scheduledAt) onMove(event, nextStart, nextStart + duration);
    },
  }), [duration, event, onMove, top]);

  const color = event.isShielded ? COLORS.accent : event.isElastic ? COLORS.coral : COLORS.lavender;
  return (
    <View
      {...(!event.rrule ? responder.panHandlers : {})}
      style={[
        styles.eventBlock,
        {
          top,
          height,
          left,
          width,
          borderLeftColor: color,
        },
        { transform: [{ translateY: dragY }] },
      ]}
    >
      {!event.rrule ? (
        <View style={styles.resizeStart} {...startResizeResponder.panHandlers}>
          <View style={styles.resizeGrip} />
        </View>
      ) : null}
      <Pressable onPress={onPress} style={styles.eventPressable} accessibilityRole="button" accessibilityLabel={`Edit ${event.title}`}>
        <Text numberOfLines={1} style={styles.eventTime}>{event.scheduledAt === null ? "" : clockLabel(event.scheduledAt)}{event.endAt ? ` – ${clockLabel(event.endAt)}` : ""}</Text>
        <Text numberOfLines={2} style={styles.eventTitle}>{event.title}</Text>
        {height > 48 && event.metadata?.event?.location ? <Text numberOfLines={1} style={styles.eventLocation}>{event.metadata.event.location}</Text> : null}
      </Pressable>
      {!event.rrule ? (
        <View style={styles.resizeEnd} {...endResizeResponder.panHandlers}>
          <View style={styles.resizeGrip} />
        </View>
      ) : null}
    </View>
  );
}

export function DayTimeline({ date, events, onEventPress, onEventMove }: DayTimelineProps) {
  const timelineStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), START_HOUR).getTime();
  const timelineEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), END_HOUR).getTime();
  const totalHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
  const allDayEvents = events.filter(event => event.metadata?.event?.kind === "all-day");
  const timedEvents = events.filter(event => event.metadata?.event?.kind !== "all-day");
  const layout = useMemo(
    () => calculateOverlappingLayout(timedEvents, new Date(timelineStart), { dayEnd: new Date(timelineEnd) }),
    [timedEvents, timelineEnd, timelineStart],
  );
  const layoutById = new Map(layout.map(item => [item.id, item]));

  return (
    <ScrollView horizontal={false} nestedScrollEnabled showsVerticalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {allDayEvents.length > 0 ? <View style={styles.allDayLane}><Text style={styles.allDayLabel}>ALL DAY</Text><View style={styles.allDayList}>{allDayEvents.map(event => <Pressable key={event.id} onPress={() => onEventPress(event)} accessibilityRole="button" accessibilityLabel={`Edit all-day event ${event.title}`} style={styles.allDayChip}><Text numberOfLines={1} style={styles.allDayChipText}>{event.title}</Text></Pressable>)}</View></View> : null}
      <View style={[styles.timeline, { height: totalHeight }]}>
        <View style={styles.timeRail}>
          {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => {
            const hour = START_HOUR + index;
            const timestamp = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour).getTime();
            return (
              <View key={hour} style={[styles.hourLabel, { top: index * HOUR_HEIGHT }]}>
                <Text style={styles.hourText}>{new Date(timestamp).toLocaleTimeString([], { hour: "numeric", hour12: true }).replace(" ", "").toUpperCase()}</Text>
              </View>
            );
          })}
        </View>
        <View style={[styles.grid, { height: totalHeight }]}>
          {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => (
            <View key={index} style={[styles.gridLine, { top: index * HOUR_HEIGHT }]} />
          ))}
          {timedEvents.map(event => {
            const position = layoutById.get(event.id);
            if (!position) return null;
            const top = (position.startAt - timelineStart) * MINUTE_HEIGHT / 60_000;
            const height = Math.max(34, (position.endAt - position.startAt) * MINUTE_HEIGHT / 60_000);
            const left = `${position.leftFraction * 100}%`;
            const width = `${position.widthFraction * 100}%`;
            return (
              <DraggableEvent
                key={event.id}
                event={event}
                top={top}
                height={height}
                left={left}
                width={width}
                onPress={() => onEventPress(event)}
                onMove={onEventMove}
              />
            );
          })}
        </View>
      </View>
      <Text style={styles.hint}>Drag one-time events to move or resize. Recurring events are series-managed; tap one to edit the entire series.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 6 },
  allDayLane: { flexDirection: "row", gap: 10, padding: 10, marginBottom: 10, backgroundColor: "#171C28", borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  allDayLabel: { color: COLORS.accent, fontSize: 9, fontWeight: "800", width: LABEL_WIDTH - 8, paddingTop: 6 },
  allDayList: { flex: 1, gap: 5 },
  allDayChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: "#322817", borderLeftWidth: 3, borderLeftColor: COLORS.accent },
  allDayChipText: { color: COLORS.text, fontSize: 11, fontWeight: "700" },
  timeline: { flexDirection: "row" },
  timeRail: { width: LABEL_WIDTH },
  hourLabel: { position: "absolute", right: 6, height: 18, marginTop: -7 },
  hourText: { color: COLORS.muted, fontSize: 9, fontWeight: "600" },
  grid: { flex: 1, position: "relative", borderLeftWidth: 1, borderLeftColor: COLORS.border },
  gridLine: { position: "absolute", left: 0, right: 0, borderTopWidth: 1, borderTopColor: COLORS.border },
  eventBlock: { position: "absolute", borderLeftWidth: 3, borderRadius: 11, backgroundColor: COLORS.surface, borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderTopColor: COLORS.border, borderRightColor: COLORS.border, borderBottomColor: COLORS.border, overflow: "hidden", ...EVENT_SHADOW },
  resizeStart: { height: 9, alignItems: "center", justifyContent: "center", zIndex: 2 },
  resizeEnd: { height: 9, alignItems: "center", justifyContent: "center", zIndex: 2 },
  resizeGrip: { width: 24, height: 4, borderRadius: 2, backgroundColor: COLORS.accent, opacity: 0.95 },
  eventPressable: { flex: 1, paddingHorizontal: 6, paddingVertical: 1, gap: 2 },
  eventTime: { color: COLORS.muted, fontSize: 8, fontWeight: "700" },
  eventTitle: { color: COLORS.text, fontSize: 10, fontWeight: "800", letterSpacing: 0.1 },
  eventLocation: { color: COLORS.muted, fontSize: 8 },
  hint: { color: COLORS.muted, fontSize: 10, paddingTop: 10, paddingLeft: LABEL_WIDTH + 8 },
});
