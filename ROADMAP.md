# DR-Calender — Delivery Phases

The project will be built in substantial, user-facing phases. Implementation comes before the dedicated test/build pass, as requested. Each phase should land as a coherent feature group rather than a stream of tiny polish-only commits.

## Phase 1 — Calendar reliability and event model
**Goal:** Make calendar behavior predictable before adding more surface area.

- Correct monthly recurrence defaults: repeat on the original day-of-month; skip months that do not contain that date.
- Finish all-day and multi-day event semantics across the editor, persistence, and calendar views.
- Make event time-zone handling explicit in create/edit flows and recurrence behavior.
- Tighten occurrence-versus-series operations and preserve exception identity when the series changes.
- Improve validation and clear user-facing errors for invalid schedules.

**Current progress:** Implemented: monthly default-day behavior, all-day/multi-day semantics across editor and calendar views, and recurrence occurrence exceptions. Per-event time-zone selection and exhaustive RFC 5545 DST gap/fold handling remain outside this phase.

## Phase 2 — Reminders and notifications
**Goal:** Turn scheduled events into dependable reminders.

- Persist reminder rules per event/task, including relative offsets and custom reminder times. **Implemented:** event offsets and task due-time alerts are persisted locally.
- Add notification scheduling/cancellation when events are created, edited, moved, completed, or deleted. **Implemented for events and task completion:** reconciliation handles event moves, series changes, occurrence edits/exclusions, and deletion.
- Handle recurring occurrence reminders and edits/exclusions without duplicate notifications. **Implemented:** rolling 14-day scheduling filters exclusions and uses moved occurrence overrides.
- Add permission onboarding, notification preferences, and a reminder management surface. **Implemented:** permission flow and a Reminders screen with create, snooze, complete, and delete actions.
- Native exact-alarm bridge remains open: the existing iOS/Android alarm templates are not registered as a native Expo module. Phase 2 currently uses standard OS local notifications; exact Android alarms, receiver/full-screen behavior, and iOS critical alerts remain native-target integration work.

## Phase 3 — Tasks and daily planning
**Goal:** Make the app useful as a daily planner, not just a calendar grid.

- **Implemented:** dedicated task inbox with Inbox / Today / Upcoming / Overdue / Completed filters, task create/edit, due date/time or unscheduled capture, priority, completion, and persisted checklists.
- **Implemented:** overdue identification and one-tap rollover to today; task delete uses local tombstones and the sync outbox.
- **Implemented:** “Plan my day” assigns unscheduled and overdue tasks into 30-minute free slots from 9 AM–6 PM, prioritizing critical/high tasks and respecting existing timed events/tasks.
- **Implemented:** task edits, checklist changes, completion, rollover, deletion, and auto-planning are persisted locally through the temporal repository and enqueue outbox mutations.
- Day agenda summaries and configurable task durations remain follow-up work; auto-planning currently uses a fixed 30-minute task block and local device time.

## Phase 4 — Offline-first sync, accounts, and workspaces
**Goal:** Safely synchronize data across devices and collaborators.

- **Implemented:** Supabase Auth email sign-up/sign-in, SecureStore-backed session persistence, refresh-token lifecycle, and sign-out.
- **Implemented:** Supabase RPC sync transport, SQLite sync cursor/clock persistence, workspace-filtered outbox batches, idempotent mutation acknowledgements, retries/error recording, and HLC/LWW merge orchestration.
- **Implemented:** SQL migration for workspace membership, server-side authorization checks, workspace listing/creation, revision-cursor pull, and mutation push.
- **Implemented:** Account & sync UI, project configuration, manual sync, offline/error/success feedback, cloud workspace creation, local workspace activation, workspace-scoped hydration, and owner/admin addition of registered users as editors/viewers.
- **Deployment required:** Apply `supabase/migrations/202610180001_phase4_sync_workspaces.sql` to a Supabase project and configure its URL/public key in the app. See `SUPABASE_SETUP.md`.
- **Remaining:** Pending email invitations, member removal/role changes, field-level conflict resolution, background sync, and push-based invalidation. The phase has not been tested or built yet by request.

## Phase 5 — Sharing and interoperability
**Goal:** Make calendars portable and collaborative.

- **Implemented:** Multi-event ICS import with preview, input-size/event-count limits, UID duplicate detection, skip/update strategy, and validation of required start and end ranges.
- **Implemented:** ICS export of timed/all-day events, IANA time-zone wall times, RRULEs, EXDATE exclusions, moved recurrence overrides, organizer, attendees, and RSVP state.
- **Implemented:** Event invitation sharing through the system share sheet, attendee addition, RSVP status updates, and local outbox persistence so changes sync with the workspace.
- **Implemented:** Public HTTPS calendar subscription management with saved feed URLs, manual refresh, last-refresh/error status, and UID-based update behavior.
- **Permission boundary:** Workspace access is governed by Phase 4 workspace roles. Event attendees are invitation metadata and do not independently grant access to private workspace data.
- **Remaining:** Native document/file picker import and direct .ics attachment creation, authenticated calendar feeds, full VTIMEZONE component generation, per-event ACLs, and push-based subscription refresh. No tests/build/type checks have been run by request.

## Phase 6 — Native experience and widgets
**Goal:** Make DR-Calender feel integrated with the operating system.

- **Implemented in source:** Local Expo module under `modules/dr-calender-native`, configured for Android and Apple autolinking, plus a config plugin for Android exact-alarm permission and the iOS App Group entitlement.
- **Implemented for Android:** AlarmManager `setAlarmClock` scheduling, exact-alarm permission request/status, native broadcast receiver, high-priority alarm notification, Glance home-screen widget, widget provider metadata, and explicit widget snapshot refresh.
- **Implemented for iOS app integration:** Native Expo module schedules/cancels standard local notifications and publishes shared widget snapshots through the App Group, then requests WidgetKit timeline refresh.
- **Implemented in the app:** Native tab exposes bridge/permission state and lets the user schedule/cancel a native alarm for upcoming events. Calendar/task changes publish the next task or event to the native widget snapshot bridge.
- **Deep links:** Widget tap targets use the registered `drcalender://` scheme.
- **Important platform boundary:** Android widget receiver and resources are declared in the local native module. The iOS WidgetKit extension target and its separate App Group entitlement still require Xcode/EAS native-target setup; iOS uses standard notifications, not critical alerts. Native modules require a rebuilt development/production app and are unavailable in Expo Go.
- **Remaining:** Automatically reconcile native alarm IDs when events are edited/deleted, recurring-event native alarm expansion, Android boot/time-change rescheduling, native alarm receiver integration with app deep-link routing, and automatic iOS WidgetKit extension target generation. No tests/build/type checks have been run by request.

## Phase 7 — Hardening and release readiness
**Goal:** Validate the integrated product after feature implementation is complete.

- Run type checks, automated tests, builds, and device-specific checks only when requested.
- Address accessibility, performance, migration safety, and failure recovery.
- Add backup/export safeguards, diagnostics, and release documentation.
- Audit permissions, authentication, local data handling, and sync authorization before release.

## Delivery rule

Finish one coherent phase or meaningful vertical slice at a time. Prefer changes spanning the model, persistence, and UI when needed to deliver a usable feature. Do not treat a feature as complete merely because its data contract or native template exists.
