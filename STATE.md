# STATE — NORX Website / Orders V2
> Start point only: verify current Git HEAD/status and code.
28 Nov 2026 · Homepage PR23 merged at 997eb5b; product publication checkpoint follows that base · no new deployment.
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
Only local simulator enables WEBSITE_MANAGEMENT_ENABLED; /api/site/* is owner-gated and enabled-staging-only. No real routes/flag/storage/deploy. Product-content publication now implemented locally; see the next section. Details: docs/WEBSITE_HOME_MANAGEMENT.md and PR23. Integrated-base tests: 293 total / 292 pass / 1 existing skip / 0 fail; browser 40/40 rechecked plus round dialog open/close (12 inputs), no JS errors. Solo self-review. Origin of this isolated checkout now targets canonical GitHub; original D: checkouts unchanged

## Product publication — development/local only
Existing active product pages now have saved-candidate preview, explicit publication, immutable baseline/history and rollback preserving the latest draft. Current commerce prices/sizes/rounds and distinct themes retained. Owner-gated, enabled-staging-only; local simulator preserves original product URLs and existing shop.js/cart. Real PRODUCT_MEDIA binding/flag/routes remain absent. Full preflight 302 total / 301 pass / 1 existing skip / 0 fail; browser 48/48, actual desktop/mobile visuals inspected. Developer-reported, solo self-review. Canonical implementation/evidence: docs/PRODUCT_PUBLICATION.md. PR24 Help remains a separate unmerged draft with its writer released; its index.html/help/build-list scope was not edited.

## Website staging rollout preparation
Opt-in config generator and private candidate files prepared; all three Wrangler 4.168.0 dry-runs pass, nothing uploaded. Read-only account/DB identity verified; migration 0003 pending and dedicated product bucket absent. Current 100% active deployment prefixes: Admin 27b04360, Public e1cabdf2, storefront 3bcf6749; full rollback IDs kept privately. Access owner identity stays independent of mail recipient. Canonical proposal, exact writes, private retention, tests and rollback: docs/WEBSITE_STAGING_ROLLOUT.md. Tests 306 total / 305 pass / 1 existing skip; final preflight sensitive scan/hygiene passed. No app/UI changes or deployed QA in this preparation; PR25 browser evidence remains local.

## Approved staging rollout — deployed; browser acceptance pending
Owner approved PR26 scope and explicitly authorized potentially sensitive local backup export. Backup 82,057 bytes restored into in-memory SQLite; staging marker/25 orders/29 items verified. Dedicated norx-product-content-staging created with r2.dev disabled; only migration 0003 applied. New 100% deployments from runtime source 8f1216d: Admin d5919d88, Public db1a4728, storefront 405e52fa. Added only staging /api/site/* route. Existing vars/bindings/owner identity/mail/rate limits/cron/routes preserved. Anonymous edge gate 32/32; post-deploy catalog/orders/settings fingerprint unchanged, 25 orders/29 items, notification queue still 3 dead/1 sent. No new order or email. Full backup/receipts/IDs remain ignored and private. Canonical evidence/status: docs/WEBSITE_STAGING_ROLLOUT.md.
Owner Chrome opened Website editor successfully. File upload through extension lacked file-URL permission; native picker fallback stopped because Computer Use could not confidently verify browser URL. Browser UI control ended immediately. Only unsaved homepage test text/alt changed; no uploaded image/draft/publication saved. Deployed UI/independent acceptance is incomplete, not equivalent to prior 48/48 local browser evidence.

## Next
Resume owner-browser deployed QA after restoring browser control: inspect current picker/form state, test image upload/privacy and saved preview→publish→rollback, open every Admin page and check phone/desktop. User approval for this synthetic rehearsal remains valid; do not re-request Cloudflare/backup approval. Keep extension permissions unchanged unless explicitly approved. Root and original staging product URLs still serve static baseline; /api/site links are the private published rehearsal path. PR24 Help remains excluded. No production/cutover/DNS/Access-policy/billing/customer email scope.
Rollback: use freshly captured pre-rollout Admin 27b04360/Public e1cabdf2/storefront 3bcf6749 (full IDs in private baseline) and prior /api/site route state if needed; preserve D1/R2 and the additive column. Do not restore an old DB over new writes or use Admin eed44c52.

## Go-live gates (unchanged; docs/GO_LIVE_CHECKLIST.md)
A1 V1 source/deployed, A5 masked import/reconciliation reported green; recheck before cutover. A2 partial receipt + payment/handover deployed staging rehearsal open; A3 synthetic inbox passed only; A4 bank-app QR and printed labels open; A6 rollback on COPY of real V1 Sheet open. Keep security/approval/rollback gates.
Roadmap: owner self-service existing website/new products → Events, Content/Media, Routes/GPX, Analytics/SEO, Growth; Events runtime untouched. Referral/discount/commission parked, not authorized.
Previous complete state: Git commit 0c135de (STATE.md).
