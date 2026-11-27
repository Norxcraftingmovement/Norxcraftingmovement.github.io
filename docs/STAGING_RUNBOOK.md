# Staging Runbook — NORX Orders V2
Status 2026-11-27: **prepared and rehearsed locally; nothing has been created, deployed or changed on Cloudflare.** Every step in section 3 needs the owner (dashboard actions) or explicit approval. Decisions applied: D17 Cloudflare Email Service, D18 `staging.norxcraftingmovement.com`, D19 synthetic data, D21 Access on the entire hostname, D22 no live Events metrics (the Events system is not touched).

## 1. Resource configuration (exact)
| Resource | Value |
|---|---|
| Host | `staging.norxcraftingmovement.com` (DNS record + routes = owner action; **not** in any config file) |
| D1 | `norx-orders-staging` (new). Binding `ORDERS_DB`. Migrations dir `migrations/orders`. Marker row `meta.environment='staging'` |
| Rate limit | NEW namespace id (must differ from the Events one `20261213`), binding `ORDERS_LIMITER`, 10 requests / 60 s |
| Worker `norx-staging-storefront` | static assets from `dist-staging/` only. No bindings, no vars, no routes in file |
| Worker `norx-orders-public-staging` | `src/orders-public-worker.mjs`. D1, rate limit, `send_email` binding `EMAIL` restricted to ONE verified owner address, cron `* * * * *`. Vars: `ENVIRONMENT=staging`, `ORDERS_DB_LABEL=staging`, `ORDERS_PUBLIC_ORIGINS=https://staging…`, `STAGING_REQUIRE_ACCESS=1`, `MEDIA_ADMIN_ENABLED=1`, `MEDIA_ACCESS_AUD`, `MEDIA_ADMIN_EMAIL_HASH`, `NOTIFY_FROM`, `ORDERS_ADMIN_URL` |
| Worker `norx-orders-staging` (admin) | `src/orders-admin-worker.mjs`. **No static assets** (they would drop the Access identity). D1 only. Vars as above with `ORDERS_ALLOWED_ORIGIN=https://staging…` |
| Routes (most specific wins) | `staging…/api/orders*` → public · `staging…/api/admin/*` and `staging…/admin*` → admin · `staging…/*` → storefront |
| workers.dev / previews | **off** in every file (`workers_dev:false`, `preview_urls:false`); confirm in the dashboard that no `*.workers.dev` route or preview URL is enabled for these three Workers |
| Access | one self-hosted application on `staging.norxcraftingmovement.com` (whole host, no path), policy **Allow → owner e-mail only**; plus a **Service Auth** policy for one service token used only by `staging-smoke`. Copy the application AUD tag into `NORX_STAGING_ACCESS_AUD`. Defence in depth: the public Worker also refuses anyone but the owner (`STAGING_REQUIRE_ACCESS`), the admin Worker always does |
| Email Service | verify the owner address as a destination address (Workers Free supports verified destinations; sends to verified destinations are free — arbitrary recipients need Workers Paid, which we do **not** use). Sender (`NOTIFY_FROM`) must be an address on a domain the service accepts; **onboarding a sending domain may need DNS records — not done, needs approval** |
| Production | not referenced by any staging file. Production sections of `wrangler.orders*.jsonc` keep `REPLACE_*` placeholders and fail closed (owner check, environment guard, D1 id) until a separate approved production plan |
No staging Worker has `EVENTS_DB`, `MEDIA_BUCKET`, an R2 bucket, the production D1, the Apps Script URL, or a real payment account (PromptPay and bank details are synthetic, entered in Admin → Settings).

## 2. How the files are produced (nothing committed contains ids or addresses)
Committed `wrangler.orders*.jsonc` hold placeholders. `scripts/render-staging-config.mjs` renders **flat, staging-only** configs into `.staging/` (git-ignored) from environment variables, refusing production ids and shared namespaces, and runs the offline pre-flight (`scripts/staging-preflight.mjs`: staging-only bindings, no workers.dev/previews, Access vars set, one restricted e-mail destination, dedicated rate limit, cron present, no Events/Media/R2/Apps Script reference). `wrangler deploy --dry-run` on the rendered files was run with dummy values: all three Workers bundle and the bindings list is exactly the intended one (`EMAIL (owner)`, `ORDERS_DB (norx-orders-staging)`, `ORDERS_LIMITER`). This also caught that an assets-only Worker must not declare an assets binding (fixed).

## 3. Deployment sequence (for approval) — `.staging/deploy.sh` is generated from the same source
Owner prerequisites: create the D1 (`npx wrangler d1 create norx-orders-staging`), a new rate-limit namespace id, the Access application + AUD, the verified destination address, then export: `NORX_STAGING_D1_ID`, `NORX_STAGING_RATELIMIT_NS`, `NORX_STAGING_ACCESS_AUD`, `NORX_OWNER_EMAIL`, `NORX_NOTIFY_FROM`.
```
node scripts/render-staging-config.mjs && node scripts/staging-preflight.mjs                      # 0 offline
npx wrangler d1 list --json | node scripts/staging-verify-d1.mjs --id "$NORX_STAGING_D1_ID" --name norx-orders-staging   # 1 exact name AND id, read-only
npx wrangler d1 migrations apply norx-orders-staging --remote -c .staging/wrangler.orders.jsonc   # 2 schema (first write, only after 1)
npx wrangler d1 execute norx-orders-staging --remote -c .staging/wrangler.orders.jsonc --command "INSERT INTO meta(key,value) VALUES ('environment','staging') ON CONFLICT(key) DO NOTHING"   # 3 marker …
npx wrangler d1 execute norx-orders-staging --remote -c .staging/wrangler.orders.jsonc --command "SELECT value FROM meta WHERE key='environment'" --json | grep -q '"value": "staging"'      # … read back
npx wrangler d1 execute norx-orders-staging --remote -c .staging/wrangler.orders.jsonc --file .staging/seed.guarded.sql   # 4 synthetic seed; file starts with the environment guard
node scripts/build-staging-storefront.mjs
for c in orders orders-public staging-storefront; do npx wrangler deploy --dry-run -c .staging/wrangler.$c.jsonc; done    # 5 dry-run all, then deploy
npx wrangler deploy -c .staging/wrangler.orders.jsonc && npx wrangler deploy -c .staging/wrangler.orders-public.jsonc && npx wrangler deploy -c .staging/wrangler.staging-storefront.jsonc
```
Then (owner, dashboard): routes, DNS record, Access policy; in Admin → Settings enter FAKE bank details, links, a **synthetic** PromptPay ID (`0800000000`-style) and verify it, set Sender Settings, leave "open for real orders" ON only because the whole host is owner-only (or keep OFF and use the test key), open a round. Every remote D1 command carries `--remote` and a config that binds only the staging database; every file that writes starts with the environment guard (aborts the whole file if the DB's own marker is not `staging`); the Workers re-check the marker on every request and cron run.

## 4. Integration test plan (run after provisioning; synthetic data only)
Automated, over HTTP, using the Access service token: `node scripts/staging-smoke.mjs --base https://staging.norxcraftingmovement.com --header "CF-Access-Client-Id: …" --header "CF-Access-Client-Secret: …" --orders 30` (add `--with-cutoff` only when you are happy to close the current staging round). It refuses any non-staging/non-local host. Browser, using the same token: `node scripts/staging-ui-check.mjs --base … --header …` (needs Playwright). Both were rehearsed against `scripts/dev-staging-local.mjs` (same routing, Access emulation, mock e-mail): smoke 11/11, UI 15/15, QR decoded by an independent decoder.
| Area | Check | Pass criterion |
|---|---|---|
| Access | anonymous GET of `/`, `/api/orders`, `/pay/`, `/admin/`, admin APIs, admin write | none returns 200 / data (302/401/403) |
| Orders | creation, V1 receipt, ID format, replay, changed-payload refusal, 8 parallel replays | one order per requestId |
| Validation | wrong expectedTotal, unknown product, wrong round, honeypot, shipping once, pickup free | all refused/priced like V1 |
| Payments | QR block, token pages, wrong-token = unknown, QR views never change status; confirm → undo → re-confirm; duplicate bank reference refused | exactly one confirmed payment; integrity `[]` |
| Admin | auto-refresh (browser), dashboard, orders/production CSV (BOM, attachment), labels PNG/PDF (manual: print a test label A6/A4) | as designed |
| Production | totals, cut-off, batch batched→produced→received | totals equal; atomic |
| Notifications | Cron drains queue; failure recovery (temporarily unverify the destination → expect `failed` then recovery by retry); ambiguous policy | accepted by provider, p50 recorded; no more than 2 provider calls for ambiguous failures |
| Mobile | `staging-ui-check` 390 px on every page | no horizontal overflow, no console errors |
| Migration | anonymised fixtures: `planSync` → `renderSql` (guarded) → `wrangler d1 execute --file` → read state → `reconcileState` | `ok:true`, 0 diffs; second run no-op |
**Latency measurement.** The smoke test reports (a) order-creation latency as observed by the client (p50/p95/max over N sequential orders) AND the server-side `order_creation` figures from `/api/admin/metrics/latency`; (b) dashboard data update latency = time from the order response to the first `/api/admin/pulse` that reports it; the admin UI then refreshes within its 15 s polling interval (worst case ≈ 15 s + load time); (c) notification latency = enqueue → provider acceptance (cron every minute, so expect up to ~60 s). **No Cloudflare figure exists yet** — local numbers (2–4 ms) are SQLite and meaningless.

## 5. Rollback
Remove the three routes (or delete the staging Workers) and the DNS record; delete the staging D1. Production is not involved at any point.

## 6. Still NOT approved / not done
Production deployment, production DB migration, production DNS, Access policy changes (including the staging Access app above — owner action), email-domain onboarding / DNS, merging into the production branch, closing Orders V1, real customer data, any paid service.
