import React, { useMemo, useRef } from "react";
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TemporalEntity } from "../temporal/types";
import { calculateOverlappingLayout } from "../temporal/overlap";

const COLORS = {
  surface: "#141922",
  border: "#252D39",
  text: "#F3F5F8",
  muted: "#8994A5",
  accent: "#B8F36B",
  lavender: "#B7A5FF",
  coral: "#FFAD9B",
};

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
  const duration = Math.max(5 * 60_000, (event.endAt ?? (event.scheduledAt ?? 0) + 30 * 60_000) - (event.scheduledAt ?? 0));
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => { dragY.setValue(0); },
    onPanResponderMove: (_event, gesture) => { dragY.setValue(gesture.dy); },
    onPanResponderRelease: (_event, gesture) => {
      Animated.spring(dragY, { toValue: 0, useNativeDriver: false, damping: 20, stiffness: 220 }).start();
      const deltaMinutes = Math.round((gesture.dy / MINUTE_HEIGHT) / GRID_MINUTES) * GRID_MINUTES;
      if (!deltaMinutes || event.scheduledAt === null) return;
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
      {...responder.panHandlers}
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
      <Pressable onPress={onPress} style={styles.eventPressable} accessibilityRole="button" accessibilityLabel={`Edit ${event.title}`}>
        <Text numberOfLines={1} style={styles.eventTime}>{event.scheduledAt === null ? "" : clockLabel(event.scheduledAt)}{event.endAt ? ` – ${clockLabel(event.endAt)}` : ""}</Text>
        <Text numberOfLines={2} style={styles.eventTitle}>{event.title}</Text>
        {height > 48 && event.metadata?.event?.location ? <Text numberOfLines={1} style={styles.eventLocation}>{event.metadata.event.location}</Text> : null}
      </Pressable>
    </View>
  );
}

export function DayTimeline({ date, events, onEventPress, onEventMove }: DayTimelineProps) {
  const timelineStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), START_HOUR).getTime();
  const timelineEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), END_HOUR).getTime();
  const totalHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
  const layout = useMemo(
    () => calculateOverlappingLayout(events, new Date(timelineStart), { dayEnd: new Date(timelineEnd) }),
    [events, timelineEnd, timelineStart],
  );
  const layoutById = new Map(layout.map(item => [item.id, item]));

  return (
    <ScrollView horizontal={false} nestedScrollEnabled showsVerticalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.scrollContent}>
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
          {events.map(event => {
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
      <Text style={styles.hint}>Drag an event vertically to move it in 15-minute increments.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 6 },
  timeline: { flexDirection: "row" },
  timeRail: { width: LABEL_WIDTH },
  hourLabel: { position: "absolute", right: 6, height: 18, marginTop: -7 },
  hourText: { color: COLORS.muted, fontSize: 9, fontWeight: "600" },
  grid: { flex: 1, position: "relative", borderLeftWidth: 1, borderLeftColor: COLORS.border },
  gridLine: { position: "absolute", left: 0, right: 0, borderTopWidth: 1, borderTopColor: COLORS.border },
  eventBlock: { position: "absolute", borderLeftWidth: 3, borderRadius: 9, backgroundColor: COLORS.surface, borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderTopColor: COLORS.border, borderRightColor: COLORS.border, borderBottomColor: COLORS.border, overflow: "hidden" },
  eventPressable: { flex: 1, paddingHorizontal: 6, paddingVertical: 5, gap: 2 },
  eventTime: { color: COLORS.muted, fontSize: 8, fontWeight: "700" },
  eventTitle: { color: COLORS.text, fontSize: 10, fontWeight: "700" },
  eventLocation: { color: COLORS.muted, fontSize: 8 },
  hint: { color: COLORS.muted, fontSize: 10, paddingTop: 10, paddingLeft: LABEL_WIDTH + 8 },
});
