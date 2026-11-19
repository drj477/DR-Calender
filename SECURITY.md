# Security Policy

DR-Calender handles personal calendar, task, reminder, workspace, and account information. Security reports are welcome and appreciated.

## Reporting a vulnerability

**Please do not report suspected vulnerabilities in public GitHub issues, discussions, pull requests, or social media.**

Use GitHub's private vulnerability reporting feature for this repository if it is enabled (repository **Security** → **Report a vulnerability**). If the private reporting option is unavailable, contact the maintainer through the contact method on the GitHub profile and request a private channel. Share technical details only after a private channel is established.

Include, where possible:

- A concise description and potential impact.
- Affected commit, version, platform, or configuration.
- Reproduction steps or a minimal proof of concept.
- Any relevant logs with tokens, credentials, personal data, and calendar contents removed.
- A suggested mitigation, if known.

Please allow reasonable time for investigation and a coordinated fix before public disclosure. Do not access, modify, or retain other people's data while researching a report.

## Scope and important boundaries

Areas of particular interest include:

- Authentication, session handling, and authorization.
- Workspace membership, role enforcement, and cross-workspace data isolation.
- Supabase RPCs, database grants, migrations, and Edge Functions.
- Backup export/import, local storage, and sensitive data exposure.
- Deep links, notification payloads, and native alarm/widget integrations.
- Dependency vulnerabilities and unsafe configuration defaults.

A source review is not proof that a deployed Supabase project is secure. Reports involving a live deployment should identify the affected environment without including secrets or real user data.

## Supported versions

Security fixes are generally developed against the latest code on the default branch. No separate long-term-support release policy is currently published.

## Disclosure

The maintainer will acknowledge reports when reasonably possible, investigate severity and reproducibility, and coordinate a fix and disclosure timeline with the reporter. Please do not publish exploit details before a fix or mitigation is available.
