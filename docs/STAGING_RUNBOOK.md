# Staging Runbook (proposal — NOTHING here has been executed)
Status 2026-11-27: prepared only. No Cloudflare resource, DNS record, route, Access policy or deployment was created or changed. Every step below needs the owner (or explicit approval).

## Proposed layout: one staging host, everything separate from production
Host: **staging.norxcraftingmovement.com** (DNS record + routes = owner action, not approved yet).
| Route (most specific wins) | Worker | Bindings |
|---|---|---|
| `staging…/api/orders*` | `norx-orders-public-staging` | D1 `norx-orders-staging`, rate limit `ORDERS_LIMITER` (own namespace), cron `* * * * *` |
| `staging…/admin*` and `staging…/api/admin/*` | `norx-orders-staging` (admin, no static assets so Access identity is preserved) | D1 `norx-orders-staging` only |
| `staging…/*` | `norx-staging-storefront` | static assets only (`dist-staging/`) |
No staging Worker has `EVENTS_DB`, `MEDIA_BUCKET`, the production D1 or any production variable (enforced by tests in `orders-foundation` and `staging-storefront`). The storefront posts to the same-origin `/api/orders`; the production Apps Script URL, Events and Admin pages are not in the staging build (the build fails if they are).

## Owner steps (in this order)
1. Create D1 `norx-orders-staging`; put its `database_id` in `wrangler.orders.jsonc` and `wrangler.orders-public.jsonc` (`env.staging`). Create a NEW rate-limit namespace for the public staging Worker.
2. `npx wrangler d1 migrations apply norx-orders-staging --env staging -c wrangler.orders.jsonc` then `npx wrangler d1 execute norx-orders-staging --env staging -c wrangler.orders.jsonc --file seeds/orders-staging-synthetic.sql` (synthetic data only; also writes the `meta.environment=staging` marker the environment guard checks).
3. DNS: proxied record for `staging` (owner decision). Routes as in the table.
4. Cloudflare Access (owner): protect the **whole** staging host (owner only). Reason: the staging storefront shows fake bank details and accepts test orders — nobody should reach it by accident. The admin Worker additionally needs the Access AUD and the SHA-256 of the owner e-mail in `MEDIA_ACCESS_AUD` / `MEDIA_ADMIN_EMAIL_HASH` (placeholders in the config fail closed until replaced).
5. Build and deploy: `node scripts/build-staging-storefront.mjs && npx wrangler deploy -c wrangler.staging-storefront.jsonc`; `npx wrangler deploy --env staging -c wrangler.orders-public.jsonc`; `npx wrangler deploy --env staging -c wrangler.orders.jsonc`.
6. In `/admin/settings/` (staging) enter FAKE bank details and links; keep "open for real orders" OFF and set a test key; test orders then need `?test=<key>` on the storefront URL (V1 behaviour).
7. Notifications: see `EMAIL_NOTIFICATIONS.md` (nothing is sent until the owner configures a channel).

## Test plan on staging (synthetic data only)
Order creation (city/event/ship, multi-model cart), duplicate submit (double-click, retry), price/shipping change between page load and submit, round open/close edges, confirm → undo → confirm payment, on-site payment, cut-off, production summary/CSV/print, labels (A6/A4, Thai), unauthorised access to every admin route, auto-refresh while an order arrives, notification retry/dead-letter, mobile. No real customers, no real bank details, no real V1 export (use `tests/fixtures/v1-anonymized/` or a private export run through `scripts/anonymize-v1-export` first).

## Rollback
Remove the three routes (or delete the staging Workers). Production is not involved at any point.

## Still NOT approved (unchanged)
Production deployment, production DB migration, production DNS, Access policy changes (including the staging Access app above until the owner does it), closing Orders V1, touching real customer data.
