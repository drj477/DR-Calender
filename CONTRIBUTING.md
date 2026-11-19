# Contributing to DR-Calender

Thank you for considering a contribution. DR-Calender is an offline-first calendar and scheduling application for iOS and Android. Contributions are welcome, especially fixes that improve correctness, accessibility, reliability, privacy, and cross-platform behavior.

## Before starting

1. Read the project overview in [README.md](README.md).
2. Review [RELEASE_READINESS.md](RELEASE_READINESS.md) for known implementation boundaries and outstanding validation.
3. For cloud-sync work, read [SUPABASE_SETUP.md](SUPABASE_SETUP.md) and [SUPABASE_SECURITY_REVIEW.md](SUPABASE_SECURITY_REVIEW.md).
4. Search existing issues and pull requests before starting substantial work. For a large change, open an issue first so the scope can be discussed.

Please do not publish secrets, private calendar data, personal information, production credentials, or real user backups in issues, pull requests, screenshots, or test fixtures.

## Development setup

Use a Node.js version compatible with the repository's Expo SDK 53 toolchain. From the repository root:

```bash
npm ci
npm run typecheck
npx expo export --platform all
```

These checks cover dependency installation, TypeScript, and JavaScript bundling. They do not prove that native Android/iOS code compiles or that device-only behavior works.

For native Android development, follow [RUN_THE_APP.md](RUN_THE_APP.md). iOS native builds require macOS and Xcode. Do not use Expo Go to validate the custom native module.

## Contribution expectations

- Keep changes focused and explain the user-facing or engineering problem they solve.
- Preserve offline-first behavior. Local operations should remain usable without a network connection unless a feature explicitly requires connectivity.
- Keep workspace authorization and data isolation enforced by trusted server-side code; do not rely on client-side checks as the security boundary.
- Never add service-role keys, API tokens, signing keys, credentials, or real user data to the repository.
- Avoid unrelated dependency upgrades and generated native build output.
- Add or update tests for behavior changes where practical. Include manual reproduction and validation steps when automated coverage is not available.
- Document new configuration, migrations, platform requirements, and known limitations.
- Be explicit about what has and has not been tested. Do not describe source-level checks as a completed device test or live security audit.

## Pull requests

A useful pull request includes:

1. The problem and why the change is needed.
2. A concise description of the implementation.
3. Screenshots or a short recording for UI changes, using synthetic data.
4. Tests and commands run, with their actual results.
5. Platform coverage (Android, iOS, or both) and any untested areas.
6. Migration, configuration, permission, privacy, or security implications.

Keep pull requests reviewable. Avoid combining unrelated refactors, formatting changes, and feature work.

## Database and sync changes

- Add new schema changes as forward migrations; do not rewrite migrations that may already have been applied.
- Test migrations against a disposable staging project before production.
- Preserve workspace scoping, authenticated RPC authorization, idempotency, and safe handling of untrusted payloads.
- Never include production credentials or production user data in test instructions.

## Reporting bugs

When opening an issue, include the app version/commit, platform and OS version, steps to reproduce, expected behavior, actual behavior, and relevant redacted logs. Remove access tokens, email addresses, event titles, invite IDs, and other personal data.

## Code of conduct

Be respectful, constructive, and open to differing technical approaches. Harassment, personal attacks, and deliberately disruptive behavior are not acceptable.
