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
