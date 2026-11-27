# Staging Runbook — NORX Orders V2
Status 2026-11-27 (final review applied): **prepared and rehearsed locally; nothing has been created, deployed or changed on Cloudflare.** Section 3 is for approval. Decisions applied: D17 Cloudflare Email Service, D18 `staging.norxcraftingmovement.com`, D19 synthetic data, D21 Access on the entire hostname, D22 Events untouched.
Hard rules: staging only · synthetic data only · **no real transfer, e-mail to a real customer, or paid service** · Production, Events, Media, Orders V1 unchanged · no production DNS change (the single new `staging` record is the only DNS change, owner action) · **nothing in this runbook deletes anything**.

## 1. Resource configuration (exact)
| Resource | Value |
|---|---|
| Host | `staging.norxcraftingmovement.com` — DNS record and routes are created by the owner **last** (after Access, see §3); never in a config file |
| Access | ONE self-hosted application on the **whole** hostname (no path), ONE policy: **Allow → the owner's e-mail only**. No Service Auth, bypass, "everyone" or public policy. Its AUD tag → `NORX_STAGING_ACCESS_AUD`. The application is created **before** the Workers are rendered/deployed and before DNS/routes exist |
| D1 | `norx-orders-staging` (new), binding `ORDERS_DB`, migrations `migrations/orders`, marker `meta.environment='staging'` |
| Rate limit | NEW namespace id (≠ the Events one `20261213`), binding `ORDERS_LIMITER`, **10 requests / 60 s — identical to production's value, never loosened for staging** (tested) |
| `norx-staging-storefront` | static assets from `dist-staging/` only; no bindings/vars/routes |
| `norx-orders-public-staging` | `src/orders-public-worker.mjs`; D1, rate limit, `send_email` binding `EMAIL` restricted to ONE verified owner address, cron `* * * * *`; `STAGING_REQUIRE_ACCESS=1` (owner check in the Worker too); vars `ENVIRONMENT`, `ORDERS_DB_LABEL`, `ORDERS_PUBLIC_ORIGINS`, `MEDIA_ADMIN_ENABLED`, `MEDIA_ACCESS_AUD`, `MEDIA_ADMIN_EMAIL_HASH`, `NOTIFY_FROM`, `ORDERS_ADMIN_URL` |
| `norx-orders-staging` (admin) | `src/orders-admin-worker.mjs`, **no static assets**, D1 only, owner check on every route |
| Routes (most specific wins) | `staging…/api/orders*` → public · `staging…/api/admin/*` and `staging…/admin*` → admin · `staging…/*` → storefront |
| workers.dev / previews | off in every file; confirm in the dashboard that no `*.workers.dev` route or preview URL is enabled for the three Workers |
| E-mail | verify the owner address as a **destination address** (Workers Free; verified-destination sends are free; arbitrary recipients need Workers Paid — **not used**). The `send_email` binding is restricted to that single address. `NOTIFY_FROM` must be accepted by the service; onboarding a sending domain may need DNS records — **not done, needs approval** |
| Production | not referenced by any staging file; production sections of the committed configs are `REPLACE_*` placeholders and fail closed |
No staging Worker has `EVENTS_DB`, `MEDIA_BUCKET`, R2, the production D1, the Apps Script URL or a real payment account.

## 2. Authentication for integration tests (D21 refinement)
Cloudflare Service Auth tokens have a different identity shape and are **not** guaranteed to carry an owner e-mail. The Orders Workers trust only a verified owner identity (`ctx.access` audience + e-mail hash) — never request headers (tested with forged `Cf-Access-*`/`X-Forwarded-*` headers) — and this is not weakened anywhere. Therefore: **no service token and no service-identity allow-list.** Integration tests use the owner's own authenticated session: run `node scripts/staging-session.mjs capture --base https://staging… --out .staging/owner-session.json` on the owner's computer (visible browser, sign in through Access once). The file is a credential: git-ignored, mode 0600, expires with the Access session. If non-interactive testing is ever wanted, a service identity would first need its real Access identity shape verified against Cloudflare's documentation and an explicit staging-only allow-list reviewed — not part of this deployment.

## 3. Deployment sequence (for approval) — generated as `.staging/deploy.sh`
**Prerequisites (owner), in this order:** (1) create the Access application + owner-only policy for `staging.norxcraftingmovement.com` and copy its AUD (nothing is reachable yet: no DNS record, no routes); (2) `npx wrangler d1 create norx-orders-staging`; (3) a new rate-limit namespace id; (4) verify the owner address as a destination address; (5) export `NORX_STAGING_D1_ID`, `NORX_STAGING_RATELIMIT_NS`, `NORX_STAGING_ACCESS_AUD`, `NORX_OWNER_EMAIL`, `NORX_NOTIFY_FROM`.
```
 0  node scripts/render-staging-config.mjs && node scripts/staging-preflight.mjs                   # offline; refuses production ids
 1  npx wrangler d1 list --json | node scripts/staging-verify-d1.mjs --id "$NORX_STAGING_D1_ID" --name norx-orders-staging   # name AND id, read-only
 2  npx wrangler d1 migrations apply norx-orders-staging --remote -c .staging/wrangler.orders.jsonc      # first write (idempotent)
 3  npx wrangler d1 execute norx-orders-staging --remote -c … --command "INSERT INTO meta(key,value) VALUES ('environment','staging') ON CONFLICT(key) DO NOTHING"
    npx wrangler d1 execute norx-orders-staging --remote -c … --command "SELECT value FROM meta WHERE key='environment'" --json | grep -q '"value": "staging"'
 4  npx wrangler d1 execute norx-orders-staging --remote -c … --file .staging/seed.guarded.sql           # guard + synthetic seed, repeatable
 5  node scripts/build-staging-storefront.mjs; wrangler deploy --dry-run ×3; wrangler deploy ×3           # NO routes yet: Workers unreachable
 6  OWNER: re-check Access (one Allow-owner policy; AUD matches)
 7  OWNER: add the DNS record "staging" ONLY, then the 3 routes
 8  node scripts/staging-gate.mjs --base https://staging.norxcraftingmovement.com                         # MUST pass before anything else
 9  integration tests (§4) with the owner session
```
Steps 2–4 are tested **exactly as listed** (SQL extracted from the generated script and executed twice on SQLite: second and third runs change nothing; a database marked `production` or unmarked refuses the seed and writes nothing; a failing file is rolled back whole; the marker command never overwrites an existing environment). Every remote D1 command has `--remote` and a config binding only the staging database. **Gate (step 8)** probes 16 paths with no credentials; each must end at Cloudflare Access (redirect to `*.cloudflareaccess.com` or content-free 401/403); any 200, application 404/body or foreign redirect fails. **If the gate fails: remove the three routes (and nothing else), fix the policy, run it again.**

> **Status 2026-11-27:** steps 0–4 done; step 5 done for the Admin and Public Workers; the storefront Worker failed with a 401 on asset upload and is deployed by the owner locally: `STAGING_STOREFRONT_DEPLOY_WINDOWS.md`. Do not repeat steps 2–4 or redeploy the two Workers.

## 4. Integration test plan (synthetic data only; owner session; ~10 minutes of pacing)
| # | Run | Pass criterion |
|---|---|---|
| 1 | `staging-smoke --orders 30` | 12 checks pass: unauthorised rejection, V1 config, creation/idempotency/validation, QR page, confirm→undo→re-confirm + duplicate bank reference, production/CSV/dashboard/labels data, latency, notifications, (`--with-cutoff`: close→cancel unpaid→send to shop→batch production) |
| 2 | `staging-smoke --orders 0 --rate-limit-test` | **rate limiting on its own**: a burst beyond the limit is refused for submits (no order created) and payment pages (429), then service recovers after the window |
| 3 | `staging-ui-check` | checkout QR panel, `/pay/`, PNG download, 7 pages at 390 px without horizontal overflow, no console/HTTP errors |
| 4 | labels | print one A6 and one A4 test label from Admin → Shipping (paper) |
| 5 | migration | anonymised fixtures: `planSync` → `renderSql(plan,{guard:"staging"})` → `wrangler d1 execute --remote --file` → read state → `reconcileState`: 0 diffs; second run no-op |
| 6 | notification failure drill | in Admin → Settings set the notification recipient to an address that is **not** the binding's destination (e.g. `drill@example.test`), create a test order, observe `failed`/`unconfirmed` with a code (no address stored), then restore the recipient and press "send again". **Never unverify or alter account-level destination addresses to simulate failure** (they are shared by the account) |
| 7 | PromptPay | enter a SYNTHETIC ID, verify with the typed payee name, create orders, view/download QR. **No banking app is used and no transfer is made.** Only the owner, later and with the real ID, scans the 1.00 THB preview to read the payee name without confirming (D23) |
**Rate limit vs the 30-order run.** The limit (10 / 60 s per IP, separate buckets for submits and payment views) is production-strength and stays. The smoke test **paces itself** (budget limit−1 per window; bursts are reserved at send time), so 30 orders + checks take roughly 6–7 minutes. Pacing waits are excluded from every latency figure, a rate-limited answer during a normal phase **fails the run loudly** (never silently skewing numbers), and rate limiting is exercised only in test 2.
**Latency.** Reported separately: order creation (client-observed p50/p95/max and server-side `order_creation`), dashboard data update (order response → first `/api/admin/pulse` change; the UI then refreshes within its 15 s poll), notification (enqueue → provider acceptance; cron every minute, bursts drained 6×25 per run). **No Cloudflare figure exists yet** (local numbers are SQLite).

## 5. Changing the receiving payment account — safe procedure (applies to staging and, later, production)
A PromptPay QR already issued cannot be changed: customers may have saved it. The system therefore **binds each QR (payload, payee name, masked ID) to the account it was issued for**; changing settings affects **new** orders only (tested: payload, image and displayed payee name of existing orders stay identical; new orders get the new account). Admin marks orders holding an old-account QR ("QR บัญชีเดิม") and the confirm dialog says which account to check.
1. Prefer a quiet moment: close the round or let unpaid orders be paid/cancelled first. Check Admin → Settings: it shows how many unpaid orders still hold a payable QR.
2. Saving a new ID while such orders exist is **refused until acknowledged** (the message states the count and that those QRs still point to the old account). Saving un-verifies the setting: new orders get **no QR** (bank-transfer fallback) until the owner re-verifies by scanning the 1.00 THB preview (no transfer) and typing the payee name.
3. **Keep the old account open and monitored** until every old QR's deadline has passed plus a grace period; reconcile those orders against the OLD statement (enter the bank transaction reference when confirming; a reference can confirm only one order).
4. If the old account is closed/compromised: Admin → Settings → "เพิกถอน QR ที่ค้าง" (confirmation required). Outstanding links then show "QR withdrawn — do not pay the old QR", orders stay `รอโอน`, nothing is marked paid, and customers are directed to the page chat. Money that still arrives is handled by manual confirmation.
5. Tell customers with open orders through the page before and after the change. Never test with real transfers: staging uses synthetic IDs and the scan-without-confirming step only.

## 6. Rollback (non-destructive)
Remove (or disable) the three routes — all traffic stops. Keep the Workers, the D1 database, the Access application and the DNS record for diagnosis. Nothing is deleted. Production is not involved at any point.

## 7. Not approved / not done
Production deployment, production DB migration, production DNS, Access changes beyond the staging application above (owner action), e-mail-domain onboarding / DNS, merging into the production branch, closing Orders V1, real customer data, any paid service, any real transfer.
