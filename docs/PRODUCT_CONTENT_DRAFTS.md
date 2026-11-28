# Product presentation drafts — development only

## Owner workflow

Products → **แก้เนื้อหาหน้าเว็บ** → edit story/theme, highlights, hero and grouped photos,
Lookbook, captions/alt text, and measured sizing → phone/desktop preview → save content draft.
Any edit invalidates review. The page says clearly that the online storefront is unchanged.
Existing active products, including products referenced by orders, can have a presentation draft;
their commercial editor remains locked. Archived products are read-only. No Publish is exposed.

Defaults come from the two existing source pages via the generated JSON fixture. Once a draft
exists, the editor loads the saved content/revision rather than resetting to the source.
Commercial product name/slug, fit, available sizes, prices, rounds, product status and old order
snapshots are never written by this module. The display heading is a separate content field.

The editor supports reordering groups/photos/highlights, moving photos between a gallery group
and Lookbook, adding/replacing/removing images, and per-product measurement rows/columns/notes.
Units are inches or centimetres. Changing units **does not convert values**; the form explains this.
Measurements are positive numeric strings or `—` for unknown values. The table does not change
which sizes can be purchased. Text is plain text; arbitrary HTML, CSS and remote image URLs reject.

## Persistence and guards

- Owner Access + environment guard: GET/PUT `/api/admin/products/:id/content`.
  Page `/admin/products/:id/content/`; writes require same origin. Preview framing CSP is scoped
  to Products and this editor; sandbox allows same-origin resources but no scripts.
- No migration. Draft `{version:1,content}` uses existing `settings` key `product-content:<id>`.
  Independent revision is the latest `audit_log` entry for entity `product-content` and product id.
  Conditional audit insertion + guarded settings upsert run in one D1 batch. Concurrent/stale edits
  reject without mixing state. A corrupt/unknown stored version fails rather than overwriting it.
- Strict keys distinguish presentation from commerce, including at the API boundary. Image sources
  must come from this product's source defaults/current draft or files in the current save request.
  Callers cannot introduce arbitrary object keys, remote URLs, another product's private images,
  upload markers without files, or extra/unreferenced multipart files.
- Bounds: JSON 64 KiB; 40 images total, at most 8 gallery groups/24 photos per group or Lookbook,
  8 highlights, 2–6 measurement columns and 1–30 unique size rows. Native form labels, 44px controls,
  scrollable sizing table, discard/reload dialog and unload protection preserve unsaved work.

## Images

Selection/decoding/preview is local until save. New files use the proposed dedicated private
`PRODUCT_MEDIA` binding (still absent from real Wrangler config). Existing content edits and photo
ordering work without storage; file pickers explain why they are unavailable.
JPEG/PNG/WebP only, max 4 MiB each, at most 8 new files and 12 MiB total per save. Request streams
and metadata are bounded; signatures are checked before any object is uploaded. Browser checks
decode and a 40-million-pixel ceiling. Filenames are not retained as keys or metadata.

Each upload gets an immutable generated key. Metadata/keys are committed with the content revision;
known unreferenced new objects are cleaned after failure. Post-commit response/read failure checks
references before cleanup so accepted images are retained. Uncertain/old objects are retained for
recovery; retention/cleanup policy remains part of storage enablement approval.

Owner-only image GET checks both existing product covers and current content-draft image references,
using a JSON-valid guard and JSON tree traversal. Once removed from all current references, the URL returns 404 unless a retained website snapshot still needs it for owner-only rollback review; historical bytes never become publicly readable merely by existing. These JSON functions are documented in
[Cloudflare D1 Query JSON](https://developers.cloudflare.com/d1/sql-api/query-json/); actual deployed
D1/R2 rehearsal is still required. No public image route or public draft endpoint is added.

## Next and rollout boundary

Homepage editing and product publication/rollback now have local synthetic implementations; see
[PRODUCT_PUBLICATION.md](PRODUCT_PUBLICATION.md) for the current scope and validation. Actual deployed
publication, full checkout completion and SEO delivery remain separate work. This release neither deploys nor changes
the online static product pages, commercial API, live Events/Media, DNS, bindings or cron.
Before real image use: approve dedicated private storage/binding and Admin/static staging rollout,
back up D1, verify identity and Access gates, then rehearse multi-image save/cleanup, conflicting edits,
private reads, catalog/order invariance and rollback. Keep original storefront URLs and data intact.

Validation: TEST_REPORT → Existing-product presentation drafts (developer-reported, solo self-review).
