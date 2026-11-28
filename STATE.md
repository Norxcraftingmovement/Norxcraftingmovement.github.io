# STATE — NORX Website / Orders V2
> Start point only: verify current Git HEAD/status and code.
28 Nov 2026 · baseline 0c135de · PR21 merged · workflow-only changes; no new deployment.
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

## Next
Homepage editor, draft/published snapshots, explicit Publish/rollback, preview/published parity and SEO delivery using existing renderer/IDs/URLs (docs/PRODUCT_THEMES_PLAN.md stage 3; local/synthetic only). Prepare private storage/binding and rebuilt staging Admin/static rollout with retention/rollback for separate approval.

## Go-live gates (unchanged; docs/GO_LIVE_CHECKLIST.md)
A1 V1 source/deployed, A5 masked import/reconciliation reported green; recheck before cutover. A2 partial receipt + payment/handover deployed staging rehearsal open; A3 synthetic inbox passed only; A4 bank-app QR and printed labels open; A6 rollback on COPY of real V1 Sheet open. Keep security/approval/rollback gates.
Roadmap: owner self-service existing website/new products → Events, Content/Media, Routes/GPX, Analytics/SEO, Growth; Events runtime untouched. Referral/discount/commission parked, not authorized.
Previous complete state: Git commit 0c135de (STATE.md).
