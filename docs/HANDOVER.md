# Handover — Phase 00
- Branch: `feature/orders-v2` (ฐาน `feature/cloudflare-migration` @ `c227b7afcc4bec45f4ff741369c0283de642282c`). Commit SHA ของ Phase 00: ดูข้อความรายงาน/`git log -1`.
- เปลี่ยนเฉพาะ `docs/` — ไม่แตะโค้ด, config, production, DB
- Baseline tests: 30/30 pass

## ความเสี่ยงที่ยังไม่แก้
1. Business logic V1 ยังไม่ได้ตรวจ (ไม่มีซอร์ส/เข้าไม่ถึง) — Blocker (D1)
2. Preview builds ใช้ bindings production ของ events/media (S2) — กันด้วย flag เท่านั้น
3. Production branch = `feature/cloudflare-migration` ห้าม merge งานใหม่เข้าโดยไม่อนุมัติ (S1)
4. `main` กับ migration branch แยกกัน 9 commit (S7)
5. ยังไม่ได้ตรวจ Cloudflare dashboard (Access policy, preview settings, secrets)

## ขั้นต่อไป
เจ้าของตอบ D1–D12 (อย่างน้อย D1, D3, D4) → เริ่ม Phase 01 (staging foundation)

## Phase 01 (2026-11-27)
เพิ่ม: `wrangler.orders.jsonc` (env staging/production แยก, `database_id` เป็น placeholder), `migrations/orders/0001_core.sql`, `seeds/orders-staging-synthetic.sql` (ข้อมูลสมมติ), `src/orders-guard.mjs`, `src/orders-admin-worker.mjs` (route allowlist + `verifiedOwner` + guard, endpoint `/api/admin/overview`), เทส 5 ข้อ
ยังไม่ได้ deploy อะไร และไม่มี Cloudflare resource ถูกสร้าง. ก่อน deploy staging เจ้าของต้อง: สร้าง D1 `norx-orders-staging` แล้วแทน `REPLACE_WITH_STAGING_DB_ID` / host, ใส่ AUD+email hash เป็น secret/var ของ staging Worker, ตั้ง Access policy ของ staging host (อำนาจเจ้าของ)
Phase 02 (สร้างออเดอร์/ราคา/เลขออเดอร์) **ยังรอ D1 — ซอร์ส Apps Script**

## Phase 02a (2026-11-27) — Sender Settings + Shipping Labels
เพิ่ม `admin-ui/` (HTML/JS/CSS, Sarabun, โลโก้), `src/orders-admin-api.mjs`, route ใหม่ใน `src/orders-admin-worker.mjs`, `src/generated/orders-admin-assets.mjs` (สร้างด้วย `node scripts/build-orders-admin-assets.mjs` — **ต้องรันใหม่ทุกครั้งที่แก้ `admin-ui/`**, มีเทสตรวจว่าไม่ล้าสมัย), `scripts/dev-orders-admin.mjs` (รันดูหน้า local ด้วยข้อมูลสมมติ: `node scripts/dev-orders-admin.mjs` → `http://127.0.0.1:8788/admin/shipping/`)
- ข้อมูลผู้ส่งจริงตั้งที่ `/admin/settings/` (เก็บใน D1) — ไม่มีข้อมูลจริงใน repo
- ยังไม่ deploy, ไม่แตะ production/Access policy
- ความเสี่ยงใหม่: (1) ยังไม่ทดสอบกับเครื่องพิมพ์จริง; (2) โลโก้เป็น PNG ความละเอียดต่ำ (D16); (3) PDF เป็นภาพ ไม่ใช่เวกเตอร์; (4) Safari ไม่รองรับ named `@page`; (5) Admin Console เมนู V2 ยังไม่ได้ผูกกับหน้าเหล่านี้ (หน้าอยู่ที่ `/admin/shipping/`, `/admin/settings/` ในตัว Worker staging)
- ยังไม่เริ่ม: ระบบราคา, เลขออเดอร์, การสร้างออเดอร์ (รอตรวจ Apps Script ครบตามคำสั่ง)


## Phase 02 (2026-11-27) — Orders V2 core
**เพิ่ม:** `src/orders-core.mjs` (V1 logic), `src/orders-service.mjs` (D1 atomic), `src/orders-public-worker.mjs` (+cron), `src/orders-notify.mjs`, `src/v1-import.mjs`, route/หน้า admin ใหม่, `wrangler.orders-public.jsonc`, `scripts/gen-v1-golden.mjs` + `v1-verify-source.mjs`, `tests/fixtures/v1-golden.json` (สมมติล้วน)
**รันเทียบซอร์ส V1 ในเครื่อง:** `NORX_V1_SOURCE=/path/to/v1.txt node --test tests/orders-core.golden.test.mjs` · สร้าง golden ใหม่: `node scripts/gen-v1-golden.mjs /path/to/v1.txt` · ดูหน้า admin ด้วยข้อมูลสมมติ: `node scripts/dev-orders-admin.mjs`
**ความเสี่ยงที่ยังเหลือ**
1. ซอร์สที่ได้รับ ≠ ยืนยันว่าเป็นเวอร์ชันที่ deploy (ดู MIGRATION_PLAN) — **บล็อกก่อน cutover**
2. ยังไม่เคยรันบน D1/Workers จริง (semantics ของ batch/RETURNING/json_each ตรวจกับ SQLite เท่านั้น)
3. เนื้อหาอีเมลแจ้งเตือนเดิมยังไม่ได้ทำเทมเพลต (D17); ไม่มี provider → ข้อความค้างในคิวและเห็นในหน้า Admin
4. หน้า Admin ยังไม่มี UI สร้าง/แก้รอบ (API พร้อมและทดสอบแล้ว) และยังไม่มีการส่งออก CSV/Batch status/Production print (Phase ถัดไป)
5. Preview ของ Worker หลัก (S2) ยังผูก D1/R2 จริงของ Events/Media — ไม่เกี่ยวกับ Orders V2 แต่ห้ามใช้เป็น staging ของหน้าร้าน
6. fixture golden ขนาด ~0.8 MB
7. `src/admin-console.mjs` (มีอยู่ก่อนแล้ว) ฝัง URL หลังบ้าน Apps Script ใน public repo — ไม่ได้แตะ (เป็นเรื่องของ Production)

## Review fixes + Phase 03 (2026-11-27)
**Tests:** 148 total, 147 pass, 0 fail, 1 skipped (live V1 differential; passes 5/5 when run with `NORX_V1_SOURCE`).
**Fixed (P0/P1 from the independent review):** payment integrity (void on undo/cancel + DB unique guard + audit endpoint), V1 delta sync with full reconciliation, `NORX-LEGACY-xxx` ids everywhere, notification crash-safety (provider OK then worker stops).
**Prepared:** native Cloudflare email provider with mock tests (API shape unverified — `docs/EMAIL_NOTIFICATIONS.md`), standalone staging storefront + runbook (`docs/STAGING_RUNBOOK.md`), anonymised migration fixtures + CLI, delta-reconciliation tests.
**Phase 03a (Admin Console V2):** one 8-entry menu on all admin pages, **Overview** (tasks + auto-refresh), **Production** (summary by collection/product/fit/sleeve/size/payment state, CSV, print, batch production status), Orders CSV export, Settings → storefront/bank/live switch/notification recipient, Products placeholder. Shipping Labels and Sender Settings unchanged (tests + browser re-verified).
**Remaining risks:** (1) nothing has run on real D1/Workers/Cron; (2) email binding call shape unverified; (3) deployed V1 version still unconfirmed; (4) real private V1 export never read; (5) Overview cannot show open Events (isolation by design — D22); (6) Orders batch actions (multi-select status change), `/track/`, Products management, round create/edit UI are still pending; (7) `wrangler.orders*.jsonc` contain `REPLACE_*` placeholders that fail closed; (8) dist-staging build is ignored by git and rebuilt on demand.


## Staging readiness (2026-11-27) — branch `feature/orders-v2`
**Done:** notification retry bounds + CAS recovery + PII-free audit + Cloudflare Email Service provider (mock-tested) · dynamic PromptPay QR payments (Phase 1) · staging configs rendered from env vars with pre-flight, D1 identity check, environment-guarded SQL, deploy sequence · owner-only public staging Worker · Orders Workers decoupled from Events code · smoke + UI rehearsal harness (+ local simulation) · docs (`PAYMENTS.md`, `STAGING_RUNBOOK.md`, `EMAIL_NOTIFICATIONS.md`).
**Needs the owner:** create D1 `norx-orders-staging`, new rate-limit namespace, Access app on the whole host (+ service token), verified destination address, routes/DNS, approvals for email-domain onboarding — exact values in `STAGING_RUNBOOK.md` §1–3. Then run the sequence and `staging-smoke` / `staging-ui-check`.
**Risks still open:** nothing has run on Cloudflare (D1/Workers/Cron/Email behaviour and all latency figures unmeasured); the QR has never been scanned by a banking app (D23); the sending domain may need DNS (D24); deployed V1 version still unconfirmed; real V1 export never read; Orders batch actions, round create/edit UI, `/track/`, Products management, Events metrics (D22) pending; production config sections are placeholders by design.


## Final staging review (2026-11-27) — ready for approval of the real deployment
All six review items fixed and tested (see TEST_REPORT "Final staging review fixes"); runbook rewritten (`STAGING_RUNBOOK.md`: exact resources, order, owner-session testing, rate-limit/failure-drill/payment-safety procedures, non-destructive rollback). No unrelated features added.
**Owner prerequisites (in order):** Access application (owner-only, whole hostname) → D1 `norx-orders-staging` → new rate-limit namespace → verified destination address → export the five `NORX_*` variables. Then `.staging/deploy.sh` steps 0–5, owner steps 6–7 (Access re-check, DNS `staging` record + routes), **gate (step 8) must pass**, then tests with the owner session.
**Still open:** nothing run on Cloudflare (no latency figures, D1/Cron/Email behaviour unproven); QR never scanned by a banking app (D23); sending domain/DNS for e-mail (D24); deployed-V1 version unconfirmed; real V1 export never read; batch actions, round editor, `/track/`, Products, Events metrics pending.


## Staging deployment (2026-11-27) — actual results
Run from the cloud session against Cloudflare (staging only):
- **D1** `norx-orders-staging`: identity verified (name AND id), migration `0001_core.sql` applied, marker `environment=staging` set, guarded synthetic seed applied (5 orders, 1 round).
- **`norx-orders-staging` (Admin)** deployed, version `ab7af428-5ac7-40d2-b56b-104635835b61`; D1 + vars only; no routes, workers.dev/previews off.
- **`norx-orders-public-staging`** deployed, version `26439a64-5d0f-4c87-a59c-44948ac0e651`; D1, rate limiter, email binding, cron `* * * * *`, `STAGING_REQUIRE_ACCESS=1`; no routes.
- **`norx-staging-storefront` NOT deployed:** build OK (155 files, 5 rewrites) but the static-asset upload failed twice with `401 Unauthorized` (`POST /workers/assets/upload`). The upload uses a short-lived token that the cloud credential proxy does not pass through. No bypass attempted. Resolution approved (Option A): owner deploys the storefront only from a local Windows machine — `docs/STAGING_STOREFRONT_DEPLOY_WINDOWS.md`.
- No DNS record, routes, Access change, billing change, or Production/Events/Media/Orders V1 change was made. Do not re-run migrations or redeploy the two Workers.
**Next:** owner storefront deploy → Access re-check → DNS `staging` + 4 route patterns → gate → integration tests (runbook §3 steps 6–9).


## Codex Desktop Windows continuation (2026-11-27)
Operator: Codex Desktop. Read Trello card 2imGq33Y and all four linked guides; card activity showed no competing operator. Local clean checkout at `e8d941147fea6ec1cb2cbf03a350ff15685415bd` (before this documentation update), Windows, Node v22.11.0, Git 2.56.0.
- Independently verified: storefront build succeeds (155 files, 5 rewrites); committed config is assets-only, correct name, no routes/bindings, workers.dev and previews disabled.
- NOT verified: Wrangler dry-run/deploy, Cloudflare account/resource state, Access, DNS/routes, security gate, integration, email/cron, latency.
- Local blockers: Wrangler 4.168.0 requires Node >=22.12.0; npm installation failed at child-process spawn with EPERM even using a workspace cache. Node test runner also failed spawn EPERM; direct execution exposed Windows-incompatible URL.pathname handling (`C:\\C:\\...`) in staging-storefront.test.mjs. These are environment/harness failures, not passing tests or evidence of an application regression.
- No Cloudflare credentials found in the two standard Wrangler config locations or CLOUDFLARE_* environment names; account identity not established. No credential contents read or recorded.
- No deployment, migration, seed, DNS/routes, Access, production or customer-data change by this session. Existing cloud deployment results above remain developer-reported, not independently retested.
- Reconciled stale runbook status and route count: FOUR patterns are required (public API, admin API, admin UI, storefront). Earlier references to three routes are stale.
Next exact action: use a local execution environment permitting npm/child-process launch, Node >=22.12.0; authenticate owner to the NORX Cloudflare account; run pinned Wrangler dry-run and storefront-only deployment from the Windows guide. Verify Version ID and disabled public targets/bindings; re-check owner-only Access before staging DNS + four routes; then gate and owner-session integration. Do not repeat D1 migration/seed or deploy the other Workers. Staging-only authorization remains; production cutover is not approved.


## Local runtime follow-up (2026-11-27)
Installed portable Node v22.16.0 in the Codex task workspace (official nodejs.org Windows archive; SHA256 matched SHASUMS256.txt). System Node unchanged. Direct execution reports v22.16.0; child-process probe still returns spawnSync EPERM, confirming the Node upgrade does not remove the execution restriction. Wrangler dry-run/authentication/deployment remain pending. Prepared owner-run PowerShell script in the task outputs: build/config check, pinned Wrangler dry-run, Cloudflare login/whoami, then STOP without deployment. Owner must run it in a normal local PowerShell outside the restricted execution session; do not paste credentials into chat. No Cloudflare resource changed.


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


## Admin redeploy verification (2026-11-27)
Owner reports deploy completed and post-deploy GATE OK. Independently observed dashboard Admin version prefix c04f3354, deployed 06:51:43 UTC, Ready/100%; both staging Admin routes retained, one staging D1 binding, workers.dev disabled. Normal Chrome /admin/orders/ still shows token is not defined after ordinary reload. Local source/generated assets have redundant token assignment removed. Worker assets use private,max-age=3600, so stale browser module cache is a candidate, not a confirmed cause; automated hard-reload attempts produced no observable reload, and direct module navigation was blocked by browser client. Live fix remains NOT VERIFIED. Next: owner Ctrl+Shift+R on Orders, then inspect/retest. If persists, compare deployed bundle before further deployment. Full integration remains incomplete.


## Independent normal-Chrome integration checks (2026-11-27)
Orders UI fix VERIFIED live after owner Ctrl+Shift+R: list displays all five seed orders, round totals, notifications and latency sections; refresh no longer raises token ReferenceError. Confirms stale private,max-age=3600 module cache was involved.
Found missing storefront settings blocking Public API (ok:false/unavailable). Initialized ONLY staging settings with synthetic TEST BANK/zero account/test holder and example.test links; liveEnabled=true only on Access-protected staging to permit synthetic QA without a test key; rolling=false, notification recipient empty, PromptPay unset. Public GET /api/orders now returns ok:true, one test01 product, open ROUND-001, shipping 50; no order created this round. Static storefront lists drop02/drop03 while D1 currently exposes only test01: catalog alignment must be resolved before real checkout UI tests; do not treat public config success as checkout success.
Production UI: hides test seed by default; include-test checkbox reveals 4 production pieces (3 paid + 1 pay-later), pending 3 pieces, matching seed.
Shipping: missing-sender guard correctly disabled exports and showed guidance. Saved synthetic sender only. A6 preview rendered the long Thai test recipient/address. Selected TEST-0003 + TEST-0002, A4 slot 1, exported PDF. Download-event tool timed out but actual NORX-labels-A4-2026-11-27.pdf exists (144721 bytes); independent pdfinfo: one A4 page, 595.276x841.89 pt; Poppler rendered image visually reviewed: both labels/Thai content readable, no overlap/clipping, bottom two slots blank. Copied reviewed artifact to task outputs/NORX-labels-A4-staging.pdf. Paper printing NOT TESTED. Export may mark print metadata; no payment/fulfillment status change requested.
Remaining: automated owner-session smoke/UI still blocked by Google login in Playwright; no owner-session file. Public checkout catalog mismatch, no configured synthetic QR, no notification recipient; Admin readiness shows no send channel (Admin has no email binding, so this alone does not prove Public Worker email misconfiguration). No 30-order latency sample, email acceptance/inbox, cron dispatch, migration reconciliation, rate-limit/cutoff verification yet. Browser debugger detached after export; no further UI writes attempted. Production unchanged; staging Access unchanged.


## Staging mixed-cart checkout (2026-11-27)
Owner ran guarded catalog SQL on norx-orders-staging. Readback: drop02 regular, 11 sizes, 2 sleeves; drop03 boxy, 6 sizes, 2 sleeves; test01 retained. SQL tested locally for repeat safety and seed-order preservation before remote execution.
Independent owner-session Chrome check: added Drop 02 short M (510) and Drop 03 long L (620), selected shipping (50 once), and placed synthetic order NORX-7D56CF56. Checkout receipt and Admin agree at 1,180 THB, pending payment. Confirmed the synthetic payment status with a test reference and reverted to pending, both verified in Admin; no funds transferred. Admin recorded 147 ms for one server-side creation sample only. Notification was queued, then recorded one attempt with recipient_not_configured. This confirms queue processing but not provider acceptance or inbox delivery. Dynamic QR, duplicate submission, latency under multiple orders, rate limit, and the remaining integration checklist are still pending.


## Recovery Mode session — owner's home PC (2026-11-27, evening)
Operator: Claude (Claude Code desktop on the owner's home Windows PC), separate worktree on `feature/orders-v2`. Start `d1d7213` → end `9f24911` (+ this docs commit). `feature/cloudflare-migration` (production) untouched.

**Context.** The evening work (local commit 7b20b5f on the owner's workplace PC, never pushed — HTTP 403) is treated as lost by owner decision (Recovery Mode; GitHub is the base). The home PC can push, and its wrangler is logged in to the NORX Cloudflare account.

**Done**
- P0 staging QR (`0d2dbed`): with no per-order PromptPay ID set, the staging checkout fell back to the static QR of the real receiving account (`cart/index.html` → `assets/qr.jpg`). `scripts/build-staging-storefront.mjs` now replaces that block with a STAGING notice, does not upload `qr.jpg`, and fails the build if it reappears; the production cart is unchanged. Storefront-only deploy (owner-approved): version `3bcf6749`, no targets; gate 16/16 afterwards. Developer retest PASS; independent retest pending.
- Recovery R1 (read-only): D1 staging has `0001` + `0002`; its schema differs from `0001` only by `order_items.received_qty`. Downloaded the running Workers with `create-cloudflare --existing-script` (no deploy, no git): their source maps carry every original module. Admin `589b707d` differed from GitHub in 4 src modules + 9 admin-ui files + new `carriers.mjs`; Public `26439a64` equals GitHub. Recovered sources, bundles, source maps and the schema dump are kept privately by the owner (Google Drive, NORX-handoff/recovery-2026-11-27).
- Recovery R2 (`cf1fed0`, `9f24911`): Admin sources restored verbatim; regenerated admin assets equal the deployed ones (25/25); `0002_partial_receipts.sql` reconstructed (same name as the d1_migrations record, so it is not re-applied). Test helper and local simulators now apply every migration in order. No deploy needed — staging already runs this code.

**Owner decision needed** (behaviour that came with partial receipts; already live on staging and used in QA):
1. ส่งมอบแล้ว is refused while any item of the order has not been received from the factory ("ออเดอร์นี้รับเสื้อยังไม่ครบ"). Migration consequence: V1 orders imported as ส่งร้านแล้ว need their receipts recorded in V2 before they can be marked delivered.
2. On-site pickup is two steps: record the money (จ่ายหน้างาน → ชำระแล้ว, method `on_site`), then ส่งมอบแล้ว ("บันทึกรับเงินก่อนส่งมอบ"). V1 did this in one step.
Both are asserted in tests now; keep or change is the owner's call.

**Side effect to review:** `orders-core` / `orders-service` are shared, so the staging Public Worker (`26439a64`) is now older than GitHub for these modules. Review before any Public redeploy (R5, needs approval).

**Lost for good (never deployed):** round create/edit UI, `0003` + `shop.js` event name, weekly-round switch on the Orders page, `export-v2-to-v1.mjs`, `rehearse-v1-local.mjs`, the extra tests. All deferred by the owner except the reverse export (R4). Results reported from 7b20b5f (212/211 tests, local V1 rehearsal 35→37 with 0 diff, rollback round-trip) now have no evidence.

**Next** (single writer: Claude on the home PC until recovery completes): R3 tests for the restored features (receipts, batch shipments, carriers) + Windows test fixes → R4 reverse export V2 → V1 with a round-trip test → R5 bug fixes (shipped date sets `shipped_at`; TEST- seed ids rejected by Admin routes; shipping queue lists unpaid orders — to confirm; "รับแล้ว 0"), then ask approval to deploy Admin/Public. Independent retest of the staging QR by Codex or the owner. After Orders V2 integration: `/track/`. No cutover before MOVE KIDS (13 Dec) unless the owner decides otherwise.

Wrangler on this PC: use `npx.cmd` (PowerShell execution policy blocks `npx.ps1`); after switching accounts delete the worktree's `.wrangler/cache/wrangler-account.json` (otherwise the API answers 10000); `wrangler login` must be completed by the owner in their own browser.

**Owner decisions on the two partial-receipt rules (2026-11-27):** see DECISIONS A38 (confirmed: no hand-over before full receipt) and A39 (payment and hand-over together; one combined action vs. today's two clicks still open).

**Recovery R3 + A39 done (code only, not deployed):** tests for the restored features, Windows test fixes, and the owner's one-button on-site hand-over ("รับเงินและส่งมอบ", DECISIONS A39). Suite green on Windows (196: 195 pass, 1 skipped). Staging Admin still runs 589b707d (two-step on-site flow) until the next approved Admin deploy (R5). Next: R4 reverse export V2 → V1.

**Recovery R4 done (code only):** `scripts/export-v2-to-v1.mjs` + `src/v2-export.mjs` (rollback V2 → V1) with built-in round-trip proof; usage and limits in MIGRATION_PLAN "Update 2026-11-27 (Recovery R4)". Owner agreed the go-live timeline (DECISIONS A40): go/no-go Fri 4 Dec, cutover night 5–6 Dec only if every gate is green, otherwise after 13 Dec, nothing on 11–13 Dec. Next: R5 — bug fixes (shipped date sets `shipped_at`; TEST- seed ids rejected by Admin routes; shipping queue lists unpaid orders — to confirm; "รับแล้ว 0"), then ask approval to deploy Admin (includes the one-button on-site hand-over) and review Public. In parallel the owner starts: masked real V1 export, V1 source check, e-mail recipient + sending domain, then QR scan and paper label tests.

**Recovery R5 code done (not deployed):** the four known Admin bugs are handled (see TEST_REPORT "Recovery R5"). Staging Admin still runs 589b707d. **Waiting for the owner's approval to deploy Admin** (`norx-orders-staging`: restored code + A39 one-button hand-over + R5 fixes; no migration needed — D1 already has 0002). Public Worker: its shared modules (`orders-core`, `orders-service`) differ from GitHub only in admin-side logic that Public never calls, so redeploying Public is optional; proposal: leave it unchanged now. Rollback of the Admin deploy = `wrangler rollback` to 589b707d.

**Admin deployed to staging (owner-approved) — current state:** `norx-orders-staging` = version `9aa87251` (code = GitHub `e91df42`: restored 589b707d code + A39 one-button hand-over + R5 fixes + shipping-script hotfix). Storefront `3bcf6749`, Public `26439a64` unchanged; D1 = 0001 + 0002. Gate 16/16. The first deploy (`eed44c52`) broke the shipping page script (my own editing slip); fixed forward in minutes and guarded by `tests/admin-ui-syntax.test.mjs`. Lesson recorded: after any Admin deploy, load every Admin page and read the console — tests alone did not cover browser scripts until now. Roll back only to `589b707d`.
The deploy config used is a local, git-ignored file (`.staging/wrangler.admin.deploy.jsonc`) built from the deployed config; it is not in the repo (it holds ids and hashes).
**Next:** owner starts the real-data gates (masked V1 export, Apps Script version check, e-mail recipient + domain); Claude then prepares the production resources (ask approval command by command) and the rehearsal of import + rollback with the owner's file; QR independent retest still open.
