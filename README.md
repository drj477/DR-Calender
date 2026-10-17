# DR-Calender

A premium, offline-first calendar and scheduling application for iOS and Android, built around shared temporal primitives, quick task capture, collaborative sync contracts, and native widget/alarm integration.

## Current implementation

### Mobile application

- Expo application configured for the React Native New Architecture.
- Midnight-navy and warm-amber calendar UI with layered card shadows, clearer type hierarchy, restrained italic supporting copy, bold action/status emphasis, pressed states, accessible selected-state labels, and Day / Week / Month controls, month paging, Today shortcut, horizontal date selection, task completion animation, and quick task creation.
- Event creation/editing sheet with title, date, timed or all-day scheduling, duration, location, focus shield, flexible-event settings, reminder offsets, and Never / Daily / Weekdays / Weekly / Monthly recurrence presets; all-day events use local midnight boundaries and render in a dedicated day-view lane; recurrence rules persist with the event and enter the sync outbox. The day, week, and month views expand supported recurrence rules into visible occurrences.
- Event deletion uses a local tombstone and a delete mutation; agenda cards render persisted events for the selected day.
- Proportional day timeline with overlap-aware columns, 15-minute drag-to-move, horizontal cross-date shifting, draggable start/end resize grips, a seven-day week overview, and a 42-cell month grid with event indicators.
- React Native Reanimated 3 spring presets and Gesture Handler root integration.
- Zustand state store with optimistic entity mutations and a pending-sync outbox model.
- Expo SQLite bootstrap creates a local personal workspace; task creation and completion persist locally and are recorded in the sync outbox.

### Temporal engine

- Polymorphic temporal entities for events, tasks, reminders, and alarms.
- Strict task DTO with title, due date, and assignee.
- Interval overlap layout engine for concurrent calendar blocks.
- Elastic event first-fit rescheduling and ghost-cluster expiry/confirmation results.
- Bounded RRULE expansion for common DAILY, WEEKLY, and MONTHLY recurrence patterns. Plain MONTHLY rules repeat on the DTSTART day-of-month; months without that date are skipped instead of clamping to month-end.
- Free-slot finder, drag snapping/resizing helpers, and incomplete-task rollover planning.
- RFC 5545 ICS parsing and invitation / RSVP payload generation.

### Offline persistence and sync primitives

- SQLite schema with workspace membership, temporal entities, ghost clusters, checklists, sync outbox, sync cursors, and query-oriented indexes.
- SQLite repository adapter for local-first writes, range queries, and outbox delivery bookkeeping.
- Hybrid Logical Clock primitives, deterministic LWW merge helper, and transport-agnostic sync coordinator.
- Remote sync transport is an interface; a production Supabase/PowerSync adapter and server authorization policies still need to be wired in.

### Native source templates

- iOS WidgetKit task widget source.
- Android Jetpack Glance task widget source.
- Native local alarm scheduler templates for iOS and Android.
- Native files are templates and are not yet registered in generated Xcode / Android targets. Widget extension setup, entitlements, manifest entries, notification receivers, and an Expo config plugin remain integration work.

## Project structure

- `App.tsx` — mobile application entry screen.
- `src/temporal/` — temporal models, scheduling, recurrence, ICS, drag helpers, and SQLite DDL.
- `src/store/` — Zustand calendar state.
- `src/persistence/` — SQLite repository abstraction.
- `src/sync/` — HLC, deterministic merge, and sync orchestration contracts.
- `native/ios/` and `native/android/` — native widget/alarm source templates.

## Run locally

Requires Node.js compatible with Expo SDK 53.

```bash
npm install
npx expo start
```

## Important implementation boundaries

- The day view now uses a proportional draggable grid and week/month views have distinct overviews. Month paging and a Today shortcut are implemented. Timeline resizing and horizontal cross-date movement are implemented; a full editor for recurrence/attendees remains to be implemented.
- The RRULE expander is intentionally bounded and is not a complete RFC 5545 recurrence implementation. Plain monthly rules default to the DTSTART day-of-month and skip months without that date; unbounded range fast-forwarding never starts before DTSTART. Unbounded recurrence rules fast-forward near the requested local-date range, while COUNT-limited rules scan from DTSTART to preserve occurrence counts. Day/week/month views render supported instances and persisted occurrence exceptions. Recurring timeline cards cannot be dragged or resized; tap an instance to choose occurrence-level or series-level editing/deletion. Moved overrides are rendered in their destination range and recurring instances use unique view identities. Recurrence dates are now generated in each event's IANA time zone to preserve local wall-clock times across DST changes; ambiguous/nonexistent local times use deterministic runtime offset resolution, so exhaustive RFC 5545 DST semantics remain future work.
- The free-slot finder uses a fixed offset, not a full IANA timezone database.
- The sync coordinator requires a real transport and transactional local adapter before multiplayer behavior is production-ready.
- iOS critical alerts require Apple's entitlement and user authorization. Android exact alarms and full-screen intents are subject to OS permissions and user settings; neither platform can guarantee overriding all silent/focus states.
- Build/typecheck/device tests have intentionally not been run yet; implementation is being built first as requested.


## Visual theme

The calendar UI uses a midnight-navy and warm-amber palette inspired by the supplied references: deep navy backgrounds, layered blue-charcoal surfaces, subtle slate borders, warm gold highlights, soft off-white text, and muted slate secondary text. Event states use restrained amber/orange accents instead of the previous lime/lavender palette. This theme is applied consistently across the main calendar, day timeline, week/month overview, and event editor.


### Visual and interaction polish

- Applied a consistent depth system to event cards, week/month surfaces, task cards, editor fields, and primary actions, with restrained Android elevation and iOS shadow styling.
- Strengthened visual hierarchy with heavier event titles, clearer section labels, amber-highlighted counts, and limited italic supporting copy.
- Added pressed feedback and selected accessibility states to calendar mode/date controls, larger primary create-event affordance, and improved contrast for focus-shield and selected recurrence states.
- Kept amber for primary actions/selection, coral for flexible-event emphasis, and green for the healthy offline/sync-ready indicator.


### Recurrence rendering

- Calendar views use the bounded RRULE expander to generate event instances within the visible date range; unbounded rules fast-forward near the requested range to avoid scanning years of irrelevant dates, while COUNT-limited rules retain DTSTART-based counting; the stored series remains the source of truth.
- Unsupported or malformed recurrence rules are logged and skipped rather than crashing the calendar render.
- Recurring events support persisted per-occurrence overrides and exclusions. The editor offers “This occurrence” versus “Entire series” when opened from a generated instance; switching scope reloads the appropriate occurrence or series values, and repeat settings are only editable at series scope. Overrides are keyed by the original occurrence start timestamp so moving an occurrence does not change its identity. Changing a series RRULE or anchor start time clears stale occurrence exceptions, with a warning shown when exceptions exist. The RRULE engine remains bounded and uses the event time zone for wall-clock recurrence generation; advanced RFC 5545 timezone edge cases remain future work.


## Phase 1 delivery notes

- Added all-day and multi-day event creation/editing. All-day events use local-midnight boundaries, and the editor accepts 1–365 calendar days. Recurring all-day instances calculate their end by local calendar-day count, preserving midnight boundaries across daylight-saving transitions.
- Added a dedicated all-day lane to the day timeline and “All day” labels in week overview rows. All-day items are excluded from the timed overlap grid so they do not appear as midnight-sized appointments.
- Added all-day state to occurrence overrides so an individual recurring occurrence can differ from its series event kind.
- Kept schedule validation in the editor for required titles, valid 24-hour times, timed-event duration bounds, and all-day duration bounds.
- Improved recurrence range fast-forwarding so an unbounded rule does not begin before DTSTART and accidentally shift its interval phase.
- Monthly default recurrence repeats on the DTSTART day; months that do not contain that day are skipped. Full RFC 5545 support, selectable per-event time zones, and exhaustive DST gap/fold disambiguation remain out of scope for this bounded engine.

## Phase 2 — Reminders and notifications

- Added a Reminders navigation screen with local reminder creation, scheduled date/time validation, upcoming and completed lists, snooze actions, completion, and deletion.
- Added Expo local notification setup and an Android reminders channel. Permission state is surfaced in the Reminders screen; if access is denied, the user can open system settings.
- Event editor supports Off, At start, 5 minutes, 15 minutes, 30 minutes, 1 hour, and 1 day reminder offsets. Event notifications are reconciled after edits, moves, series-rule changes, occurrence edits/exclusions, and deletion.
- Recurring event notifications are scheduled over a rolling 14-day window. Launch-time reconciliation restores pending reminder/task/event notifications without intentionally rescheduling completed reminders.
- Task rows can toggle a 15-minute-before-due alert when the task has a due time. Completing a task cancels its pending alert; reopening it can restore the alert.
- Local reminder records and notification identifiers are stored in the existing temporal entity metadata, so reminders remain visible offline.

**Native alarm boundary:** the iOS and Android exact-alarm source files remain templates and are not yet registered as a native Expo module. Phase 2 uses standard OS local notifications; exact Android alarm scheduling, alarm receiver/full-screen behavior, and iOS critical-alert entitlements still require native-target integration and platform-specific permission handling. Standard notifications cannot guarantee bypassing silent mode or Focus.
