# DR-Calender — Delivery Phases

The project will be built in substantial, user-facing phases. Implementation comes before the dedicated test/build pass, as requested. Each phase should land as a coherent feature group rather than a stream of tiny polish-only commits.

## Phase 1 — Calendar reliability and event model
**Goal:** Make calendar behavior predictable before adding more surface area.

- Correct monthly recurrence defaults: repeat on the original day-of-month; skip months that do not contain that date.
- Finish all-day and multi-day event semantics across the editor, persistence, and calendar views.
- Make event time-zone handling explicit in create/edit flows and recurrence behavior.
- Tighten occurrence-versus-series operations and preserve exception identity when the series changes.
- Improve validation and clear user-facing errors for invalid schedules.

**Current progress:** Monthly recurrence default-day behavior is implemented. All-day/multi-day semantics and broader editor integration remain.

## Phase 2 — Reminders and notifications
**Goal:** Turn scheduled events into dependable reminders.

- Persist reminder rules per event/task, including relative offsets and custom reminder times.
- Add notification scheduling/cancellation when events are created, edited, moved, completed, or deleted.
- Handle recurring occurrence reminders and edits/exclusions without duplicate notifications.
- Add permission onboarding, notification preferences, and a reminder management surface.
- Integrate the existing native alarm templates where platform capabilities and permissions allow.

## Phase 3 — Tasks and daily planning
**Goal:** Make the app useful as a daily planner, not just a calendar grid.

- Build a dedicated task inbox and task detail/edit flow.
- Add due dates, priorities, completion states, checklists, and overdue handling.
- Add “Plan my day” actions that place tasks into free slots while respecting duration and existing events.
- Improve quick capture, task rollover, and day agenda summaries.
- Connect task completion and rescheduling to the existing local-first persistence/outbox.

## Phase 4 — Offline-first sync, accounts, and workspaces
**Goal:** Safely synchronize data across devices and collaborators.

- Choose and wire the production sync transport and persistence adapter.
- Implement authentication/session lifecycle and workspace membership.
- Add server-side authorization, conflict resolution, cursor recovery, retries, and idempotent mutation delivery.
- Surface offline, pending, synced, and error states clearly.
- Support workspace-scoped calendar data without leaking data across accounts.

## Phase 5 — Sharing and interoperability
**Goal:** Make calendars portable and collaborative.

- Complete ICS import/export flows with preview, validation, and duplicate handling.
- Add invitations, attendee responses, and shared event permissions.
- Add calendar subscription/import management and sync status.
- Preserve recurrence rules, exceptions, time zones, and all-day dates through round trips.

## Phase 6 — Native experience and widgets
**Goal:** Make DR-Calender feel integrated with the operating system.

- Register iOS WidgetKit and Android Glance implementations in generated native targets.
- Add Expo config/plugin setup, permissions, deep links, and widget refresh/update flows.
- Connect native alarm/notification sources to the shared event model.
- Add useful home-screen task and upcoming-event widgets with privacy-conscious preview settings.

## Phase 7 — Hardening and release readiness
**Goal:** Validate the integrated product after feature implementation is complete.

- Run type checks, automated tests, builds, and device-specific checks only when requested.
- Address accessibility, performance, migration safety, and failure recovery.
- Add backup/export safeguards, diagnostics, and release documentation.
- Audit permissions, authentication, local data handling, and sync authorization before release.

## Delivery rule

Finish one coherent phase or meaningful vertical slice at a time. Prefer changes spanning the model, persistence, and UI when needed to deliver a usable feature. Do not treat a feature as complete merely because its data contract or native template exists.
