# Supabase security review — DR Calender

## Scope and status

This is a source-level review of the SQL migrations in this repository. It is **not** a live-project audit: no configured Supabase project credentials or deployed database were available to inspect, and the migrations have not been applied or executed here. Apply the migrations in filename order to a staging project and perform the verification checklist below before production.

## Changes added

- `202610180003_phase9_workspace_lifecycle.sql` adds authenticated, membership-checked RPCs for listing members/invitations, role changes, member removal, invitation creation/revocation, and acceptance tied to the signed-in email. Direct access to the invitation table is revoked.
- Proposed `202610180005_phase11_invitation_rate_limits.sql` enforces per-inviter limits at the database write boundary: 10 invitation create/refresh attempts per rolling hour and 50 per rolling 24 hours. This migration is source-only until reviewed, merged, and applied; it does not replace IP-level or platform-level abuse controls.
- `202610180002_phase7_security_hardening.sql` revokes direct table privileges from `anon` and `authenticated`; the mobile app is intended to use the authenticated RPC surface.
- The hardened push RPC validates authentication, workspace membership and editor-level write role, batch shape/size, mutation identity, supported entity types/operations, title length, positive versions, and scheduled time ranges.
- Reused mutation IDs are acknowledged only for the actor that originally submitted them; a different actor is rejected.
- All security-definer RPCs have explicit authenticated-only execute grants and a fixed `search_path`.
- The client must use only the Supabase project URL and publishable/anon key plus a user session. Never ship a service-role key in the app.

## Source-level risks and boundaries

1. **No live RLS/grant verification yet.** Verify actual table grants, policies, function owners, function definitions, default privileges, and exposed schemas in the configured project.
2. **Security-definer owner context matters.** Confirm the migration owner is a trusted database role, function search paths remain fixed, and untrusted roles cannot create objects in searched schemas.
3. **Sync conflict semantics are LWW/version based.** Authorization does not make the merge policy correct; stale writes, tombstones, and concurrent edits need dedicated tests.
4. **Payload validation is not a complete domain schema.** Add bounds/validation for every metadata field and recurrence payload as the entity model evolves; reject malformed nested values and non-finite/out-of-range timestamps.
5. **Invitation email delivery depends on trusted Edge Function secrets.** Configure `RESEND_API_KEY` and `INVITE_FROM_EMAIL` as Supabase Function secrets. The Edge Function forwards the signed-in user's JWT to membership-checked RPCs and never accepts a service-role key from the client. If provider delivery fails after invite creation, the app falls back to sharing the invitation ID. Role and membership changes remain subject to staging verification.
6. **Rate limiting and abuse controls.** The proposed Phase 11 trigger limits invitation create/refresh attempts per inviter, including direct RPC calls. It is not yet deployed and does not provide IP-level limits or protect other RPCs from request flooding. Add platform/edge-level limits where appropriate.
7. **Privacy and retention.** Sync payloads contain event/task content. Define retention/deletion rules for mutation logs and account deletion, and review logs for accidental payload disclosure.
8. **Operational controls.** Enable database backups/PITR as appropriate, monitor failed RPCs, rotate exposed keys, and separate staging/production projects.

## Staging verification checklist

- Apply migrations 001–003 and any approved follow-up migrations in filename order to a disposable Supabase project.
- Confirm anonymous calls to every RPC fail; authenticated non-members cannot list, pull, push, or add members to a workspace.
- Confirm viewers can pull but cannot push; editors can push but cannot administer membership; only owner/admin can manage eligible membership/invitations; owner protection and admin-vs-owner boundaries hold.
- Confirm direct `SELECT/INSERT/UPDATE/DELETE` against the four `dr_*` tables is denied to `anon` and `authenticated`.
- Try null, object, empty, 101-item and oversized mutation batches; malformed JSON, mismatched workspace/entity IDs, invalid types/operations, negative versions, long titles and invalid time ranges.
- Replay a mutation as its original actor (idempotent acknowledgement), then replay it as another workspace member (must fail).
- Test duplicate entity IDs, stale versions, tombstones, cross-workspace payloads, and concurrent updates.
- Test the invitation limits: 10 create/refresh attempts per inviter in one hour, 50 in 24 hours, and ensure acceptance/revocation still work at the cap. Test concurrent invite requests.
- Inspect `pg_proc.prosecdef`, `proconfig`, ownership, grants and effective privileges after migration.
- Verify backups/PITR restore in staging and review database/API logs for event titles or payload leakage.

## Rollback

The migration changes grants and replaces `dr_sync_push`. Keep the previous function definition and grant snapshot in change control before applying it. Roll back by restoring the prior function definition and grants from the preceding migration/version; do not blindly grant broad table access as an emergency workaround. A database restore is the fallback if the migration leaves the project in an unknown state.
