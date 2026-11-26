# MOVE KIDS launch QA — 2026-11-27 (Asia/Bangkok)
Base: feature/move-kids-launch, 7138500ce6a9d33bccc0a4730f60bee6ed292af3. Keep production closed pending owner sign-off.

## Latest owner decisions
- Public distance approximately 14K (proposal GPX 13.2 km); not a race.
- Kids are schoolchildren receiving equipment, not the target trail-registration audience. No guardian flow or guardian data. Do not add an invented age cutoff.
- Website registration, not Google Forms; no changes to existing shop backend. School activity details subject to coordination.
- Poster pending; do not fabricate an asset. Keep preview noindex.
- Media permission is optional in this draft; confirm with owner and provide practical opt-out arrangements. Health data not collected.

## Verification
`node --test tests/events-registration.test.mjs` — 8 passed, using actual in-memory SQLite schema with a D1 API adapter. Worker production/preview gating, idempotency, validation, optional media consent, rate limit mock, failure handling, no cache and static fallback covered. No real personal data or network writes.
`node --check src/events-worker.mjs` and `node --check events/move-kids-2026/register.mjs` — pass.
No claim of actual D1, live payment, deployed mobile, or Cloudflare build test.

## Release checklist (not executed)
1. Create dedicated empty D1 database (suggested name norx-events); apply migrations/events/0001_move_kids.sql. Bind EVENTS_DB in Wrangler with the actual database ID. Never set a fake ID. Keep EVENTS_REGISTRATION_OPEN=0. Verify rate limiting binding REGISTRATION_LIMITER in Cloudflare; 10 POST requests/IP/minute is a draft abuse-control threshold, not a limit on participants.
2. Build and preview; verify site assets and shop unchanged, mobile registration and event links, form success and duplicate retries on a **separate test database/runtime**, then check production D1 schema and empty count read-only. No test registrations in production.
3. Owner reviews event copy, optional media consent, retention/deletion period for event contacts (suggest 90 days after event, pending approval), staff access list and procedure for handling opt-outs. Verify Supersports usage with partner. Complete poster if available. Confirm actual open/close times and Google Form intake before transition.
4. Owner approves production deploy/open. Don't change DNS, storefront API, existing Google Forms or live order data during this work. Remove noindex when approved and set agreed opening flag. Verify public page and read-only GET.
5. Initially only authorized owner/staff can access registrations via Cloudflare D1 dashboard; no application endpoint listing personal data. Before opening, verify access and safe roster handling. Administrative check-in UI is a separate future task.

Read-only row count (no PII): `SELECT COUNT(*) AS registrations FROM move_kids_registrations;`
Official docs: https://developers.cloudflare.com/d1/get-started/ and https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
