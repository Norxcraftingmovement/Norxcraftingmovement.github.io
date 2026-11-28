# STATE — NORX Website / Orders V2
> Start point only: verify git HEAD/status and current code first.

As of 28 Nov 2026 · latest development: existing-product presentation drafts · no new deployment
Rules: CLAUDE.md · Technical evidence: docs/TEST_REPORT.md · Status: https://trello.com/c/a89Pbdgg
Single Writer; Codex solo self-review, never label it independent QA. Routine development/tests/development merges authorized. No production/cutover/Cloudflare writes without scoped owner approval; no installs. Original Claude checkouts untouched.

## Current development
- Accepted Admin UX: warm beige/frosted surfaces, compact black/secondary pills, Sarabun and readable 44px actions. Overview/Orders/Production/Shipping/Settings/Products implemented, not rolled out. No decorative rings.
- Products drafts: commercial draft creation/edit, one private cover on save, explicit preview gate; active/archived/referenced commercial data remain locked.
- Two product themes: Home Terrain dark/orange; Woven Stride white/paper/grid. Complete source style blocks/body classes, shared preview markup and source-derived gallery/Lookbook/sizing fixtures. Versioned theme independent of fit. PR19 is the preceding merged baseline.
- NEW: Products → แก้เนื้อหาหน้าเว็บ at /admin/products/:id/content/. Edit display heading/lead/story/theme, highlights, hero/grouped galleries/Lookbook, ordering/moving images, alt/captions, measured table columns/rows/units/notes. Active/referenced products may save a separate content draft; archived read-only. Never writes product prices/available sizes/rounds/status/orders.
- Content draft uses existing settings + separate audit CAS revision in atomic batch, no migration. Strict payload/image provenance and bounded multipart saves. Preview invalidates on edit; private image reads require a current cover/content reference. See docs/PRODUCT_CONTENT_DRAFTS.md.
- Rounds in Admin (branch `feature/rounds-ui`, not merged, not deployed): create/edit a round on the Orders page, event name per round (migration `0003_round_event_name.sql`, `shop.js` shows it), weekly auto-rounds switch (V1 ROLLING_WEEKLY) next to the round box. Tests 283 / 281 pass / 2 skip / 0 fail (developer-reported). Needs the owner's yes before use: migration 0003 on D1 and a storefront (`shop.js`) deploy.
- Media is LOCAL SIMULATION only: PRODUCT_MEDIA not bound on Cloudflare. New photos upload on save, not selection; old/uncertain bytes retained for recovery. No Publish or live page changes. Original product URLs/source remain intact; preview checkout/menu destinations/dates are not live.
- Tests: 274 total / 273 pass / 1 existing skip / 0 fail. Browser 32/32 (content + draft + media + themes), 320/390/820/1440 checked; real render screenshots inspected. Developer-reported, solo self-review. See TEST_REPORT.

## Last approved staging rollout (prior evidence; not rechecked live this turn)
Source bc2b4d1: Public e1cabdf2 / Admin 27b04360. UX/Products/content drafts above not included.
D1 identity verified and backed up before that rollout; order/item counts unchanged at 25/29; Access 16/16 gated. Mock owner email alert reached NORX and forwarded-copy personal inbox; original retained, no new order/sales. No customer email flow approval.
Rollback before rollout: Public 26439a64 / Admin 9aa87251, keep D1. Do not use Admin eed44c52.

## Next exact action
Follow docs/PRODUCT_THEMES_PLAN.md stage 3: homepage editing + draft/published snapshots + explicit publish and rollback in local/synthetic staging preparation. Reuse product ids/URLs and theme renderer; complete preview/published parity and SEO delivery before claiming live management.
Prepare dedicated private storage/binding + rebuilt Admin/static staging rollout/retention/rollback for scoped owner approval before any Cloudflare write. No general deployment approval inferred from ordinary development go-ahead.

## Remaining go-live gates
- A1 source/deployed V1 and A5 masked import/reconcile were green in prior reports; owner figures/check again before cutover.
- A2 partial production receipt + payment/handover end-to-end still needs deployed staging rehearsal; local tests do not replace it.
- A3 owner alert delivery passed synthetic inbox test; not full customer mail/checkout.
- A4 banking-app QR and physical printed labels; A6 rollback applied to a COPY of real V1 Sheet remain open.
Keep security/approval/rollback gates; dates may move. Details: GO_LIVE_CHECKLIST and TEST_REPORT.

## Roadmap and parked ideas
NORX Management Platform: owner manages existing website and new products through Admin/templates. Then Website, Events, Content/Media, Routes/GPX, Analytics/SEO, Growth. Events existing runtime unchanged; full self-service event creation remains planned.
Owner parked referral/discount/commission idea: necessary website management first, no pricing or payout work authorized. Keep in Trello backlog; no diversion.
