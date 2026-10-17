# Supabase setup — DR-Calender Phase 4

Phase 4 uses Supabase Auth for account sessions and PostgreSQL RPC functions for workspace-scoped sync. The app intentionally does not embed a service-role key.

## 1. Apply the database migration

Open the Supabase project SQL Editor and run the complete migration:

`supabase/migrations/202610180001_phase4_sync_workspaces.sql`

It creates workspace and membership tables, an idempotency ledger, versioned temporal entity storage, row-level security, and server-side RPC functions for workspace listing/creation and sync push/pull.

The RPCs are `dr_list_workspaces`, `dr_create_workspace`, `dr_sync_push`, and `dr_sync_pull`. They validate the signed-in user and membership on the server. Write operations require owner/admin/editor membership; viewers can read and sync down.

## 2. Configure authentication

In Supabase Dashboard → Authentication → Providers, enable Email authentication. Choose whether email confirmation is required for your project. Set appropriate production password and email policies before release.

## 3. Configure the mobile app

Open **Spaces → Account & sync** in DR-Calender. Enter:
- Project URL, for example `https://YOUR_PROJECT_REF.supabase.co`
- The project publishable key (or legacy anon key)

Do not enter or ship a service-role key. Project configuration and session tokens are stored with Expo SecureStore on the device.

Create an account or sign in. Use **Link this device’s Personal workspace** to create the matching remote workspace ID, then select **Sync now**. Pending local mutations are pushed idempotently; remote records are pulled by revision cursor and merged using the existing HLC/LWW policy.

## 4. Workspace switching

Create a family, team, or project workspace from the Workspaces section. Use the **Use** action on a workspace to create/activate its local mirror, then run sync. The local database and query path remain workspace-scoped.

## Operational boundaries

- The migration must be applied before sync can succeed.
- A project URL and public key are required; this repository does not provide a hosted Supabase project.
- Workspace membership is currently established for the creator. A user invitation/member-management UI is not yet included.
- Conflict handling is deterministic LWW/HLC, not field-level collaborative merge.
- The current sync client is foreground/manual; background sync scheduling and push-based invalidation remain future work.
- Offline mutations remain in SQLite’s outbox until the server acknowledges them. Errors are surfaced in Account & sync.
- The mobile app cannot enforce server authorization by itself; the SQL RPC checks are the security boundary.
