/** Shared domain contracts for DR-Calender Phase 1. */
export type ItemType = "event" | "task" | "reminder" | "alarm";

export type TemporalPriority = "low" | "normal" | "high" | "critical";

export type RSVPStatus = "needs-action" | "accepted" | "declined" | "tentative";

export type EventKind = "standard" | "all-day" | "milestone";
export type CommitmentKind = "hard" | "elastic";

export interface TemporalEntity {
  id: string;
  workspaceId: string;
  itemType: ItemType;
  title: string;
  /** UTC epoch milliseconds; null means not scheduled at a fixed time. */
  scheduledAt: number | null;
  /** UTC epoch milliseconds; null for point-in-time or floating items. */
  endAt: number | null;
  isCompleted: boolean;
  priority: TemporalPriority;
  isShielded: boolean;
  isElastic: boolean;
  isGhost: boolean;
  ghostClusterId: string | null;
  assignedUserIds: string[];
  /** RFC 5545 recurrence rule without DTSTART. */
  rrule: string | null;
  /** Monotonically increasing local entity version for sync bookkeeping. */
  syncVersion: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  timeZone: string;
  metadata?: TemporalMetadata;
}

export interface AssigneeDTO {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Strict task-facing presentation contract. Keep these three fields available
 * in both in-app and widget task rows.
 */
export interface TaskItemDTO {
  title: string;
  dueAt: number | null;
  assignee: AssigneeDTO;
}

export interface EventMetadata {
  kind: EventKind;
  commitment: CommitmentKind;
  location: string | null;
  meetingUrl: string | null;
  organizerUserId: string | null;
  attendeeUserIds: string[];
  travelBufferMinutes: number | null;
  cooldownBufferMinutes: number | null;
  reminderMinutesBefore?: number | null;
  notificationIds?: string[];
}

export interface ReminderMetadata {
  trigger:
    | { kind: "time"; at: number }
    | { kind: "geofence-enter"; address: string; latitude?: number; longitude?: number }
    | { kind: "geofence-exit"; address: string; latitude?: number; longitude?: number };
  snoozeUntil: number | null;
  snoozeCount: number;
  notificationId?: string | null;
}

export interface AlarmMetadata {
  soundUri: string | null;
  ringDuration: number;
  /** A request to use supported OS capabilities, not a guarantee to bypass settings. */
  overrideSilentMode: boolean;
  snoozeCount: number;
}

export interface InviteAttendee {
  email: string;
  displayName: string | null;
  userId: string | null;
  rsvpStatus: RSVPStatus;
}

export interface InviteMetadata {
  organizerEmail: string;
  attendeeList: InviteAttendee[];
  rsvpStatus: RSVPStatus;
  icsUid: string;
  sequence: number;
}

export interface GhostCluster {
  id: string;
  workspaceId: string;
  entityId: string;
  candidateSlotIds: string[];
  expiresAt: number | null;
  confirmedSlotId: string | null;
  updatedAt: number;
}

export interface GhostCandidateSlot {
  id: string;
  clusterId: string;
  scheduledAt: number;
  endAt: number;
  timeZone: string;
}

export interface ChecklistItem {
  id: string;
  title: string;
  isCompleted: boolean;
  assignedUserId: string | null;
  updatedAt: number;
}

export interface RecurrenceOverride {
  startAt: number;
  endAt: number;
  title: string;
  location: string | null;
  isShielded: boolean;
  isElastic: boolean;
  isAllDay?: boolean;
}

export interface RecurrenceExceptions {
  /** Original generated occurrence start timestamps used as stable exception keys. */
  excludedStartsAt: number[];
  overrides: Record<string, RecurrenceOverride>;
}

export interface TemporalMetadata {
  recurrence?: RecurrenceExceptions;
  event?: EventMetadata;
  reminder?: ReminderMetadata;
  alarm?: AlarmMetadata;
  invite?: InviteMetadata;
  task?: {
    dueAt: number | null;
    assignee: AssigneeDTO;
    reminderMinutesBefore?: number | null;
    notificationId?: string | null;
  };
}

export interface WidgetTaskSnapshot {
  id: string;
  title: string;
  dueAt: number | null;
  assignee: AssigneeDTO;
  isCompleted: boolean;
  priority: TemporalPriority;
  deepLink: string;
}

export interface WidgetEventSnapshot {
  id: string;
  title: string;
  startsAt: number;
  endsAt: number | null;
  location: string | null;
  meetingUrl: string | null;
  deepLink: string;
}

export interface WidgetSnapshotDTO {
  schemaVersion: 1;
  generatedAt: number;
  timeZone: string;
  nextEvent: WidgetEventSnapshot | null;
  tasks: WidgetTaskSnapshot[];
  /** Compact lock-screen / Live Activity representation. */
  lockScreen: {
    title: string;
    startsAt: number | null;
    countdownSeconds: number | null;
    deepLink: string | null;
  };
}

/** The minimal mutation envelope persisted to an outbox for sync delivery. */
export interface SyncMutation<TPayload = unknown> {
  mutationId: string;
  workspaceId: string;
  entityId: string;
  entityType: ItemType;
  operation: "upsert" | "delete";
  payload: TPayload;
  syncVersion: number;
  createdAt: number;
  retryCount: number;
}

export function isValidTimeRange(
  startsAt: number | null,
  endsAt: number | null,
): boolean {
  if (startsAt === null || endsAt === null) return true;
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt > startsAt;
}
