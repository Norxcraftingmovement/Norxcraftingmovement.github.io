# Homepage management and publication rehearsal

Development/local only. No Cloudflare writes, deployment, production/V1, original `index.html`,
DNS/routes/bindings, Events or real customer data changed.

## Owner workflow

Website → edit homepage hero image/focal position, heading/brand line/lead/buttons, collection
heading/copy, existing product-card titles/subtitles/order/visibility, page title/description →
phone/desktop draft preview → save draft. Images upload only on save. A failed save keeps edits/files.
Existing product links and commercial data are fixed; adding new product pages is separate work.
Unmanaged homepage Community/Roots/Event links and original community image viewer are retained.

After saving: review the saved candidate → explicitly check confirmation → use in the test system.
The first publication stores the original homepage content as a baseline. A history item must also
be reviewed/confirmed before rollback. Rollback changes the published head, preserving the current
draft. At present this publication mechanism covers **home only**, not product-content drafts.
Product publication and actual live-route integration remain next work.

## Same rendering source

`website-home-source.mjs` compiles the trusted current homepage at build time. Defaults/card identities
are extracted from their real markup/links; original unmanaged sections remain. Legacy API configuration
and inline scripts are excluded. Inline CSS declarations become generated classes, permitting strict CSP.
The original community viewer is served as a separate same-origin script. The only storefront runtime
bootstrap points to `/api/orders`; original production source and `shop.js` are unchanged.

The editor preview, saved-candidate review and server-rendered test publication use the same pure
renderer and compiled source. Preview disables links/scripts, uses private images, and is sandboxed;
test publication adds a staging banner, same-origin cart/config behavior and public-snapshot image paths.
Managed text/metadata/cards are in the initial HTML. Prices are server-rendered from current catalog
data using the storefront format, then maintained by the existing storefront runtime.

Run `node scripts/build-orders-admin-assets.mjs` to regenerate both Admin assets and the separate
`website-home-assets.mjs` artifact. The storefront Worker does not import the full Admin bundle.
The source/template/CSS/script fingerprint invalidates reviews across renderer changes. Historical
snapshots with another renderer fingerprint cannot be blindly restored; compatibility/revalidation
is required. This is content rollback within a compatible template, not arbitrary code rollback.

## Data and publication gates

No migration. Existing settings hold `website-home:draft`, immutable `website-snapshot:<id>`,
current `website-published:home`, and short-lived `website-review:<id>` tickets. Draft audit revision
is separate from publication audit. Conditional audit insertion and guarded draft/head/history writes
run in D1 batches. Stale/concurrent writes do not overwrite a newer state.

Review tickets bind owner, draft revision, current published head, candidate content, observed catalog
prices and renderer version, expire after ten minutes, and are consumed on publication. Old expired
tickets are pruned on review. Backend checks reject changed/expired/used/wrong-owner reviews. The
editor clears confirmation when a preview closes and marks each iframe view so an earlier load event
cannot unlock a newer confirmation. Review and confirmation are separate from draft saving.

Publication/review require `ENVIRONMENT=staging` and `WEBSITE_MANAGEMENT_ENABLED=1`. The flag is set
only by the local simulator in this change, absent from real Wrangler configuration. The new `/api/site/*`
rehearsal routes always require owner Access identity independently of the legacy staging flag, plus
the D1 environment guard; they reject other environments and are not anonymous customer routes.
The local simulator serves the published homepage at `/`, otherwise its existing static fallback.
No Cloudflare routing to these new endpoints has been configured.

Hero uploads are private JPG/PNG/WebP, ≤4 MiB, generated immutable keys; metadata is bounded to 32 KiB.
Unknown fields, arbitrary image URLs/links, unknown products and duplicate/missing product cards reject.
The existing two cards can be reordered/hidden without changing stock, product ids, prices or rounds.
Private owner image reads now include current drafts and retained website snapshots for rollback review.
`/api/site/media/*` serves only the current published homepage hero under the staging owner gates;
retired public paths return 404. Historical recovery bytes remain private. No object retention/deletion
policy or real storage binding is enabled by this work.

## Before approved staging/live rollout

Prepare scoped approval for dedicated private storage/binding, rebuilt Admin/Public/static artifacts,
the new test routes/flag, identity checks, backup and rollback. Rehearse owner/anonymous gates,
preview/SSR content parity, publishing/rollback/conflicts, private/current/retired media, metadata,
existing cart/checkout, Community viewer and original URLs. Product-content publishing and customer-facing
production routing are separate approvals; existing Orders A2/A4/A6 go-live gates remain open.

Evidence: TEST_REPORT → Homepage editor and publication rehearsal (developer-reported, solo self-review).
