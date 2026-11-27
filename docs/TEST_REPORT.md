# Test Report
## Phase 00 — 2026-11-27
Baseline: `node --test tests/*.test.mjs` บน HEAD `c227b7a` (Node v22.23.5) → **30 tests, 30 pass, 0 fail** (admin-access, event-admin, events-registration, media-manager).
ยังไม่มีเทสของ Orders V2 (ยังไม่เริ่ม implementation). ไม่มีการรันกับ staging/production หรือข้อมูลลูกค้าจริง.

## แผนทดสอบ (Quality Gate) — สถานะ: Pending ทั้งหมด
Order creation · Duplicate submission · Server-side price validation · Cart compatibility (`norx-cart-v2`, `drop02/drop03`) · Payment status · Production summary · Batch actions · Thai shipping labels · A6/A4 layout · Secure tracking (enumeration/PII) · Admin authentication · Unauthorized API access (ทุก route 403) · Data migration (dry-run/reconcile) · Rollback · Mobile usability · Regression: Website/Events/Media · Staging isolation (config ไม่มี binding production)

## Phase 01 — Staging foundation (2026-11-27)
`node --test tests/*.test.mjs` → **35 tests, 35 pass, 0 fail** (30 เดิม + 5 ใหม่ใน `tests/orders-foundation.test.mjs`)
ครอบคลุม: staging config ไม่อ้าง D1/R2 ของ production · schema + constraints (ยอดเงิน, qty, order_no/request_key ซ้ำ) · ทุก admin route ปฏิเสธเมื่อไม่ผ่าน Access / path ไม่รู้จัก / method ผิด / host แปลก · owner ที่ยืนยันแล้วเห็น overview (ไม่นับออเดอร์ทดสอบ) · environment guard คืน 503 เมื่อ label กับ DB ไม่ตรงหรือ DB ไม่ได้ seed
ข้อจำกัด: ทดสอบด้วย SQLite ในหน่วยความจำและ mock ของ `ctx.access` ยังไม่ได้ทดสอบบน D1/Cloudflare จริง (ยังไม่มี resource staging)

## Phase 02a — Sender Settings + Shipping Labels (2026-11-27)
**Automated:** `node --test tests/*.test.mjs` → **57 tests, 57 pass, 0 fail** (35 เดิม + `labels.test.mjs` 12 + `orders-labels-api.test.mjs` 10)
ครอบคลุม: ตัดคำไทย/ที่อยู่ยาว/ชื่อยาว (ไม่ตกหล่นข้อความ, ไม่ขึ้นบรรทัดด้วยสระ/วรรณยุกต์) · เนื้อหาอยู่ในขอบ ≥7 มม. · ผู้รับเด่นกว่าผู้ส่ง (≥2× ขนาดตัวอักษร) · overflow ถูกแจ้งเตือน ไม่ตัดเงียบ · A4 4 ช่องไม่ซ้อน ขนาดจริง · PNG pHYs 300 PPI + CRC · PDF MediaBox A6/A4 และ xref ถูกต้อง · ทุก route ใหม่ปฏิเสธ anonymous / AUD ผิด / อีเมลผิด · CSRF (Origin/Content-Type/ขนาด) · Sender validation + audit · พิมพ์/บันทึกว่าพิมพ์ **ไม่เปลี่ยนสถานะ/ประวัติ** · แก้ที่อยู่/เลขพัสดุ + audit · CSP ไม่มี inline script/style · asset ที่สร้างอัตโนมัติตรงกับ source, โลโก้ byte-identical กับ `assets/logo.png` · schema จ่ายหน้างาน/completed/notification/latency

**Real browser (Chromium, เซิร์ฟเวอร์ local + ข้อมูลสมมติ, ไม่แตะ Cloudflare):**
- PNG ที่ส่งออก: 1240×1748 @300 PPI (A6), 2480×3508 @300 PPI (A4) — อ่านค่าจากไฟล์จริง
- PDF: `pdfinfo` A6 = 297.64×419.53 pt, A4 = 595.28×841.89 pt; poppler render ได้; ภาพเปรียบเทียบด้วยตา: ภาษาไทยถูกต้อง
- A4 วัดหมึกจริง: ระยะจากขอบกระดาษ ซ้าย 6.9 / บน 7.3 / ขวา 7.0 / ล่าง 7.3 มม.
- Print CSS (`@page` ชื่อ a6/a4, emulate print): A6 = 1 หน้า 298×420 pt, A4 = 1 หน้า A4 ไม่มีหน้าเปล่า
- มือถือ 390px: ไม่มี horizontal overflow; ไม่มี console/page error
- ไม่ได้ทดสอบ: การพิมพ์ด้วยเครื่องพิมพ์จริง (ต้องทดลองกับกระดาษจริงเพื่อดู non-printable area), Safari (ไม่รองรับ named `@page` → ขนาดกระดาษต้องเลือกในกล่องพิมพ์เอง), ฟอนต์ภาษาไทยบน Firefox, การใช้งานบน Cloudflare Workers จริง


## Phase 02 — Orders V2 core (2026-11-27)
**Automated:** `node --test tests/*.test.mjs` → **112 tests, 111 pass, 0 fail, 1 skipped** (skipped = differential กับซอร์ส V1 สด ซึ่งรันเฉพาะเมื่อตั้ง `NORX_V1_SOURCE`; **รันแยกแล้ว 5/5 ผ่าน** ด้วยไฟล์ที่เจ้าของส่งมา)
| ไฟล์ | จำนวน | ครอบคลุม |
|---|---|---|
| orders-core.golden | 5 | V2 core = V1 `NorxCore` ทุกเคสที่บันทึก: normalize 260 (รวมข้อความ error ภาษาไทย), quote 381, fingerprint 125, รอบ/ตัดยอดวันอาทิตย์/successor 517, summary+shopText 60, MOVES 56, receipt 113 · mapping สถานะ 6 ค่า lossless · กติกาเปลี่ยนสถานะ V1 |
| orders-service | 15 | สร้างออเดอร์, ค่าส่งต่อออเดอร์, รวมบรรทัดซ้ำ, **idempotency (รวม 12 คำขอขนาน)**, ราคาฝั่ง server (แก้ราคา/ฝัง ราคา), รอบ (ขอบเขต 1 ms), **atomic (รอบปิด/ราคา/ค่าส่งเปลี่ยนระหว่าง quote–commit; ล้มกลาง batch → ไม่มีแถวค้าง)**, ไม่รออีเมล, โหมดทดสอบ, config สัญญา V1, รอบรายสัปดาห์ (ขนาน 8 คำขอ → 1 รอบ), รหัส `ROUND-NNN` |
| orders-status-rounds | 7 | ขั้นสถานะ+payment/history/audit, stale/ขนาน, **จ่ายหน้างาน ≠ ชำระ (ไม่มี payment, นับผลิต ไม่นับรายได้)**, หลังตัดยอด, ตัดยอด/ยกเลิกไม่โอน atomic, สรุปผลิตบนข้อมูลจริง, pulse |
| orders-notify | 7 | ส่งสำเร็จ, ล้มเหลว→backoff 1m/5m/30m/2h/12h→dead + failure log, ส่งใหม่ด้วยมือ, ไม่มี provider, **dispatcher ขนานไม่ส่งซ้ำ**, worker ตายกลางทาง, webhook, latency แยกชนิด |
| orders-public-worker | 6 | สัญญา V1 (text/plain, HTTP 200), CORS, error ทั่วไปไม่รั่ว, preflight, rate limit, ไม่มี route admin, cron |
| orders-admin-v2 | 6 | **ทุก route/หน้าใหม่ปฏิเสธ anonymous/AUD ผิด/อีเมลผิด และไม่รั่วข้อมูล**, CSRF, flow เจ้าของ, 500 ทั่วไป, settings storefront (test-key เก็บ hash), CSP |
| v1-import | 5 | mapping 7 สถานะ, fail-closed, dry-run/idempotent/ไม่ซ้ำ, reconcile ตรวจจับการแก้, **retry ลูกค้า V1 หลัง import ได้ออเดอร์เดิม** |
| orders-foundation | 6 | schema/constraint (ตรวจเหตุผลที่ถูกต้อง), isolation ของ staging ทั้ง 2 Worker, guard |
| repo-hygiene | 3 | ไม่มีเลขบัญชี/อีเมลจริง/รหัส Sheet/URL Apps Script/ค่าคงที่ V1 ใน repo |
**Mutation check:** ถอด guard ใน SQL ของ INSERT ออเดอร์ทีละตัว (สถานะรอบ/เวลา, ค่าส่ง, ราคา) → เทส atomic ล้มทุกครั้ง (พิสูจน์ว่าเทสจับได้จริง)
**เบราว์เซอร์จริง (Chromium, local, ข้อมูลสมมติ):** หน้า Orders: ใส่ยอดผิดถูกปฏิเสธ/ถูกต้องผ่าน; **ออเดอร์ใหม่เข้าขณะเปิดหน้า → รายการอัปเดตเองใน ≤15 วินาที**; เปิด dialog ค้างไว้ + ออเดอร์ใหม่เข้า → dialog ไม่หาย รายการไม่ถูกแทนที่ แสดงแถบ "แสดงเลย"; มือถือ 390px ไม่ล้นจอ; ไม่มี console error. Label/PNG 300 PPI/PDF ยังผ่านหลังเปลี่ยน schema.
**ข้อจำกัดที่ต้องรู้:** ทดสอบกับ SQLite ในหน่วยความจำ (จำลอง D1: prepare/bind/batch ทรานแซกชัน) ไม่ใช่ D1 จริง — ความหน่วงที่วัดได้ (~2–3 ms ต่อออเดอร์) **ไม่ใช่ตัวเลขจริงบน Cloudflare**; ยังไม่ได้ทดสอบบน Cloudflare, ไม่ได้ทดสอบ cron จริง, ไม่ได้ทดสอบโหลดจริง, ไม่ได้ยืนยันว่าซอร์สตรงกับเวอร์ชันที่ deploy.


## Phase 02 review fixes + Phase 03 (2026-11-27)
**Automated:** `node --test tests/*.test.mjs` → see HANDOVER for the final count (all pass; 1 skipped = live V1 differential, which passes when run with `NORX_V1_SOURCE`).
New/changed: `orders-review-fixes` (7: **Confirm→Undo→Confirm ×3 = one confirmed + three void payments**, cancel voids, on-site collected once, DB-level unique guard, concurrent double-confirm, integrity audit, HTTP flow, imported paid orders carry payments; **NORX-LEGACY-001** through list/search/status/auth/404 shape) · `v1-delta-sync` (10: anonymised fixtures, anonymiser leaks nothing, first import reconcile = 0 diff, **delta snapshot 1→2 (13 updated, 3 inserted, 1 orphan kept, 2 rounds updated) reconcile = 0 diff**, idempotent re-apply incl. rendered SQL, offline-pipeline equals direct apply, conflicts / local changes / v1-wins with audit, stale-plan guard, native orders reported, 19 tamper cases all detected) · `orders-notify-p1` (7: **provider OK + worker stops before SENT → reclaimed, same idempotency key, duplicate marker, sent once more, never a third**, pre-call crash not flagged, ambiguous errors flagged, mock Cloudflare email binding content/headers/no network, address-free failure log, readiness, provider preference) · `staging-storefront` (4: no Apps Script / events / admin / production origin in the build, same shop.js, fails closed, assets-only config) · `orders-phase3` (8: dashboard, test-order filter, production summary incl. on-site ≠ paid and catalog ordering, CSV safety, orders CSV audit, **batch production status atomic + guards**, 8-entry menu on every page with strict CSP, auth/CSRF on new routes) · foundation (+ staging isolation for both Workers, unconfigured Access placeholders fail closed).
**Chromium (local, synthetic):** Overview cards + auto-refresh when an order arrives; Production table, CSV download (BOM + Thai header), print (nav/buttons hidden, 1 A4 page), batch "ผลิตเสร็จทั้งล็อต" via dialog; Settings storefront form (live-switch confirm); mobile 390px no horizontal overflow on Overview/Production/Settings/Orders; zero console/HTTP errors.
**Not tested / limits:** real D1/Workers, Cron, real e-mail (binding shape unverified), the staging host (not created), real private V1 export, printing on paper.


## Staging readiness (2026-11-27)
**Automated:** `node --test tests/*.test.mjs` → **175 tests, 174 pass, 0 fail, 1 skipped** (live V1 differential; 5/5 when run with `NORX_V1_SOURCE`). Two full runs back to back were identical (test files run in parallel; the smoke test uses its own build directory).
| File | Tests | Covers |
|---|---|---|
| orders-notify | 14 | **two consecutive TimeoutErrors = exactly 2 provider calls, then `unconfirmed`** (was 5) with no automatic attempts even after 99 days; normal failures = 5 calls then dead; mixed sequences bounded; worker stopped after the provider call → recovered as ambiguous, one flagged retry, never a third; stopped before the call; **8-way concurrent stale recovery = one outcome**; late finisher cannot overwrite recovery; atomic claim; **no PII anywhere in the notification tables**; Cloudflare Email Service mock (`{from,to,subject,text}`, messageId stored, no headers invented, no network); acceptance ≠ delivery; owner actions keep history; webhook 5xx ambiguous / 4xx definite |
| payments | 12 | CRC vector + independent implementation, PromptPay TLV structure for mobile/national/tax/e-wallet, **bank account numbers rejected**, amount bounds, QR SVG, owner verification flow (any change un-verifies, ID masked, audit masked), QR amount = saved total incl. shipping, token hashed + indistinguishable 404, QR views change nothing, states (expired/paid/cancelled/on-site, token rotation), confirm/undo/re-confirm with bank reference, **duplicate bank reference refused incl. concurrency**, cancel-unpaid cancels requests, route auth/CSRF, V1 receipt unchanged when QR off |
| staging-config | 8 | committed configs placeholders-only, preview/workers.dev off, production fails closed, render (flat, hash, restricted e-mail binding), unsafe inputs refused, 17 pre-flight tamper cases, D1 identity (name AND id), command sequence (`--remote`, `-c .staging`, identity before first write), environment-guard SQL (aborts on wrong/missing marker, nothing applied), guarded seed |
| orders-access | 2 | owner check identical to the Events Access Worker's (differential, 12 cases) without importing Events code; staging public Worker owner-only on every path |
| staging-smoke | 3 | full smoke suite 11/11 over real HTTP on the local simulation; suite detects failing e-mail and an unprotected host; refuses production hosts |
| status-rounds / public-worker | +2 | **regressions found by the rehearsal:** cut-off after a manual early close; a 40-order burst drained in one cron run |
**Rehearsal (local simulation, synthetic data):** `staging-smoke` 11/11 incl. cut-off, batch production, CSV, labels data, QR page, notifications via mock binding; `staging-ui-check` 15/15 in Chromium (mobile 390 px: checkout QR panel with order no./amount/payee/deadline, PNG download, `/pay/`, bank fallback + manual-verification notice, no overflow on 7 pages, no console/HTTP errors); **the on-screen QR was decoded by an independent decoder (jsQR) to the same payload stored in D1 (amount 490.00)**. `wrangler deploy --dry-run` of the three rendered configs succeeded (it also caught an invalid assets binding, now fixed).
**Not measured / not tested:** any Cloudflare latency (order creation, dashboard, cron/notification), real D1/Workers/Cron behaviour, real e-mail, scanning the QR with a banking app, printing labels on paper, the staging host itself. Local latency numbers are SQLite and carry no meaning.


## Final staging review fixes (2026-11-27)
**Automated:** `node --test tests/*.test.mjs` → **188 tests, 187 pass, 0 fail, 1 skipped** (live V1 differential; 5/5 with `NORX_V1_SOURCE`).
| # | Issue | Evidence |
|---|---|---|
| 1 | Seed vs marker | the runbook SQL is **extracted from the generated deploy script and executed exactly as listed, three times**: first run builds, later runs change nothing (database dump identical, migrations applied once, one marker row); a `production`-marked or unmarked DB refuses the seed and nothing is written; a failing file rolls back whole; every seed INSERT is `OR IGNORE`; the marker command never overwrites an environment |
| 2 | Access identity | identities without a verified owner e-mail (service-token shapes, empty/array e-mail, look-alike domains) denied by both the Orders and the original Access check; **forged `Cf-Access-*` / `X-Forwarded-*` headers ignored** on admin and public Workers; no service allow-list or environment branch in the code; owner-session → Cookie header helper tested (domain/path/secure/expiry); scripts contain no service-token headers |
| 3 | Rate limit | smoke paces itself under the limit (25-order run, 7.5 s of waiting excluded from latency); an unpaced run fails loudly with "rate limited during a normal phase"; separate `--rate-limit-test` phase (burst refused, payment endpoint 429, recovery after the window); missing limiter flagged; separate buckets for submits and payment views, GET config unlimited, refused submit creates no order; **staging limit identical to production (10/60)** asserted from the committed configs |
| 4 | Notifications | model-based test over all **243** outcome sequences vs an independent specification: ≤5 calls, **≤1 attempt after the first ambiguous outcome**, `dead` only if nothing was ambiguous, nothing after a terminal state, audit complete; explicit cases (ambiguous + 4 refusals = **2 calls**, was 5); crash-after-call then refusal = 2 calls → `unconfirmed`. Failure drill uses the Admin recipient setting, never account-level addresses |
| 5 | Payment safety | existing QR payload/image/payee name identical after the account changes, new orders use the new account; change refused without acknowledgement while unpaid QR orders exist (nothing saved), allowed when none; unverified state keeps old links valid but issues no new QR; **withdrawal** serves no QR, leaves orders pending and unpaid, never silently re-issues, owner-only + CSRF; admin flags old-account QRs; confirming an old-QR order links the old request + bank reference |
| 6 | Deployment order | test asserts: Access before DNS/routes, Workers deployed without routes, DNS/routes last, gate between exposure and every test, **no destructive command** in the script; gate judged on 16 probes (Access redirect or content-free 401/403 pass; 200 / application 404 / application body / foreign redirect fail); gate run against the local simulation both ways (blocked → OK, exposed → fails) |
**Rehearsal (local simulation, synthetic):** smoke 12/12 incl. rate-limit phase, cut-off, QR page, notifications; `staging-ui-check` 15/15 in Chromium; `wrangler deploy --dry-run` of the three rendered configs OK (316 KiB / 104 KiB / 0.35 KiB).
**Found during this round:** the harness itself briefly exceeded the limiter because burst tokens were reserved before sending (fixed: tokens recorded at send time); a test file initially hung because a suite with default 60 s pacing was run in a unit test (fixed: windows scaled in tests).
**Not measured / not tested:** anything on Cloudflare (D1/Workers/Cron/Email, all latency), the staging host, scanning a QR with a banking app, paper printing.


## Staging deployment results (2026-11-27) — first run on Cloudflare
| Step | Result |
|---|---|
| D1 identity (name + id), isolation (id not a production id; rate-limit namespace differs from Events) | pass |
| Migration `0001_core.sql` on remote D1 | pass (35 commands) |
| Environment marker `staging` written and read back | pass |
| Guarded synthetic seed | pass; read-back: 5 orders, 1 round, env `staging` |
| Deploy `norx-orders-staging` | pass (version `ab7af428-5ac7-40d2-b56b-104635835b61`) — D1 + vars only, no targets |
| Deploy `norx-orders-public-staging` | pass (version `26439a64-5d0f-4c87-a59c-44948ac0e651`) — D1, rate limiter, email, cron registered, no routes |
| Deploy `norx-staging-storefront` | **FAIL — `401 Unauthorized` on `POST /workers/assets/upload`** (retried twice, identical). Cause: asset upload uses a short-lived token the cloud credential proxy replaces; not an invalid API token (`whoami` and all other calls succeeded). No bypass attempted. Not deployed; no partial Worker. Plan: local Windows deploy (`STAGING_STOREFRONT_DEPLOY_WINDOWS.md`). |
**Still untested:** gate, Access behaviour, any HTTP request to the Workers, cron/notification behaviour, email, all latency figures (staging host does not exist yet). Code/test suite unchanged this round (188 tests, 187 pass, 1 skipped).


## Independent Codex Desktop check (2026-11-27)
Local source HEAD e8d9411, Windows, Node 22.11.0. Build: PASS (155 files, 5 rewrites). Assets-only config check: PASS (correct worker name; no routes/bindings; workers.dev/previews disabled). Automated storefront tests: NOT COMPLETED — node --test blocked by spawn EPERM; direct module execution fails Windows URL.pathname conversion (C:\\C:\\...). Pinned Wrangler dry-run: NOT RUN — npm install failed spawn EPERM; Wrangler 4.168.0 additionally requires Node >=22.12.0. No Cloudflare or integration result is claimed. See latest HANDOVER section for next action; no deployment or remote resource changes made.


## Storefront deployment and independent dashboard verification (2026-11-27)
Owner-provided local log: Node 22.16.0, Wrangler 4.168.0; build/config/dry-run passed; read-only D1 list found staging database in the selected NORX account. Storefront deployed successfully at 2026-11-27T05:57:09Z, version `8aac22f0-9c8d-4eb4-b53e-643a400136f8`, deployment 100%; no targets deployed. No database writes.
Codex independently inspected Cloudflare dashboard: storefront Ready/100% with matching version prefix; Bindings 0, no custom domains/routes, workers.dev and Preview URLs disabled. Access application `staging` covers staging.norxcraftingmovement.com with empty path; exactly one Allow policy, one Include/Emails rule for the owner; no Bypass/Service Auth policy. Application AUD matches MEDIA_ACCESS_AUD on both deployed Orders Workers; Public Worker STAGING_REQUIRE_ACCESS=1; both reference the staging D1 and staging origins. Public Worker has email/rate limiter bindings and a cron trigger; delivery/cron execution still untested.
DNS list contained no staging record. Prepared (NOT saved) AAAA staging -> 100::, proxied, TTL Auto in dashboard. DNS and FOUR route patterns remain pending; browser action-time confirmation requested before exposing the protected staging hostname. No Access setting or remote resource was changed during inspection. Security gate and integration remain NOT TESTED. Next: save the staging DNS record, add four exact patterns from Windows guide, immediately run unauthenticated gate before any application tests; remove staging routes only if gate fails.


## Staging routes and unauthenticated gate (2026-11-27)
Owner saved AAAA staging -> 100::, Proxied, TTL Auto; Codex verified the record in dashboard. After explicit owner confirmation, Codex added and verified four exact route patterns: staging.norxcraftingmovement.com/api/orders* -> norx-orders-public-staging; /api/admin/* -> norx-orders-staging; /admin* -> norx-orders-staging; /* -> norx-staging-storefront. The three existing production Events/Media routes were left unchanged. No Worker redeployment or database write.
Independent real-HTTP security gate: portable Node 22.16.0 ran `node scripts/staging-gate.mjs --base https://staging.norxcraftingmovement.com` without cookies/credentials. Exit 0; 16/16 probes PASS, all HTTP 302 to Cloudflare Access login, including GET/POST Orders/Admin APIs, storefront/static assets, pay, robots and nonexistent path. GATE OK; no rollback needed.
Status: staging deployed, routed and unauthenticated security gate PASSED. Owner-authenticated smoke/UI, email delivery/cron execution, latency, QR and label checks remain NOT TESTED. Next: owner Access login/session capture, then runbook integration tests using synthetic data only. Production cutover remains unapproved.


## Integration login blocker and Orders UI defect (2026-11-27)
Owner-run Playwright capture timed out at Google sign-in before session capture or smoke execution; .staging contains integration-gate.json only, no owner-session.json or smoke report. No test orders created by this run. Normal owner Chrome retained its valid Access session and loaded staging Admin successfully.
Independent UI navigation then found /admin/orders/ failing with `token is not defined`. Root cause: orders-app.mjs load() assigned undeclared token; shared refresher already owns pulse state. Removed the redundant assignment and regenerated Admin assets on feature/orders-v2 (code/assets commits through 19258acf). Local VM regression reproduces old ReferenceError, verifies corrected initial load + refresh and pulse token propagation; syntax check and asset generation pass. Fix NOT DEPLOYED yet. Prepared owner script deploy-staging-admin-fix-owner.ps1 for ONLY Admin staging redeployment with pinned Wrangler and reconstructed, validated staging-only config; no migrations/seeds or other Worker deploys. After deploy: verify routes + gate + normal-Chrome UI retest. Automated smoke/UI/latency/email/QR/cutoff tests remain incomplete; do not rerun the Google-blocked capture flow or weaken Access to bypass it. Paper printing/inbox delivery still require owner observation.


## Independent normal-Chrome integration checks (2026-11-27)
Orders UI fix VERIFIED live after owner Ctrl+Shift+R: list displays all five seed orders, round totals, notifications and latency sections; refresh no longer raises token ReferenceError. Confirms stale private,max-age=3600 module cache was involved.
Found missing storefront settings blocking Public API (ok:false/unavailable). Initialized ONLY staging settings with synthetic TEST BANK/zero account/test holder and example.test links; liveEnabled=true only on Access-protected staging to permit synthetic QA without a test key; rolling=false, notification recipient empty, PromptPay unset. Public GET /api/orders now returns ok:true, one test01 product, open ROUND-001, shipping 50; no order created this round. Static storefront lists drop02/drop03 while D1 currently exposes only test01: catalog alignment must be resolved before real checkout UI tests; do not treat public config success as checkout success.
Production UI: hides test seed by default; include-test checkbox reveals 4 production pieces (3 paid + 1 pay-later), pending 3 pieces, matching seed.
Shipping: missing-sender guard correctly disabled exports and showed guidance. Saved synthetic sender only. A6 preview rendered the long Thai test recipient/address. Selected TEST-0003 + TEST-0002, A4 slot 1, exported PDF. Download-event tool timed out but actual NORX-labels-A4-2026-11-27.pdf exists (144721 bytes); independent pdfinfo: one A4 page, 595.276x841.89 pt; Poppler rendered image visually reviewed: both labels/Thai content readable, no overlap/clipping, bottom two slots blank. Copied reviewed artifact to task outputs/NORX-labels-A4-staging.pdf. Paper printing NOT TESTED. Export may mark print metadata; no payment/fulfillment status change requested.
Remaining: automated owner-session smoke/UI still blocked by Google login in Playwright; no owner-session file. Public checkout catalog mismatch, no configured synthetic QR, no notification recipient; Admin readiness shows no send channel (Admin has no email binding, so this alone does not prove Public Worker email misconfiguration). No 30-order latency sample, email acceptance/inbox, cron dispatch, migration reconciliation, rate-limit/cutoff verification yet. Browser debugger detached after export; no further UI writes attempted. Production unchanged; staging Access unchanged.


## Staging mixed-cart checkout (2026-11-27)
Owner ran guarded catalog SQL on norx-orders-staging. Readback: drop02 regular, 11 sizes, 2 sleeves; drop03 boxy, 6 sizes, 2 sleeves; test01 retained. SQL tested locally for repeat safety and seed-order preservation before remote execution.
Independent owner-session Chrome check: added Drop 02 short M (510) and Drop 03 long L (620), selected shipping (50 once), and placed synthetic order NORX-7D56CF56. Checkout receipt and Admin agree at 1,180 THB, pending payment. Confirmed the synthetic payment status with a test reference and reverted to pending, both verified in Admin; no funds transferred. Admin recorded 147 ms for one server-side creation sample only. Notification was queued, then recorded one attempt with recipient_not_configured. This confirms queue processing but not provider acceptance or inbox delivery. Dynamic QR, duplicate submission, latency under multiple orders, rate limit, and the remaining integration checklist are still pending.


## Recovery Mode verification — home PC (2026-11-27)
Developer-reported by Claude (Windows 10, Node 24.20.0, wrangler 4.168.0). Not an independent retest.

| Check | Result |
|---|---|
| GitHub `d1d7213` suite (LF checkout) | 185 tests: 182 pass, 1 skip, 2 fail (generated-assets byte check — `admin-ui/orders-app.mjs` blob was CRLF; staging-storefront Windows path) |
| `0d2dbed` staging QR fix — build | `{ rewrites: 5, qrRemoved: 1, files: 154 }`, no `qr.jpg` in the output |
| `0d2dbed` suite | 188: 185 pass, 1 skip, 2 fail (same two); new QR tests 3/3; D18 storefront tests 4/4 with Windows-safe paths |
| Storefront deploy `3bcf6749` | pass; "No targets deployed"; dry-run "No bindings found" |
| Gate after deploy | 16/16 PASS (all 302 → Access), exit 0 |
| Staging `/cart/` (owner Chrome, read-only) | no `img.qr`, STAGING notice shown, `/assets/qr.jpg` 404, no console errors. Checkout flow not exercised (no open round) |
| D1 staging (SELECT only) | migrations 0001, 0002; schema diff vs 0001 = `order_items.received_qty` only |
| Deployed Admin `589b707d` vs GitHub `0d2dbed` | 4 src + 9 admin-ui changed, `carriers.mjs` new, all else identical (source map `sourcesContent`) |
| Deployed Public `26439a64` vs GitHub | identical |
| Regenerated admin assets vs deployed | 25/25 identical (text LF-normalised) |
| `9f24911` suite | 188: 186 pass, 1 skip, 1 fail (staging-storefront Windows path, pre-existing) |

NOT TESTED: e-mail to an inbox, cron, PromptPay scan with a banking app, paper labels, on-site payment in person, duplicate submit near cut-off, latency under load, rate limit on Cloudflare, real V1 export, rollback.

**Recovery R3 + A39 (same day, developer-reported, not deployed):** new `tests/orders-recovered-features.test.mjs` (carriers S10/Flash warnings, partial receipts incl. stale/over-receipt refusal and Admin API, batch shipping incl. audit of the overwritten number, no-cache Admin assets) 5/5; A39 one-step on-site hand-over asserted in `orders-status-rounds`; `staging-storefront.test.mjs` fixed for Windows paths. Full suite: **196 tests, 195 pass, 0 fail, 1 skipped** (live V1 differential, needs `NORX_V1_SOURCE`).

**Recovery R4 — rollback tool (developer-reported, not deployed, nothing run against any real database):** new `tests/v2-export.test.mjs` (6 tests): a full V2 life-cycle (ship + pickup + on-site payment + cancel + partial receipt + hand-over + tracking) exports to V1 CSV that re-imports with 0 validation errors and reconciles with V2 (0 diff), and also loads into a fresh V2 and reconciles; delta mode (V2-born → append, changed imports → replace, untouched imports and test orders excluded); V2-only rounds; deliberately corrupted CSVs (money, status, phone, unknown status, missing column) are caught; wrangler `--json` parsing; command line incl. refusal to write customer data into tracked repo folders. Stable over 10 consecutive runs. Full suite on Windows/Node 24: **202 tests, 201 pass, 0 fail, 1 skipped** (live V1 differential). NOT TESTED: against the real V1 Sheet (phone/date handling, Apps Script reading pasted rows), against a real D1 (`wrangler d1 execute --json` output was only simulated).

**Recovery R5 bug fixes (developer-reported, code only, not deployed):** (1) shipped date no longer set from the single-order form (DECISIONS A41; test rewritten, refused/accepted/kept cases); (2) Admin status route accepts the synthetic seed ids `TEST-…` (and still 404s other shapes); (3) production table/CSV report received pieces during a partial receipt (`partial` on rows/totals; "รับแล้ว" = fully received + partially received, "ผลิตเสร็จ (รอรับของ)" = waiting; bulk-action counts unchanged); (4) shipping list shows "ยังไม่ชำระ" / "รอรับของจากโรงงาน" tags — the earlier "queue lists unpaid orders" finding was a misreading: the unfiltered page lists every shipping order on purpose (labels can be prepared early), the overview link opens `?queue=ready`. Full suite: **203 tests, 202 pass, 0 fail, 1 skipped**. NOT TESTED in a browser: the changed Admin screens (shipping dialog, production table) — to be checked on staging after the approved Admin deploy.

**Admin deploy to staging (2026-11-27 evening, owner-approved; developer-reported by Claude, owner's Chrome session, read-only checks):**
- Config = the Admin config that was deployed at that moment (downloaded from Cloudflare), only `main` pointed at the repo source; the deploy refused anything not staging (name, vars, routes, D1 binding). Dry-run: bindings/vars identical. Staging Admin only; Public and storefront untouched; no migration.
- First deploy from `ff42fda` = version `eed44c52`. **It was defective:** an R5 edit left a `//` comment in the middle of a one-line statement in `admin-ui/shipping-app.mjs`, so the Admin **shipping page script failed to load** (`SyntaxError: Missing catch or finally after try`). No test noticed because the browser modules were never parsed by any test. Found within minutes by the post-deploy console check.
- Fix-forward from `e91df42` (same approved target, same config; one-line fix + new `tests/admin-ui-syntax.test.mjs` that runs `node --check` on every Admin module and on the generated assets, shown to fail on the broken state and pass after) = version `9aa87251`, **active**. Rollback target if ever needed: `589b707d` (do NOT roll back to `eed44c52`).
- After `9aa87251`: security gate 16/16 PASS (exit 0); Admin routes retained; 20 served Admin files identical to the GitHub-generated assets (hash-compared), `Cache-Control: private, no-cache`; shipping page: script loads, 5 orders listed with the new tags ("ยังไม่ชำระ" on the unpaid ones), dialog titled "เลขพัสดุ" with no date field; production page: API returns `partial` on rows and totals, summary boxes read "ผลิตเสร็จ (รอรับของ)" / "รับของแล้ว"; status route: a `TEST-…` id is routed (400 validation, not 404) and an unknown prefix still 404; no console errors on the six Admin pages after the fix.
- NOT TESTED on staging: the one-button "รับเงินและส่งมอบ" (needs a จ่ายหน้างาน order at pickup — covered by unit tests only), the partial-receipt numbers with real data (the staging rounds have no sent items right now), batch shipping with a tracking number through the UI.
- Suite at `e91df42`: **206 tests, 205 pass, 0 fail, 1 skipped**.


## Staging rollout — 27 Nov 2026 (Codex)

Owner approved updating staging Public and Admin in chat. Source: bc2b4d1 (PRs #5/#6); no application edits during deployment. These are Codex solo post-deploy checks, not independent QA.

- Identity: one authenticated Cloudflare account; live Worker names, staging markers and D1 id matched norx-orders-staging. Pre-existing versions matched the handover: Public 26439a64, Admin 9aa87251.
- Backed up D1 to a local private SQL file outside the repository (80,468 bytes); no backup/private configuration committed.
- Pinned Wrangler 4.168.0; account pinning; flat staging-only configs reconstructed from live bindings; dry-runs; deployment-head lease. Uploaded versions, compared bindings/runtime, activated Public first and Admin after the natural cron report appeared. Versions upload/deploy left routes, DNS, cron schedules and storefront unchanged. No migration.
- Verified 100% active: Public e1cabdf2; Admin 27b04360. All 12 Public and 7 Admin bindings, plus runtime settings, unchanged. Admin has no email-send binding.
- D1 before/after: staging marker; 25 orders / 29 items; active notification queue 0; recipient unset. Orders/items were not written. A fresh sanitized channel report appeared from the actual cron (email mode, sender configured).
- Existing owner Chrome session worked. Deployed Orders shows the specific missing recipient setting. Inspected loaded Overview, Orders, Production, Shipping, Settings and Products; no console errors observed. Mobile Orders had no page overflow; viewed readiness section. Settings screenshot cropped to avoid field data.
- Anonymous Access gate: all 16 probes returned 302 to Access login, including APIs/assets. No credentials sent to the probe.
- No real email was sent by this work; no notification retry, recipient change, payment, V1, production, DNS or Access-policy action. Service/destination/domain/inbox verification remains open. A2 deployed end-to-end handover/partial-receipt tests remain open; page checks do not replace them. Local functional evidence and 242-test suite are in PR #6.
- Rollback: restore predecessor Public 26439a64 / Admin 9aa87251 using privately saved full version IDs; keep D1. Report row is inert for older code. Older known-safe Admin fallback 589b707d remains available; never restore defective eed44c52.

## Owner alert delivery — 27 Nov 2026 (Codex solo review)
Owner authorized NORX recipient, personal forwarded copy retaining original, and controlled staging test. Google destination/identity verification completed by owner. Gmail filter: brand recipient + subject [NORX] + phrase "ออเดอร์ใหม่"; forwarding only, no archive/delete/read actions or historical mail. Global forwarding disabled. Private addresses/tokens omitted.

Staging identity and environment marker checked; D1 backed up privately. Public binding restricts the configured brand recipient. Set staging recipient and queued one synthetic diagnostic alert TEST-NOTIFY-20261127-01 via existing Public cron/provider, max_attempts=1, nullable order_id. No orders/items/payments/sales created. Provider accepted once with message ID, no error. Observed exact message in BOTH Gmail inboxes with Inbox labels at 23:28 Bangkok: original retained and copy received. This is inbox proof, beyond provider acceptance. delivery_confirmed_at was left untouched.

Post-check: 25 orders / 29 items unchanged, active queue 0, recipient configured. Test queue/history retained for audit. No code deploy/schema/DNS/Access/billing/Events/V1/production changes. Rollback: restore only prior storefront notifyTo from private backup; do not restore the entire database over newer data. Gmail filter is removable. This proves staging outbound delivery/forwarding, not full checkout-to-email or production readiness. Next: A2/A4/A6.

## Admin navigation and Orders UX — 27 Nov 2026 (Codex solo review)
Development only; no deployment. Shared server-rendered grouped sidebar on desktop and native disclosure menu on mobile (keyboard and no-JS navigation). Existing Events/Media destinations preserved; their separate consoles are not redesigned. Orders round selector remains visible; round totals/actions, notifications and latency use disclosures. Order list has a continuous page scroll; cash/payment/handover actions are primary, cancellation visibly distinct. Business rules, API paths, financial guards and confirmation dialogs unchanged.

Local synthetic rehearsal: 8/8 checkpoints (checkout QR, deferred payment, partial receipt blocks pickup/handover, error survives quiet reload, full receipt unlocks pickup, amount/cancel guards, exactly one payment, no JS exceptions). Six pages at 360/820/1280px: 18 route/viewport checks, no horizontal overflow or JS errors, exactly one current-page link per visible navigation; mobile menu keyboard toggle passes. Rendered Orders screenshots inspected at 360/1280px. Native disclosures preserve focus/DOM order. Print overrides exclude shell and restore full content width. No claim of deployed A2 completion or full accessibility audit.

Full suite 242 tests: 241 pass / 1 skip / 0 fail; preflight and repository hygiene pass. Rollback is reverting this development commit; production and staging code stay at their existing versions. Next UX work: Settings grouping and Production clarity, then Products flow; Events remains in roadmap.

## Monochrome reference refinement — 27 Nov 2026 (Codex solo review)
Owner asked to blend supplied visual references while retaining usability and original black/white brand. Built design and feasibility choices: DESIGN.md. Shared theme on six Orders Admin pages: charcoal/off-white, softer opaque panels, restrained orange selection/light on Overview only. Overview task cards become a scanable list with aligned counts; existing metrics and links retained. Settings gets section anchors without hiding forms. Dashboard notification deep link explicitly reveals its disclosure. No dependencies, raster assets or new requests beyond the small shared stylesheet.

Local synthetic checks: 8/8 checkout/partial-receipt/cash-handover checkpoints. Six routes at 320/390/820/1440: 24 checks, no overflow/JS exceptions, current nav and keyboard menu valid. Mobile menu works with JavaScript disabled; notification deep link and Settings payment anchor work. Viewed Overview at desktop/mobile and Orders screenshots; saved previews show synthetic records only. Core palette text contrast ratios 14.79:1 (body), 6.07:1 (secondary), 7.05:1 (queue action), 9.22:1 (dark header secondary on base); this is not a full accessibility audit of every rendered state. Full suite 242: 241 pass / 1 skip / 0 fail; preflight/hygiene pass.

Finish review: visual reference blend retains black/white hierarchy, restrained depth and readable work surfaces; no decorative scene behind money or tables. CSS-only light stays in introduction; state colors still distinguish payment/errors. QR, money validation, guards and confirmations unchanged. Development only, not deployed; deployed A2/go-live gates remain. Revert this commit to restore previous development theme; no DB rollback needed.

## Warm frosted refinement — 28 Nov 2026 (Codex solo review)
Owner clarified preference for warm neutrals and translucent panels. Updated shared base to warm off-white; Overview introduction and round context use progressive backdrop blur with opaque fallback. Dark text/primary buttons remain high contrast; operational queues/forms remain opaque. No JS/API/DB changes. Mobile/desktop screenshots reviewed with synthetic fixture only. Fixed background sizing/repeat after visual review.

24 route/viewport checks at 320/390/820/1440: no overflow/JS exceptions; keyboard menu passes. Computed header rgba white 0.44 + blur 18px confirms effect active. Final background checks: no-repeat, body fills viewport; print background white and blur removed. Full suite before final background-only correction: 242 tests, 241 pass / 1 skip / 0 fail; preflight/hygiene after correction. Existing 8-check flow evidence from prior revision remains; no redundant financial flow run for this CSS-only change. No deployment; revert this commit to restore prior appearance.

## Type and spacing — 28 Nov 2026 (Codex solo review)
CSS-only refinement: consistent spacing/type tokens, legible operational secondary text and badges, normal standard-page heading tracking, clearer form labels/order rows, neutral readable placeholders. Preserves warm frosted palette and existing actions/flows. Synthetic checkout creates a two-piece long-name fixture for inspection; no real data/email.

Six routes at 320/390/820/1440: 24 checks, no horizontal overflow or JS exceptions. Inspected Overview/Orders at 390/1440; long name wraps, badge separated, pending order actions all at least 44px. Computed queue supporting copy 15px/24px at both widths. Full suite and final preflight recorded in PR. No financial-rule/API changes and no redundant cash-handover test for CSS-only work. Development only, not deployed; revert commit for rollback.

## Orders material and action weight — 28 Nov 2026 (Codex solo review)
Owner approved adjusting composition, buttons and color proportion together. Added Orders-only beige/reflection canvas and progressive frosted panels with warm opaque fallback. Replaced full-width action blocks with compact pills; one primary payment/handover button, lighter secondary, separate visible cancellation/reversal text row. All existing endpoints, allowed moves, financial guards and confirmation dialogs preserved. Self-review ensures pickup queue highlights handover even if the broader move list includes payment.

Local synthetic flow 8/8: QR checkout, deferred payment, partial-receipt guard, persistent rejection, full receipt, amount/cancel guard, one payment and no JS exceptions. 24 route/viewport checks (six pages at 320/390/820/1440), no overflow/JS exceptions. Pending-order screen inspected at 390/1440: one primary action, all order buttons at least 44px; cancellation opens existing confirmation and dismissal leaves status unchanged. Computed round panel white alpha 0.37 with 18px blur. Preview screenshots contain synthetic fixture only. Full suite/preflight results in PR. No deployment or real data/email writes; rollback by reverting development commit.
