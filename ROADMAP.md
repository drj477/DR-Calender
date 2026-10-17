# DR-Calender — Delivery Phases

The project will be built in substantial, user-facing phases. Implementation comes before the dedicated test/build pass, as requested. Each phase should land as a coherent feature group rather than a stream of tiny polish-only commits.

## Phase 1 — Calendar reliability and event model
**Goal:** Make calendar behavior predictable before adding more surface area.

- Correct monthly recurrence defaults: repeat on the original day-of-month; skip months that do not contain that date.
- Finish all-day and multi-day event semantics across the editor, persistence, and calendar views.
- Make event time-zone handling explicit in create/edit flows and recurrence behavior.
- Tighten occurrence-versus-series operations and preserve exception identity when the series changes.
- Improve validation and clear user-facing errors for invalid schedules.

**Current progress:** Implemented: monthly default-day behavior, all-day/multi-day semantics across editor and calendar views, recurrence occurrence exceptions, an editable IANA time-zone field, and deterministic recurring-occurrence DST fold/gap resolution (earlier instant for folds; first valid wall minute after gaps). The editor uses the selected zone to resolve event start/end instants. Custom `VTIMEZONE` imports now resolve explicit transitions and common yearly rules; exhaustive RFC 5545 edge-case compatibility and unusual provider-specific time-zone aliases remain to be validated.

## Phase 2 — Reminders and notifications
**Goal:** Turn scheduled events into dependable reminders.

- Persist reminder rules per event/task, including relative offsets and custom reminder times. **Implemented:** event offsets and task due-time alerts are persisted locally.
- Add notification scheduling/cancellation when events are created, edited, moved, completed, or deleted. **Implemented for events and task completion:** reconciliation handles event moves, series changes, occurrence edits/exclusions, and deletion.
- Handle recurring occurrence reminders and edits/exclusions without duplicate notifications. **Implemented:** rolling 14-day scheduling filters exclusions and uses moved occurrence overrides.
- Add permission onboarding, notification preferences, and a reminder management surface. **Implemented:** permission flow and a Reminders screen with create, snooze, complete, and delete actions.
- Native exact-alarm bridge is now registered as a local Expo module in source. Android exact alarms, a high-priority receiver, and persisted reboot/time-change recovery are implemented in source but remain uncompiled/unverified. iOS uses standard local notifications, not Android-style exact alarms or critical alerts. Native full-screen behavior and automatic event-edit reconciliation remain open.

## Phase 3 — Tasks and daily planning
**Goal:** Make the app useful as a daily planner, not just a calendar grid.

- **Implemented:** dedicated task inbox with Inbox / Today / Upcoming / Overdue / Completed filters, task create/edit, due date/time or unscheduled capture, priority, completion, and persisted checklists.
- **Implemented:** overdue identification and one-tap rollover to today; task delete uses local tombstones and the sync outbox.
- **Implemented:** “Plan my day” assigns unscheduled and overdue tasks into 30-minute free slots from 9 AM–6 PM, prioritizing critical/high tasks and respecting existing timed events/tasks.
- **Implemented:** task edits, checklist changes, completion, rollover, deletion, and auto-planning are persisted locally through the temporal repository and enqueue outbox mutations.
- **Implemented in source:** configurable task durations (15, 30, 45, 60, 90, or 120 minutes) persist with the task, update the planned end time, and drive Plan my day’s free-slot allocation. Auto-planning still uses the local device time zone and fixed 9 AM–6 PM planning window.

## Phase 4 — Offline-first sync, accounts, and workspaces
**Goal:** Safely synchronize data across devices and collaborators.

- **Implemented:** Supabase Auth email sign-up/sign-in, SecureStore-backed session persistence, refresh-token lifecycle, and sign-out.
- **Implemented:** Supabase RPC sync transport, SQLite sync cursor/clock persistence, workspace-filtered outbox batches, idempotent mutation acknowledgements, retries/error recording, and HLC/LWW merge orchestration.
- **Implemented:** SQL migration for workspace membership, server-side authorization checks, workspace listing/creation, revision-cursor pull, and mutation push.
- **Implemented:** Account & sync UI, project configuration, manual sync, offline/error/success feedback, cloud workspace creation, local workspace activation, workspace-scoped hydration, and workspace member listing, owner/admin role changes and removal, expiring invitation records, invitation revocation, and acceptance restricted to the invited account email.
- **Deployment required:** Apply `supabase/migrations/202610180001_phase4_sync_workspaces.sql` to a Supabase project and configure its URL/public key in the app. See `SUPABASE_SETUP.md`.
- **Remaining:** Pending email invitations, member removal/role changes, field-level conflict resolution, background sync, and push-based invalidation. The phase has not been tested or built yet by request.

## Phase 5 — Sharing and interoperability
**Goal:** Make calendars portable and collaborative.

- **Implemented:** Multi-event ICS import with preview, input-size/event-count limits, UID duplicate detection, skip/update strategy, and validation of required start and end ranges.
- **Implemented:** ICS export of timed/all-day events, IANA time-zone wall times, RRULEs, EXDATE exclusions, moved recurrence overrides, organizer, attendees, and RSVP state.
- **Implemented:** Event invitation sharing through the system share sheet, attendee addition, RSVP status updates, and local outbox persistence so changes sync with the workspace.
- **Implemented:** Public HTTPS calendar subscription management with saved feed URLs, manual refresh, last-refresh/error status, and UID-based update behavior.
- **Permission boundary:** Workspace access is governed by Phase 4 workspace roles. Event attendees are invitation metadata and do not independently grant access to private workspace data.
- **Remaining:** Direct .ics attachment creation, authenticated calendar feeds, full VTIMEZONE component generation, per-event ACLs, and push-based subscription refresh. Backup restore separately uses a native document picker. No tests/build/type checks have been run by request.

## Phase 6 — Native experience and widgets
**Goal:** Make DR-Calender feel integrated with the operating system.

- **Implemented in source:** Local Expo module under `modules/dr-calender-native`, config plugin, Android exact alarms and Glance widget, iOS notification bridge, App Group snapshot bridge, and a WidgetKit extension source file at `native/ios/CalendarWidget.swift`.
- **Android recovery added:** Scheduled alarm IDs/times/content are persisted locally and an alarm restoration receiver is registered for reboot, wall-clock/time-zone changes, and exact-alarm permission changes.
- **iOS boundary:** Widget source exists, but Xcode/EAS still needs a separate Widget Extension target with the matching App Group entitlement. iOS uses standard notifications; it does not expose Android-style exact-alarm permission or critical-alert access by default.
- **Still required:** Native compilation, manifest/autolinking inspection, physical-device checks, automatic alarm reconciliation after edits/deletes, recurring native alarm expansion, and deep-link routing verification. Source implementation is not platform verification.

## Phase 7 — Hardening and release readiness
**Goal:** Add safer recovery paths, data portability, and operational visibility before the dedicated validation pass.

- **Implemented in source:** Read-only SQLite diagnostics for workspaces, entities, pending/failed sync mutations, checklist rows, invalid schedules, orphan checklist rows, and foreign-key violations.
- **Implemented in source:** Versioned JSON backup format, export to a file/share flow for large datasets, and the original quick-share path guarded at 2 MB. SecureStore authentication sessions are excluded; backups can contain sensitive event/task content and pending sync payloads.
- **Implemented in source:** Restore/import validates format and schema version, row/table shapes, workspace references, entity time ranges, and JSON payloads before replacement. Database replacement runs in one SQLite transaction and performs foreign-key checks before commit; restore requires explicit destructive confirmation and a restart.
- **Implemented in source:** Versioned migration ledger, transactional migration execution, fail-closed initialization on migration error, and explicit rollback for the newest known reversible migration.
- **Implemented in source:** Root React error boundary and workspace-scoped sync outbox batching.
- **Security hardening added:** A follow-up Supabase migration revokes direct table access from mobile roles and tightens push RPC membership, batch, payload, title, timestamp, version, and mutation-actor checks. `SUPABASE_SECURITY_REVIEW.md` separates source review from required live-project verification.
- **Remaining:** Native compile/device validation; apply and review the Supabase migrations on a configured staging project; validate restore failure cases with automated tests; design a backup strategy for incompatible future schemas; complete migration down scripts for non-reversible schema changes; full accessibility/performance audit; and production monitoring/retention policies.
- **Validation deferred:** No type checks, tests, builds, native compilation, or device validation have been run by request. Phase 7 source work is not a release certification.

## Phase 8 — Integration readiness and lifecycle reconciliation
**Goal:** Connect previously implemented native and recovery surfaces into complete application lifecycles before the dedicated validation pass.

- **Implemented in source:** A rolling 30-day native alarm reconciler for events with an explicit reminder offset. It expands recurring event instances, respects excluded instances and moved occurrence overrides, bounds scheduling to 120 alarms, and reconciles stale alarms after event changes, completion, deletion, workspace changes, and app hydration.
- **Implemented in source:** Android native bridge exposes stale-alarm cancellation and retains alarm persistence plus boot/time/time-zone restoration. Stable occurrence IDs make rescheduling idempotent. iOS event reminders stay on Expo Notifications to avoid double scheduling, while iOS widget/alarm links route through the app.
- **Implemented in source:** Widget task/event deep links are handled on cold and warm app launch. Android native event alarm notifications route to the associated event editor.
- **Implemented in source:** Native integration docs describe the bridge contract and platform boundaries. Expo Go remains unsupported for the custom native module.
- **Implemented in source:** iOS WidgetKit extension target generation is configured through `@bacons/apple-targets`, with a dedicated target folder, shared App Group entitlement, and widget source. A clean iOS prebuild on supported macOS tooling should generate the Xcode target.
- **Implemented in source:** A shared recovery gate prevents a sync run from overlapping a restore transaction and keeps sync locked until active workspace/store rehydration completes. Restore now refreshes the cached local database workspace, calendar store, task view, Expo notification schedules, manual native alarms, and dependent automatic alarm reconciliation without requiring a manual app restart. Workspace switching clears user-managed native alarms from the previous workspace and rebuilds the active workspace's OS notification schedules.
- **Still open:** Add the real Apple Developer Team ID for signing; verify widget target generation, signing, alarm lifecycle, workspace changes, reboot/time-zone recovery, and deep links on actual Android/iOS devices. Native IDs and alarm restore behavior still require source review during the validation pass.
- **Validation not completed:** No automated CI build workflow is being maintained for this phase. The native build workflow that was briefly introduced was removed after it failed before compilation because npm's lockfile-based cache was configured in a repository without a lockfile. No Android or iOS compilation was performed by that run; physical-device checks remain separate.

## Delivery rule

Finish one coherent phase or meaningful vertical slice at a time. Prefer changes spanning the model, persistence, and UI when needed to deliver a usable feature. Do not treat a feature as complete merely because its data contract or native template exists.

## Phase 9 — Membership lifecycle and interoperability completion
**Implemented in source:** `202610180003_phase9_workspace_lifecycle.sql` adds server-validated workspace member listing, role changes, member removal, 14-day email-address-bound invitations, invitation listing/revocation, and acceptance. Account & sync exposes member controls, email invitations, and a share-sheet fallback. Email delivery is implemented through `supabase/functions/send-workspace-invite/index.ts` using Resend; configure the function secrets `RESEND_API_KEY` and `INVITE_FROM_EMAIL` and deploy the function to enable it. The app falls back to sharing the invitation ID if delivery fails.

**Implemented in source:** Event editing now exposes an IANA time-zone field and resolves wall-clock times in that zone. Recurrence expansion resolves DST folds consistently and advances nonexistent wall times to the first valid minute. ICS export now includes generated `VTIMEZONE` observances for each exported IANA zone and the relevant event-year range.

**Still open (environment/deployment dependent):** Apply all Supabase migrations to staging and verify the role matrix; deploy the invitation Edge Function and configure provider secrets; custom VTIMEZONE import supports explicit STANDARD/DAYLIGHT transitions and common yearly BYMONTH/BYDAY/BYMONTHDAY rules; unusual RDATE rules, custom observance edge cases, and provider-specific TZID aliases still need validation; configure Apple signing; generate/compile native projects and verify on physical devices; complete accessibility/performance review, automated tests, and production operations. These cannot be honestly marked complete from source-only edits.
