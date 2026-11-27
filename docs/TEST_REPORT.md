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
