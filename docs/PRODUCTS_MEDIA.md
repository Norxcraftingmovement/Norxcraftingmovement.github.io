# Products cover + template preview v1

Development only; no Cloudflare resources, bindings or deployments changed.

## Owner workflow

Enter draft data → choose one cover → preview phone/desktop → return and save draft.
Any edit invalidates the previous preview. Choosing a file is local only; upload occurs with
the draft save. JPEG/PNG/WebP, at most 4 MiB; browser decodes before preview, server checks
type/signature and bounds the streamed multipart body. No SVG, arbitrary image URLs or filenames as keys.
Text-only draft saves remain available when storage is absent; upload control explains why it is unavailable.

Preview v1 uses Home Terrain's hero/detail/size/order sections and **the exact stylesheet
extracted at build time from `home-terrain/index.html`**. The stylesheet was compared with
the live `/home-terrain/` response on 28 Nov 2026 and matched. Preview markup is a new data-driven
template, not the existing static page or a deployed automatic product page. It deliberately omits
old product claims, fabricated measurements, round dates, gallery images, checkout and legacy API calls.
No Publish exists. Future publish work must reuse the template/layout and add measured sizing,
gallery, round association and public image delivery before claiming complete storefront parity.

## Storage and failure handling

`PRODUCT_MEDIA` is a proposed dedicated **private R2 binding**. It is intentionally absent from
Wrangler configuration until scoped owner approval. Never bind it to the live Events poster storage.
The local server implements the same put/get/delete interface in memory using synthetic catalog data.
No schema migration: immutable generated object keys use existing `products.image_key` and atomic
product/audit revision guards. Raw clients cannot submit object keys. Product image GET requires
owner Access identity, correct environment and a current product reference; private/no-store/nosniff.
There is no public draft-image route. Active/archived/referenced products remain read-only.

Failed transactions attempt to delete only the newly uploaded unreferenced object. Cleanup checks
the database so a failure after commit cannot delete an accepted image. Old replaced/removed bytes
are retained, but their URLs return 404 when no current product references them. This preserves
rollback material; no automatic deletion or retention policy is introduced without approval.

## Before any staging enablement

Prepare and obtain scoped approval for dedicated private storage/binding + Admin deployment;
check account, binding isolation, D1 backup and rollback version under the existing CRITICAL workflow.
Confirm storage retention/cleanup, and rehearse owner/anonymous image access, upload failure,
revision conflict, image replacement/removal and rollback on deployed staging. No customer orders,
public bucket/custom domain, Events Media changes, public publishing or production cutover is covered.
Revert the Admin deployment to roll back code; retain database and immutable objects for recovery.

Evidence: TEST_REPORT → Products cover and storefront template preview.
