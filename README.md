# DR-Calender

A high-performance, offline-first, collaborative calendar and scheduling application for iOS and Android.

## Architecture baseline

- React Native + Expo Prebuild with the New Architecture enabled (Fabric and TurboModules).
- Reanimated 3 and Gesture Handler for UI-thread gestures and motion.
- Zustand for client state.
- SQLite for offline-first persistence.
- Supabase Realtime or a local-first replication layer for multiplayer synchronization.

## Phase 1 scaffold

This repository currently contains the Phase 1 temporal domain contracts, motion presets, SQLite schema, and widget snapshot DTOs.

### Files

- `src/temporal/types.ts` — polymorphic temporal entities and related DTOs.
- `src/temporal/motion.ts` — shared Reanimated spring/timing presets.
- `src/temporal/schema.sql` — SQLite tables and query-oriented indexes.
- `src/temporal/index.ts` — public exports.
- `package.json`, `tsconfig.json` — minimal TypeScript package setup.

## Development

Requires Node.js 20+.

```bash
npm install
npm run typecheck
```

## Implementation notes

- Timestamps are stored as UTC epoch milliseconds in the app domain; SQLite stores indexed timestamp values as INTEGER.
- Database mutations should be applied locally first and queued for synchronization.
- Sync conflict resolution and native widget/alarm bridges are later-phase work, not implemented by this Phase 1 scaffold.
- iOS critical alerts require Apple's specific entitlement and user/device authorization. Android exact alarms and full-screen intents are subject to OS version and user settings; neither platform can be assumed to override all mute or focus settings.
