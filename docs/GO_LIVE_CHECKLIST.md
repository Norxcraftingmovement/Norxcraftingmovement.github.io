# Go-live checklist — Orders V2 (production cutover)
Status: PLAN ONLY. Nothing here is approved or executed. Every step marked OWNER needs the owner's explicit go-ahead and (for Cloudflare dashboard/DNS/routes/Access) the owner's own access. Staging evidence: HANDOVER.md "Staging deployment" sections.

## A. Gates that must be green before the cutover window (none can be skipped)
1. **Deployed V1 = the source we ported** (OWNER): compare the live Apps Script deployment version with the source used for `tests/fixtures/v1-golden.json` (MIGRATION_PLAN "ตรวจว่าซอร์สตรงกับเวอร์ชันที่ deploy").
2. **Staging checks on the build that will ship**: owner-session smoke/UI (`staging-smoke`, `staging-ui-check` or manual equivalent), order → pay-later/QR → confirm payment → production status → label PDF → notification, on synthetic data. Result recorded in TEST_REPORT.
3. **Email**: one real message accepted by the provider to the verified owner address; inbox delivery confirmed by the owner (provider acceptance ≠ delivery).
4. **QR**: scan a staging QR with a real banking app; payee name matches (D23).
5. **V1 rehearsal**: real V1 export (private, never committed) → `planSync` dry-run → `runSync` into a COPY/staging D1 → `reconcileState` = 0 diff (counts, items, totals, per-status, per-order recipient/address/round); orphans reviewed.
6. **Rollback rehearsal on staging**: freeze V2 → export orders created after cutover → apply to V1 Sheet with the reverse script → switch `NORX_API` back; verify zero lost orders (needs the reverse script; not yet written for production — see D).

## B. Production resources (OWNER creates; no billing change beyond the current Free plan)
- D1 `norx-orders-production` (new, separate from staging and from Events/Media); new rate-limit namespace; Access app for the admin path (owner-only, new AUD).
- Render production configs from the committed placeholders with env vars (same pre-flight/identity/guard tooling as staging; marker `environment=production`; NO synthetic seed, NO test catalog).
- Real settings entered via Admin Console, not committed: storefront catalog/prices, receiving PromptPay ID (verified by payee name), sender, notification recipient.

## C. Cutover window (OWNER present; V1 stays the fallback)
1. Announce short freeze; set V1 to not accept orders.
2. Final V1 export → `v1-wins` plan → apply → reconcile = 0 diff, native-order count = 0.
3. Deploy production Workers (D1 + vars), verify identity first. No routes yet.
4. Gate script against production host without credentials (all protected paths 302/403, public order API only reachable as designed).
5. Add routes for `/api/orders*` (public) and `/admin*`, `/api/admin/*` (Access) on the production hostname.
6. Change the storefront `NORX_API` from the Apps Script URL to `/api/orders` (single, revertible commit on the production branch — requires approval to merge; never auto-merged).
7. Place 1 real low-value order yourself; verify receipt, Admin, notification; then open.
## D. Rollback (non-destructive)
Revert the single `NORX_API` commit, remove production routes, keep D1 untouched; export V2-native orders to the V1 Sheet with the reverse script (to be written and rehearsed in A6), reconcile.

## E. What is still missing in code (as of `9f24911`, Recovery Mode)
- Reverse export V2 → V1 Sheet (A6/D) — the earlier local version was lost with 7b20b5f; to be rewritten (Recovery R4).
- ~~Partial receipts / pickup queue + migration `0002`~~ — restored on GitHub in `cf1fed0` from the code running on staging (Admin 589b707d).
- Deferred (owner-approved, not needed to open): round create/edit UI, `0003` event name per round + `shop.js`, weekly-round switch on the Orders page, `rehearse-v1-local`.
- Not started: batch status actions, `/track/` (next after Orders V2 integration), Products management.

## F. Timing (owner direction, 2026-11-27)
No cutover and no production backend change before MOVE KIDS (13 Dec 2026) and the Home Terrain delivery window, unless the owner decides otherwise separately.
