# Release readiness — DR-Calender

This checklist records implementation boundaries. It is not a statement that the app has passed validation.

## Implemented source safeguards

- [x] Read-only local diagnostics screen.
- [x] Local JSON backup export with a 2 MB in-app size guard.
- [x] Backup excludes SecureStore authentication sessions and tokens.
- [x] Backup UI warns that event/task content and pending sync payloads are sensitive.
- [x] Root React error boundary with a recovery action.
- [x] Workspace-scoped sync outbox batching.
- [x] Supabase sync remains based on public client credentials plus user access tokens; never embed a service-role key in the mobile app.
- [x] Native alarm/widget limitations documented.

## Before production release

- [ ] Run TypeScript checks and resolve all reported issues.
- [ ] Run automated unit/integration tests and add coverage for recurrence, all-day boundaries, sync idempotency, workspace isolation, and backup encoding.
- [ ] Build Android and iOS native apps; verify local module autolinking and generated manifests.
- [ ] Verify Android exact-alarm permission, notification permission denial, device reboot/time change behavior, and widget refresh on physical devices.
- [ ] Add the iOS WidgetKit extension target and App Group entitlement; validate widget refresh and deep links on a physical device.
- [ ] Apply the Supabase migration to a non-production project and review grants, RLS, RPC authorization, payload validation, and deletion/tombstone behavior.
- [ ] Validate account sign-out, token refresh failure, revoked sessions, and switching accounts/workspaces.
- [ ] Implement a versioned schema migration and documented rollback/recovery policy.
- [ ] Implement validated, transactional backup restore before describing backup as a full disaster-recovery solution.
- [ ] Add file-based export for backups exceeding the current 2 MB share limit.
- [ ] Review accessibility labels/focus order, dynamic type, color contrast, long lists, and low-memory behavior.
- [ ] Review sensitive local logging and establish a privacy-reviewed telemetry policy before adding remote crash reporting.
- [ ] Verify store metadata, privacy disclosures, permissions, and platform policy compliance.

## Backup format and limitations

Current backup JSON uses `format: "dr-calender-backup"` and `schemaVersion: 1`. It exports local workspaces, memberships, temporal entity rows (including tombstones), checklists, ghost clusters, sync outbox, cursors, local HLC clocks, and non-secret app settings. Authentication tokens are stored in SecureStore and are not exported.

The current implementation uses the platform share sheet and refuses exports above an estimated 2 MB. It does not write a dedicated file, encrypt the export, upload it automatically, or restore/import it. The user must choose a trusted destination and protect any shared backup.

## Validation policy

The feature-first workflow defers type checks, tests, builds, native compilation, and device validation until explicitly requested. Consequently, source implementation is not proof of compile-time correctness, runtime correctness, or production security.
