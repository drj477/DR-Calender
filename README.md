# DR-Calender

A premium, offline-first calendar and scheduling application for iOS and Android, built around shared temporal primitives, quick task capture, collaborative sync contracts, and native widget/alarm integration.

## Current implementation

### Mobile application

- Expo application configured for the React Native New Architecture.
- Dark, thumb-friendly calendar UI with Day / Week / Month mode controls, horizontal date selection, agenda cards, task completion micro-animation, and quick task creation.
- React Native Reanimated 3 spring presets and Gesture Handler root integration.
- Zustand state store with optimistic entity mutations and a pending-sync outbox model.

### Temporal engine

- Polymorphic temporal entities for events, tasks, reminders, and alarms.
- Strict task DTO with title, due date, and assignee.
- Interval overlap layout engine for concurrent calendar blocks.
- Elastic event first-fit rescheduling and ghost-cluster expiry/confirmation results.
- Bounded RRULE expansion for common DAILY, WEEKLY, and MONTHLY recurrence patterns.
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

- The calendar UI currently uses sample agenda/task data; connecting screens to the SQLite repository and real event creation is still required.
- The RRULE expander is intentionally bounded and is not a complete RFC 5545 recurrence implementation. Timezone/DST-sensitive recurrence should be expanded with a timezone-aware engine.
- The free-slot finder uses a fixed offset, not a full IANA timezone database.
- The sync coordinator requires a real transport and transactional local adapter before multiplayer behavior is production-ready.
- iOS critical alerts require Apple's entitlement and user authorization. Android exact alarms and full-screen intents are subject to OS permissions and user settings; neither platform can guarantee overriding all silent/focus states.
- Build/typecheck/device tests have intentionally not been run yet; implementation is being built first as requested.
