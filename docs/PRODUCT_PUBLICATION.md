# Product presentation publication — local rehearsal

28 Nov 2026. STANDARD; developer-reported, solo self-review. No deployment or Cloudflare write.

## Owner flow

Products → existing product content → edit/upload → preview → save draft.
Then “ดูฉบับที่จะใช้ในระบบทดสอบ” → inspect the saved candidate → check confirmation → use it.
History → inspect an earlier candidate → explicitly confirm rollback. Rollback leaves the latest saved draft intact.
The UI locks editing while publication requests are pending and clears confirmation on closing/reopening a preview.

Home Terrain and Woven Stride retain their own themes, source images, gallery/Lookbook and measurement tables.
The same template renders saved-candidate previews and published content. Published mode restores original
navigation and the existing shop.js size picker/cart; previews cannot order. Published measurement units remain explicit.
Prices, sellable sizes and round availability always use the current commerce catalog/config, including after rollback.
This does not activate draft products, change commercial rows or allow arbitrary HTML/page layouts.

## Storage and guards

- Separate product-content drafts, immutable product-snapshot history and product-published heads in existing settings.
  First publication captures the previous default presentation as a baseline. The UI lists the latest 20 snapshots;
  older snapshots/objects are retained, not garbage collected by this release.
- Review proof binds actor, product, draft revision, publication head, current catalog data, content digest, theme renderer
  version and ten-minute expiry. Single-use consumption, audit, snapshot and head update share one D1 transaction.
  SQL guards also reject concurrent catalog/price/size/status changes, including writes without an audit entry.
- Only active, registered existing-page products may publish. Unknown/draft/archived products cannot publish;
  archived heads are not served. Incompatible template versions require compatibility review before reuse/rollback.
- Dedicated generated product source contains trusted fixtures/CSS/version hashes; public imports do not pull in Admin UI assets.
  Rebuild via `node scripts/build-orders-admin-assets.mjs` after template/source changes.
- Owner-only private media reads/failed-upload cleanup retain history references. The public test media path serves only
  references in current published heads; draft-only and retired-image URLs are not made public by retained history.
- All /api/site routes require verified owner access, matching environment and explicit enabled-staging flag.
  Responses are no-store/noindex; HTML uses same-origin CSP and no inline scripts. No anonymous production mode is enabled.

## Validation and rollout

Canonical result: full preflight 302 tests / 301 pass / 1 existing skip / 0 fail; no sensitive-value hits, hygiene pass.
Nine publication tests cover independent snapshots/themes, rollback/draft separation, actor/product/revision/head/expiry
and catalog binding, single use, concurrent confirmations, transaction failures, price/archive races, gating, SSR/runtime,
current versus historical media, renderer incompatibility and generated source isolation/freshness.
Browser: publication 8/8 plus existing Products/content/media/themes/homepage 40/40; actual picker → cart navigation,
both original product URLs, independent themes, rollback and four widths 360/390/768/1440. No JS exceptions.
Desktop/mobile storefront and Admin confirmation/history captures inspected; fixed mobile confirmation wrapping.
Results are local synthetic evidence, not independent QA or deployed D1/R2/Access validation.

Only the local simulator maps published products onto /home-terrain/ and /woven-stride/.
Original static product sources, index.html, shop.js, Events/Media runtime, Wrangler configuration and deployed source remain unchanged.
Real staging needs separately approved private storage/binding, D1 backup/identity checks, retention/rollback plan,
Admin/Public/static routing rollout and deployed rehearsal. Migration 0003 and prior go-live gates remain pending.
PR24 homepage Help work remains a separate unmerged draft and is not included here.
