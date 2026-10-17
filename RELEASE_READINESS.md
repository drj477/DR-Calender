# Release readiness — DR-Calender

This document records source implementation and outstanding validation. It is **not** a statement that the app has passed tests, native builds, device checks, or a live Supabase security audit.

## Implemented source safeguards

- [x] Read-only local database diagnostics.
- [x] Quick JSON backup sharing with a 2 MB guard.
- [x] File-based JSON backup export through Expo FileSystem and the native share sheet.
- [x] Backup omits SecureStore authentication tokens and filters token/secret/password setting keys.
- [x] Backup importer validates format/schema version, required table sections/columns, unexpected columns, workspace references, entity types/time ranges, and embedded JSON.
- [x] Restore uses one SQLite transaction, replaces local app data only after explicit destructive confirmation, validates foreign keys before commit, and preserves cloud data.
- [x] Versioned local schema migration ledger, transactional migration application, fail-closed migration errors, and rollback for known reversible migrations.
- [x] Root React error boundary with a local recovery action.
- [x] Workspace-scoped sync outbox batching.
- [x] Supabase security-hardening migration and a source-level review/staging checklist.
- [x] Android native alarm persistence and restoration receiver for reboot/time/time-zone/exact-alarm permission changes.
- [x] iOS WidgetKit extension source is present.
- [x] iOS WidgetKit target generation is configured with `@bacons/apple-targets`, an extension target folder, and a shared App Group entitlement.
- [x] Sync and backup restore are coordinated through a shared operation gate; restore refreshes the active database workspace and in-memory stores before releasing the gate.

- [x] Source-level rolling native alarm reconciliation for recurring event occurrences, moved overrides, exclusions, and stale alarm cancellation.
- [x] App deep-link routing for task/event widget links and Android/iOS event notification taps.
- [ ] Native compilation and project generation still need to be run in the development environment; no passing native build is claimed.
- [x] Android exact alarms hand off from Expo notifications when permission is granted to prevent duplicate event reminders; Expo notifications remain fallback when exact-alarm permission is unavailable.
- [ ] Verify native alarm reconciliation after edits, deletion, completion, workspace switching, reboot, and time-zone changes on physical devices.
- [ ] Verify cold-start and warm-start task/event deep links on Android and iOS.

## Required before production

- [ ] Run TypeScript checks and resolve all reported issues.
- [ ] Add and run automated unit/integration tests, especially restore validation/rollback, migration recovery, recurrence, DST, sync idempotency, and workspace isolation.
- [ ] Build Android and iOS native apps; verify local module autolinking, generated manifests, and native dependency resolution.
- [ ] Verify Android exact-alarm permission, notification permission denial, reboot/time-change recovery, widget refresh, and alarm cancellation on physical devices.
- [ ] Run a clean iOS prebuild on supported macOS tooling; add the Apple Developer Team ID, verify the generated WidgetKit target and signed App Group entitlement, then verify widget refresh/deep links on physical devices.
- [ ] Apply both Supabase migrations to a non-production project; verify effective grants, function owners/search paths, RLS behavior, workspace isolation, role matrix, payload rejection, and idempotency.
- [ ] Run the security checklist in SUPABASE_SECURITY_REVIEW.md; source changes alone are not a live-project audit.
- [ ] Exercise restore on a disposable database with malformed, truncated, duplicate, future-version, and foreign-key-invalid backups; prove rollback behavior and UI restart/reinitialization.
- [ ] Confirm Expo share behavior for large files on Android and iOS; platform share providers can impose their own limits.
- [ ] Define a backup compatibility policy before future schema changes, including how old backups are upgraded or rejected.
- [ ] Review accessibility labels/focus order, dynamic type, color contrast, long lists, and low-memory behavior.
- [ ] Review local logs and define privacy-reviewed telemetry before adding remote crash reporting.
- [ ] Verify store metadata, privacy disclosures, permissions, and platform policy compliance.

## Backup format

- Format: dr-calender-backup.
- Current schema version: 2.
- Includes workspaces, memberships, temporal entities including tombstones, checklist items, ghost clusters, sync outbox, cursors, HLC clocks, and non-secret app settings.
- Does not include SecureStore authentication tokens. Backup JSON may contain private event/task details and pending sync payloads.
- Quick-share refuses payloads over approximately 2 MB. File export writes JSON to the app cache and opens the system share sheet; device storage and destination-provider limits still apply.
- Restore **replaces** local app data. It does not overwrite cloud data. The app must be fully closed and reopened after a successful restore so in-memory workspace/sync state is reloaded. Do not restore while sync is active.
- Structure validation is not a cryptographic signature; only import backups from trusted sources.

## Schema recovery

- Migration records are stored in schema_migrations; each migration runs in a SQLite transaction.
- Migration failure aborts database initialization and reports the failed version instead of continuing silently.
- rollbackLatestSchemaMigration only rolls back the newest migration known to the installed code and intended to be reversible. Export a backup before rollback. It is not a substitute for restoring a known-good database snapshot or for writing a down migration for every future schema change.

## Supabase security status

The source hardening migration revokes direct table privileges from anon and authenticated, narrows RPC execution to authenticated users, and strengthens sync push validation. It has **not** been applied or tested against a configured Supabase project in this workflow. Apply it to staging first and complete SUPABASE_SECURITY_REVIEW.md.

## Native status

Android alarm persistence/recovery source and iOS WidgetKit source exist, but source presence does not prove the code compiles or behaves correctly on device. iOS still needs an actual Widget Extension target and matching entitlement configuration.

## Validation policy

The temporary CI workflow was removed after both jobs failed during setup: `actions/setup-node` was configured with npm caching, but the repository has no `package-lock.json`, `npm-shrinkwrap.json`, or `yarn.lock`. Neither Android nor iOS compilation started. No physical-device validation or successful native build is claimed. Release readiness remains **not certified** until the checks above are completed.
