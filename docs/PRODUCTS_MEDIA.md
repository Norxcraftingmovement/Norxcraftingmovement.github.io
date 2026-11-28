# Products cover + template preview v1

Development only; no Cloudflare resources, bindings or deployments changed.

## Owner workflow

Enter draft data → choose one cover → preview phone/desktop → return and save draft.
Any edit invalidates the previous preview. Choosing a file is local only; upload occurs with
the draft save. JPEG/PNG/WebP, at most 4 MiB; browser decodes before preview, server checks
type/signature and bounds the streamed multipart body. No SVG, arbitrary image URLs or filenames as keys.
Text-only draft saves remain available when storage is absent; upload control explains why it is unavailable.

## Current preview: two product themes

Preview now extracts **both inline style blocks** from each committed product page and applies
its body class, including Woven Stride's paper theme. Layout markup is shared and data-driven;
Home Terrain and Woven Stride remain distinct. Versioned theme choice is independent of fit,
price and sizes, saved for drafts atomically in the existing settings table alongside product/audit
revision guards (no migration). Existing slugs default to their original theme.

Read-only existing-product previews load source-derived hero, gallery groups and measured size
charts. Home Terrain also includes its 9-image Lookbook. Original inline Lookbook JPEGs become
content-hashed static files in the standalone staging build, avoiding a large Admin JS payload.
The theme fixtures module contains only data/image paths, not image bytes, private configuration,
live API URLs, checkout scripts or embedded source HTML. Generated source fixtures are freshness-checked.

This is still a preview renderer, not the deployed automatic product page: menu destinations,
checkout, live round dates and payment are intentionally inactive/omitted. Existing active products
remain read-only until the separate content-draft editor is implemented. PR17's first-style-only
preview is superseded. Theme/galleries/sizing render correctly in developer local checks; complete
preview/published snapshot parity remains a later staging publication gate. See PRODUCT_THEMES_PLAN.md.

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
