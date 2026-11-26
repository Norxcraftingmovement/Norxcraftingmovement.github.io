# NORX Website — Events MVP / Execution Contract
Date: 2026-11-26 (Asia/Bangkok)
Status: proposed implementation scope, draft only. Registration and public release require owner approval.

## Goal
Provide a reusable events hub and a reliable registration flow on the NORX website. The first real event must be launchable without risking the current apparel preorder. Keep the current storefront and order backend unchanged.

## Branch / release isolation
- Work on `feature/events-mvp`, branched from the existing Cloudflare migration branch with the lookbook fix.
- Cloudflare production currently uses `feature/cloudflare-migration`. Do not change production branch, merge either branch, modify DNS, or publish new event details without owner approval.
- Keep `main`, storefront, Google Apps Script, Google Forms and live order Sheets untouched. Do not submit test orders.
- Use preview/local test with synthetic fixtures only. No real participant information, secrets, private proposals, unapproved sponsor marks, or unpublished event details in this public repository.
- Static asset build must allowlist `events/` only when event pages are implemented; never expose API source, database migrations, private files, or configuration in dist.
- Before any deployment, verify the existing storefront routes and lookbook remain unchanged; do not inadvertently remove the existing custom-domain binding. No additional paid plan.

## MVP deliverables
1. `/events/`: mobile-first hub, event cards and upcoming/past/empty states. Reuse current NORX colors, fonts, header/footer and image aspect ratios. Add Events navigation without redesigning the homepage. Demo content must be unmistakably a test fixture in previews or hidden/disabled in production.
2. `/events/<approved-slug>/`: reusable event detail, status, date/time/location/distance/difficulty, safety/requirements, capacity, registration action and organizer contact. Use placeholders internally until supplied by the owner; do not invent any facts or partner claims.
3. Registration: form with only explicitly approved required fields; Thai-first clear errors, submit-in-progress, confirmation and closed/full states. Server-side validation; no sensitive data in URLs, public responses, source control or logs.
4. Workers + separate D1 test database: event config, registration records, unique registration reference, server-side status/open/close checks, atomic capacity enforcement, idempotency for retry/double-click and validated input. Duplicate participant policy needs owner decision (do not silently assume one phone per person).
5. Staff operations: minimal authenticated/authorized roster, count, CSV export and check-in if needed before event day. If staff web authentication is not ready, use a protected owner-only operational export; never expose the public roster or PII endpoints.
6. Data handling: owner-approved privacy notice, consent/guardian flow if minors are permitted, retention/access policy and backup/export. Store no unnecessary sensitive fields. Handle failure without displaying unconfirmed registration as successful.

## Guardrails and launch dependencies
- Determine whether a live Google Form already accepts event registrations. If so, keep it authoritative until explicit migration/capacity reconciliation; do not enable two independent public booking systems.
- Owner must confirm: event name/slug, dates and registration deadline, venue, distance/safety information, eligible participants/minors and guardian requirements, free/paid, total capacity, required form fields, data retention, partner approval and public use of identity/marks.
- During launch pressure, use an approved existing registration form as a temporary link on the event page if native API QA cannot finish in time. Clearly indicate which system is authoritative. Never advertise registration as open until owner approval.
- Defer payments, account creation, general CMS, waitlist, QR scanning, messaging, advanced dashboard and unrelated redesign until required for a later phase.

## QA gates
- [ ] Hub and detail navigation, mobile 360/390 and desktop; keyboard and readable controls; no content crop issue.
- [ ] Registration closed/open/full, invalid fields, duplicate retry, network failure (no false success), concurrency at last available slot (no overbooking), one confirmed record per successful attempt.
- [ ] No PII in public API/logs; unauthenticated staff access denied; protected export and correct counts.
- [ ] All storefront routes, lookbook, preorder state and cart read-only regression; no actual order or payment.
- [ ] Snapshot/backup/reconciliation plan, release and rollback plan; owner approves public event details and opening.
- [ ] Report commit, preview URL, test evidence PASS/FAIL/NOT RUN; stop at approval boundary.

## Parallel work and order
- Today: hub + event template and test-only registration contract/schema; prepare isolated preview.
- 27 Nov 10:00 Thailand: separately finish live cart QA on custom domain (no real submission).
- Review event preview and confirm real event requirements before enabling registration. If deadline precedes completion, use the already-approved form fallback.
