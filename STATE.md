# STATE — NORX Website / Orders V2
> Start point only: verify current Git HEAD/status and code.
28 Nov 2026 · PR21/22 integrated locally with Homepage PR23; integration verified · no new deployment.
Rules: AGENTS.md → CLAUDE.md | Status: https://trello.com/c/a89Pbdgg | Evidence: docs/TEST_REPORT.md
Single writer; routine dev/test/dev merge authorized, no installs or unapproved Cloudflare/production/cutover writes. Solo self-review ≠ independent QA.

## Current development (not rolled out)
- Admin UX accepted: warm beige/frosted, compact pills, Sarabun, readable 44px actions; no decorative rings. Overview/Orders/Production/Shipping/Settings/Products implemented.
- PR19: Home Terrain dark/orange + Woven Stride white/paper/grid themes, source-derived galleries/Lookbook/sizing, versioned theme independent of fit. PR20: existing-product content drafts, private cover/media simulation, explicit preview gate, separate audit CAS revision; active/referenced commercial fields locked, archived read-only. No publish/live changes; PRODUCT_MEDIA not bound. Details: docs/PRODUCT_CONTENT_DRAFTS.md and docs/PRODUCT_THEMES_PLAN.md. Developer-reported tests 274 (273 pass/1 skip), browser 32/32.
- PR21 merged at 71ff354: create/edit round, event name per round (migration 0003, shop.js), weekly automatic rounds flag. Developer-reported LF checkout 283 (281 pass/2 skip), CRLF checkout 3 byte-exact failures. No migration/deploy; separate owner approvals for migration 0003, Admin and shop.js staging deploy.
- Workflow pilot: single start checklist, context-aware checkpoints, one Trello status header; not yet validated across sessions.

## Staging (prior evidence, not rechecked live)
Source bc2b4d1: Public e1cabdf2 / Admin 27b04360. Does not include recent UX/Products/Rounds. D1 counts 25 orders/29 items preserved; Access gate 16/16; synthetic owner alert reached inbox + forwarded copy, no sales/customer email approval.
Rollback: Public 26439a64 / Admin 9aa87251; keep D1; never Admin eed44c52.

## Homepage PR23 — development/local only
Website editor: hero/focal position, text/buttons, existing card order/visibility/copy and metadata. Shared homepage renderer; separate draft/published snapshots and baseline/history rollback preserving draft. Saved-candidate review binds owner/revision/head/prices/renderer, expires and requires explicit confirmation. SSR/current catalog prices, Community/Roots/lightbox retained. Original index.html untouched; upstream PR21 shop.js/rounds changes preserved
Only local simulator enables WEBSITE_MANAGEMENT_ENABLED; /api/site/* is owner-gated and enabled-staging-only. No real routes/flag/storage/deploy. Product-content publication remains pending. Details: docs/WEBSITE_HOME_MANAGEMENT.md and PR23. Integrated-base tests: 293 total / 292 pass / 1 existing skip / 0 fail; browser 40/40 rechecked plus round dialog open/close (12 inputs), no JS errors. Solo self-review. Origin of this isolated checkout now targets canonical GitHub; original D: checkouts unchanged

## Next
Finalize PR23 merge/checkpoint, then product-content published snapshots/preview parity/rollback using existing renderer/IDs/URLs (stage 3 remainder; local/synthetic only). Prepare private storage/binding and rebuilt staging Admin/static rollout with retention/rollback for separate approval.

## Go-live gates (unchanged; docs/GO_LIVE_CHECKLIST.md)
A1 V1 source/deployed, A5 masked import/reconciliation reported green; recheck before cutover. A2 partial receipt + payment/handover deployed staging rehearsal open; A3 synthetic inbox passed only; A4 bank-app QR and printed labels open; A6 rollback on COPY of real V1 Sheet open. Keep security/approval/rollback gates.
Roadmap: owner self-service existing website/new products → Events, Content/Media, Routes/GPX, Analytics/SEO, Growth; Events runtime untouched. Referral/discount/commission parked, not authorized.
Previous complete state: Git commit 0c135de (STATE.md).
