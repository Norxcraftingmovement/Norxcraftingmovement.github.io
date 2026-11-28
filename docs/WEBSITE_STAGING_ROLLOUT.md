# Website management: staging deployed, owner acceptance pending

28 Nov 2026. Owner approved the listed staging scope in chat and explicitly confirmed private data export.
Production/cutover, V1, Events/Media, DNS, Access-policy, billing and customer email remain outside scope.
Scope derives from PR25. PR24 Help remains a separate draft, excluded from this candidate.

## Execution checkpoint — deployed, browser acceptance incomplete

The prior export rejection was resolved through the owner's explicit confirmation, then approval review passed.
Fresh private backup `.staging/website/before-website.sql` (82,057 bytes) was restored into in-memory SQLite:
staging marker, 25 orders and 29 items verified. Treat it as sensitive; it is ignored by Git and was not published.
Live variables, bindings, schedules and deployment leases were compared before writes. The Access owner hash
remains independent of the notification destination; existing mail/rate-limit/owner settings were preserved.

- Created dedicated `norx-product-content-staging`; r2.dev read back disabled. No public domain/CORS/lifecycle change.
- Applied only migration 0003; existing catalog/pricing/sizes/rounds/orders/items/storefront data fingerprint unchanged
  after normalizing the new empty `event_name` column. Counts remain 25 orders/29 items.
- Activated 100%: Admin `d5919d88`, Public `db1a4728`, storefront `405e52fa` from runtime source at `8f1216d`.
  Used strict version upload then explicit version activation, keeping existing routes and schedules unchanged.
- Added only `staging.norxcraftingmovement.com/api/site/*` → `norx-orders-public-staging`; other routes preserved.
- Anonymous edge gate passed 32/32 (16 existing + 16 new paths including review/publish/media/assets).
  The first sandboxed probe could not reach the network; the actual network-enabled probe passed, so no exposure
  or route-removal action was inferred from the sandbox network error.
- Post-deploy commercial/order fingerprint and counts unchanged. Notification queue still 3 dead / 1 sent;
  no order created or email sent by this rehearsal. Full IDs, receipts and comparison data remain private.

Owner Chrome session successfully opened the new Website editor with the correct menu, source fields and media-ready
state. Browser testing is **not complete**: the extension file chooser lacks file-URL access. A documented native-picker
fallback was attempted without changing extension permissions, then Computer Use stopped because it could not
confidently verify the browser URL during the picker. UI input stopped. Homepage test text/alt were changed only in
the browser's unsaved form; no draft, uploaded image or publication was saved by that attempt.
Remaining: upload/read privacy, saved preview/publication/rollback and all-page/mobile visual-functional checks in
the deployed owner session, plus owner/independent acceptance. Do not report local PR25 tests as deployed QA.
Resume from the Website editor after restoring browser control; confirm current UI state before any input.

## What the owner will try

Sign in to the existing staging Admin, upload synthetic/example product photos, edit homepage/product content,
preview and save drafts, explicitly publish a saved candidate, inspect it through the private test link and roll back.
First rehearsal uses `/api/site/home` and `/api/site/products/drop03` or `drop02`; images/CSS/runtime use `/api/site/*`.
Staging root and original product URLs continue serving the static baseline in this first rollout.
Automatically replacing those URLs requires a separate routing implementation/review; this proposal does not claim that is deployed.
The production website, V1, Events/Media runtime, real orders/payments and customer email are outside scope.

## Readiness observed

- GitHub development base: PR25 merge `3d79bdc`; clean/synchronized at preparation start.
- Wrangler 4.168.0 already cached; no install. All three private candidate configs passed `deploy --dry-run`, no upload.
  Admin 903.71 KiB (gzip 215.01); Public 244.26 KiB (gzip 52.57); assets-only entry 0.37 KiB.
- Read-only Cloudflare checks: configured account is accessible; database name AND ID match `norx-orders-staging`.
  Migration `0003_round_event_name.sql` is pending. Proposed product bucket does not exist.
- Current active deployments read back at 100%: Admin `27b04360`, Public `e1cabdf2`, storefront `3bcf6749`.
  Full IDs and read results stay private in `.staging/website/rollback-baseline.json` and adjacent ignored files.
  Re-read immediately before any deployment; these are observed baselines, not an immutable live-state guarantee.
- New config tests 4/4. Application suite 306 total / 305 pass / 1 existing skip / 0 fail.
  Preflight's synthetic UUID finding was explicitly marked as a fake fixture; final sensitive scan/hygiene passed.
  PR25's 48/48 browser results remain prior local evidence; no deployed UI/R2 rehearsal has been performed.

## Candidate generation, offline only

`node scripts/prepare-website-staging.mjs --from <private-staging-input-directory>`

Reads the prior `deploy-admin.json` and `deploy-public.json` privately; emits three configs in ignored `.staging/website/`.
Rejects mismatched account/DB/Access policy, non-staging labels/names, wrong origins and weakened owner gate.
Access owner hash is retained independently of the notification destination; it is never re-derived from that address.
Uses committed notification/rate-limit/cron settings; **current live bindings, secrets, schedules and vars must be compared before deploying**.
Any unexplained difference stops rollout; do not overwrite a dashboard change or change mail/cron/security as a side effect.
Existing generic staging renderer/preflight still reject R2. The new opt-in validator permits only the dedicated bucket below.
No routes, domains, workers.dev, preview URLs or billing settings are enabled by these configs.

```powershell
node scripts/build-orders-admin-assets.mjs
node scripts/build-staging-storefront.mjs
node scripts/wrangler.mjs deploy --dry-run -c .staging/website/wrangler.orders.jsonc
node scripts/wrangler.mjs deploy --dry-run -c .staging/website/wrangler.orders-public.jsonc
node scripts/wrangler.mjs deploy --dry-run -c .staging/website/wrangler.staging-storefront.jsonc
```

Dry-run output contains private bindings. Keep stdout/stderr in ignored files; report verdicts only.
`WRANGLER_LOG_PATH` may point inside `.staging/website/` on sandboxed Windows.

## Exact write scope to approve before executing

1. Create one private R2 bucket `norx-product-content-staging`; no r2.dev/custom domain/public access, CORS,
   lifecycle deletion, Events/Media bucket, paid-plan change or billing action.
2. Bind `PRODUCT_MEDIA` to that bucket for the two Orders staging Workers; enable `WEBSITE_MANAGEMENT_ENABLED=1`.
   Public also gets the staging `ORDERS_ALLOWED_ORIGIN`. Existing owner Access/DB/rate-limit/mail settings stay intact.
3. After verifying account, staging DB marker/schema/pending list and a **fresh local backup export**, apply only pending
   migration 0003. It adds `rounds.event_name` with empty default (fallback to existing event name). Do not seed, import,
   reset the DB, change payment settings or migrate any production database. If any other migration is pending, stop.
4. Deploy current approved source to the three existing staging Workers; no production or V1 deployment.
5. Add only the route `staging.norxcraftingmovement.com/api/site/*` → `norx-orders-public-staging`, if absent.
   Retain the existing routes and whole-host owner-only Access. No DNS/Access policy edit or original-page remapping.
6. Owner-approved synthetic rehearsal only: draft/image/history writes and explicit test publications/rollback.
   No customer orders, real payment/QR or email send is authorized by this scope.

Commands below are a review list, **not a script to run unattended**. The owner's approval must cover these specific writes.
Use the verified candidate account and configs; preserve the full active deployment IDs privately for rollback.

```powershell
node scripts/wrangler.mjs d1 export norx-orders-staging --remote -c .staging/website/wrangler.orders.jsonc --output .staging/website/before-website.sql
# Verify readable backup, marker/schema/count baseline and migration list before proceeding.
node scripts/wrangler.mjs r2 bucket create norx-product-content-staging -c .staging/website/wrangler.orders.jsonc
node scripts/wrangler.mjs d1 migrations apply norx-orders-staging --remote -c .staging/website/wrangler.orders.jsonc
node scripts/wrangler.mjs deploy -c .staging/website/wrangler.orders.jsonc
node scripts/wrangler.mjs deploy -c .staging/website/wrangler.orders-public.jsonc
node scripts/wrangler.mjs deploy -c .staging/website/wrangler.staging-storefront.jsonc
# Owner/dashboard: only the exact /api/site/* route above; capture its previous state first.
```

The bucket command pins account selection through the verified private candidate config.
Do not omit that config when more than one account is accessible.

## Acceptance and stop conditions

Before sharing any link, run the existing anonymous Access gate, then independently probe new paths:
`/admin/website/`, `/admin/products/1/content/`, `/api/admin/website/home`, `/api/admin/products/1/content`,
both review/publish POST endpoints, `/api/site/home`, `/api/site/products/drop03`, CSS/runtime and a private media URL.
Every anonymous request must stop at Access without application content. Application 200/404 or worker-level
`ACCESS_REQUIRED` content is not evidence of an edge gate. Route and Access mismatch stop the rehearsal.

With an owner session: open **every** Admin page; test 360/390/768/1440 widths visually and functionally.
Upload JPG/PNG/WebP, failed-save retry, draft privacy, fresh-preview confirmation, renderer/version rejection,
publication and rollback retaining the latest draft. Check private historical media versus current published references.
Compare DB order/item counts and commercial snapshots before/after; no sales/round/payment mutations are expected.
Check both themes and current catalog picker/cart without submitting checkout. Record mail queue and cron baseline;
do not create an order to test email under this approval. Owner acceptance is separate from developer self-review.

## Retention and rollback

Retain current drafts, publication heads, all snapshots, referenced objects and uncertain uploads. No R2 lifecycle or
old-object garbage collection in this rehearsal. Keep the baseline export encrypted/access-controlled locally.
For content mistakes, use the reviewed snapshot rollback. For code/routing/security failure, stop test writes, restore
the three freshly captured 100% deployments and the prior /api/site route state; recheck the edge gate.
Keep D1 and R2 intact. The additive column may remain when reverting code; do not drop it or restore an old DB over
new writes. A database restore is a separate recovery decision requiring reconciliation and approval.
Never use Admin `eed44c52`. Prior historical rollback IDs are not substitutes for the fresh captured active baseline.

Go-live and production gates in `GO_LIVE_CHECKLIST.md` remain unchanged. No cutover is included.

## Owner-session UI rehearsal checkpoint — 28 Nov 2026, 18:54 Bangkok

Developer-reported, solo self-review through the owner's authenticated Chrome session against the deployed staging runtime. This is not owner sign-off or independent QA. No source/runtime changes, deployment, export, migration, route, Access/extension permission change, order submission or email send was performed.

- Homepage: changed only the hero overlay to a clearly labelled staging rehearsal marker; viewed phone/desktop draft previews; saved the draft; the unpublished `/api/site/home` returned 404 as designed. Reviewed the saved candidate, explicitly confirmed publication, and verified the marker and current catalog prices in the deployed page. Saved a second distinct draft, reviewed the original snapshot and explicitly rolled back. The published page restored `MOVEMENT IS PROOF.`; the second saved draft remained `STAGING DRAFT B · RETAIN AFTER ROLLBACK`.
- Products: repeated preview/save/saved-candidate confirmation/publication/original-snapshot rollback for `drop03` and `drop02`. Verified published headings and the distinct dark/orange and white/grid themes. Both published pages now show their original headings; the rehearsal headings remain in their saved drafts. Current prices were 520/620 and 510/610 baht respectively. The Home Terrain size picker loaded the current round, adding one XS short sleeve yielded 520 baht, and reducing it returned the cart to empty. No checkout was submitted.
- UI coverage: opened Overview, Orders, Production, Shipping, Products, Website and Settings. Orders/Production/Shipping/Products/Website/Settings had no document-level horizontal overflow at requested widths 360/390/768/1440. Overview was visually inspected at 390; Website editor was visually inspected at 390 and default desktop; product previews and published themes were inspected visually, including Woven Stride at 390. Console errors were absent in the inspected product publication pages and six-page navigation probes. These probes do not constitute complete per-page visual/interaction acceptance. A clipped screenshot call timed out, and the desktop homepage at the default roughly 943px viewport visibly clipped the large brand heading; retain this for focused baseline comparison. Do not report all responsive QA as passed.
- Existing menu destinations `/admin/events/` and `/admin/media/` return `{"error":"NOT_FOUND"}` on staging. Their runtime remains outside this rollout; no implementation or deploy was added.
- Upload remains blocked by the browser extension's file-URL permission. Native file-button input also reported unavailable coordinate geometry. No file was selected or uploaded; JPG/PNG/WebP, failed-save image retry and private/current/historical-image acceptance remain unverified. Do not classify this tool limitation as an application upload bug. Next step is owner manual file selection without a permission change, then resume the remaining deployed image tests.
- Post-rehearsal SELECT-only aggregate comparison against the existing private pre-rollout backup passed: 25 orders / 29 items; order monetary totals/status groups, item quantity/value/status groups, catalog counts/prices/active groups and round status counts unchanged. Notification queue remains 3 dead / 1 sent. There are now 3 saved content drafts and 3 published heads (homepage and two product pages restored to their original snapshots). Immutable history and all saved drafts were retained.
- Full-row fingerprint query was blocked by automatic approval review because reading all order rows may retrieve customer PII. It was not executed. The successful alternative returned aggregates only; this checkpoint does not claim a fresh full-row fingerprint check. Prior rollout evidence and private backup were not overwritten or re-exported.

Remaining: owner-assisted image selection/upload/privacy/current-vs-historical media checks, failed-save retry and stale/version rejection deployed acceptance, complete every-page desktop/mobile visual/interaction review, focused homepage clipping comparison, and independent/owner acceptance. Root/original product URLs remain static baseline; no production cutover or PR24 scope is included.

## Owner-selected JPG checkpoint — 28 Nov 2026, 19:03 Bangkok

This supersedes the earlier upload-blocked status for homepage JPG only. Developer-reported, solo self-review through owner Chrome; independent and owner sign-off remain open.

- The owner manually selected an example coffee JPG in the existing homepage form. Its visible thumbnail used a blob URL even though the file input had been cleared by the UI; an empty file input alone is not evidence that the application has no pending image. Updated only the test image alt text to describe that image accurately, inspected the draft preview, then saved the draft. The saved thumbnail became a private Admin product-image reference ending in `.jpg`; the owner could open its image bytes.
- Before publication, the corresponding `/api/site/media/` URL returned HTTP 404. Reviewed/confirmed the saved homepage candidate in the UI. The published homepage displayed the selected image, and the current published media URL loaded successfully.
- Reviewed and explicitly confirmed rollback to the original homepage snapshot. The published homepage returned to its original image and `MOVEMENT IS PROOF.`. The retired site-media URL again returned HTTP 404. The private image still loaded, the saved draft retained its image reference, and the retained historical publication preview displayed the coffee image. No object, snapshot or saved draft was deleted. No console errors/warnings were captured in the homepage editor during this image flow.
- A fresh aggregate-only comparison at 19:03 matched the existing backup: 25 orders / 29 items, unchanged monetary/status/catalog/round summaries and notification queue 3 dead / 1 sent. Saved content drafts = 3; published heads = 3, all restored to original content. No full customer-row fingerprint query, export, deployment, migration, route/Access/extension permission change, order submission or email send was performed.
- PNG/WebP and product-editor uploads remain unverified. During the next native picker attempt, Computer Use explicitly stopped because it could not confidently verify the current Windows browser URL. Input stopped immediately; do not reuse its window/input state or assume a picker opened. No PNG was selected or uploaded. Do not treat this tool stop as an application defect. Extension file-URL permission remains unchanged; manual owner selection had worked for the JPG.

Remaining acceptance: PNG/WebP, product-editor image upload/privacy, failed-save retry, stale/version rejection, full per-page desktop/mobile visuals/interactions, focused homepage clipping comparison, and independent/owner sign-off. The prior text-only homepage/product publication and rollback checks remain valid. This evidence update changes documentation only; deployment/runtime source remains unchanged.
