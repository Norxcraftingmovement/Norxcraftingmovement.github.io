# NORX Platform V2 — Roadmap & Phase 00 Audit
Phase 00 · 2026-11-27 · Branch `feature/orders-v2` (จาก `feature/cloudflare-migration` @ `c227b7a`)

## 1. สถานะ (Completed / In Progress / Pending / Blocked / Verified)

| รายการ | สถานะ |
|---|---|
| ตรวจ branch / HEAD / working tree | **Verified** — tree สะอาด, HEAD `c227b7a` ตรงกับ origin |
| Baseline tests (`node --test tests/*.test.mjs`) | **Verified** — 30/30 ผ่าน |
| ตรวจ Staging isolation จาก config | **Completed** (อ่าน config เท่านั้น) — พบความเสี่ยง ดูข้อ 3 |
| ออกแบบ Architecture / Database / API / Migration | **Completed (ร่าง)** — รอเจ้าของตัดสินใจ `DECISIONS.md` |
| ตรวจ Business Logic ของ Apps Script / Sheets | **Blocked** — ดูข้อ 2 |
| ตรวจ Cloudflare dashboard (bindings จริง, preview, Access) | **Blocked** — ไม่มีสิทธิ์เข้าถึงจากสภาพแวดล้อมนี้ |
| Phase 01 staging foundation | **Verified** (35 tests) |
| Phase 02a Sender Settings + Shipping Labels (A6/A4, PNG 300 PPI, PDF, batch print) | **Completed on staging code** — 57 tests + Chromium verification; ยังไม่ deploy; ไม่ผ่านเครื่องพิมพ์จริง |
| Phase 02 ราคา/เลขออเดอร์/สร้างออเดอร์/สถานะ/รอบ/แจ้งเตือน/นำเข้า V1 | **Completed on staging code** — 112 tests (111 pass, 1 skipped = differential สด ซึ่งผ่านเมื่อรันแยก), Chromium; ยังไม่ deploy; ยังไม่ผ่าน D1 จริง |
| ยืนยันซอร์สตรงกับ deployed version | **Blocked** — ต้องให้เจ้าของส่งออกโค้ดเวอร์ชันที่ deploy (ดู MIGRATION_PLAN) |

## 2. ข้อจำกัดของ Phase 00 (ต้องบอกตรง ๆ)
- **ซอร์ส Apps Script ไม่อยู่ใน repo** และ sandbox นี้เรียก `script.google.com` ไม่ได้ (proxy 403) จึงไม่ได้อ่านโค้ด, ไม่ได้ GET API จริง, ไม่ได้เห็นโครงสร้าง Sheets
- สิ่งที่รู้เกี่ยวกับ Orders V1 มาจาก **สัญญา (contract) ฝั่ง storefront** (`shop.js`, `cart/index.html`) เท่านั้น — ดู `ORDERS_V2_ARCHITECTURE.md` §2
- Business rule ฝั่ง server ที่ยังไม่ยืนยัน: รูปแบบเลขออเดอร์, สูตรราคา/ค่าส่ง, การตรวจซ้ำด้วย `requestId`, สถานะชำระเงิน, รอบ rolling, `testKey`
- **ต้องการจากเจ้าของ:** export ซอร์ส Apps Script (Code.gs ทั้งหมด) + Sheet ที่ลบข้อมูลลูกค้าแล้ว หรืออย่างน้อยแถวหัวตารางและ 5–10 แถวตัวอย่างที่ปิดบังข้อมูล

## 3. Staging Isolation Audit (จาก config ใน repo)
| # | ข้อพบ | ความรุนแรง |
|---|---|---|
| S1 | **Production branch = `feature/cloudflare-migration`** → push/merge เข้า branch นี้ = deploy production ทันที. `feature/orders-v2` ต้องไม่ถูก merge เข้า branch นั้นจนกว่าจะอนุมัติ | สูง |
| S2 | `wrangler.jsonc` ผูก `EVENTS_DB` (norx-events จริง) และ `MEDIA_BUCKET` (norx-event-media จริง) ที่ระดับบนสุด. block `previews` override เฉพาะ `vars` ไม่ override bindings → **preview build ของ branch ใด ๆ อาจเขียน D1/R2 จริงได้** ถ้า route ถูกเรียก (ปัจจุบันกันไว้ด้วย `EVENTS_REGISTRATION_OPEN=0`, `MEDIA_ADMIN_ENABLED=0` เท่านั้น — เป็นการกันด้วย flag ไม่ใช่การแยกข้อมูล) | สูง |
| S3 | `workers_dev: true` บน Worker หลัก → preview URL สาธารณะ | กลาง |
| S4 | Orders V2 ต้องใช้ DB และ Worker **คนละชุด** ตั้งแต่แรก: `norx-orders` / `norx-orders-staging`, Worker `norx-orders` / `norx-orders-staging`, ห้ามผูก EVENTS_DB/MEDIA_BUCKET จริงใน staging (ใช้ `norx-event-media-staging` หรือไม่ผูก) | ข้อกำหนดออกแบบ |
| S5 | `wrangler.admin.jsonc` มี Access AUD และ SHA-256 ของอีเมลเจ้าของใน public repo (ไม่ใช่ secret แต่ hash อีเมลเดาย้อนได้ง่าย) | ต่ำ |
| S6 | Admin Console ลิงก์ไปหลังบ้าน Apps Script เดิมด้วย URL ที่ฝังในซอร์ส (`src/admin-console.mjs`) | ต่ำ (เป็นอยู่แล้ว) |
| S7 | `main` นำหน้า merge-base อยู่ 9 commit (เนื้อหา community) ที่ไม่อยู่ใน branch ปัจจุบัน → ต้องตัดสินใจเรื่องการรวม branch ก่อน cutover | กลาง |
| S8 | `ratelimits.namespace_id` ใช้ร่วมกัน; staging ควรมี namespace แยก | ต่ำ |

ยังไม่ได้ตรวจ: Cloudflare Access policy จริง, ว่า preview ถูกเปิดใช้ใน dashboard หรือไม่, secrets ของ Worker.

## 4. Roadmap (Gate-based)
| Phase | งาน | Gate ออก |
|---|---|---|
| 00 | Audit + Design (เสร็จ) | เจ้าของตอบ Decision D1–D12 |
| 01 | Staging foundation: `wrangler.orders.jsonc` (env แยก), D1 staging, migrations 0001–, seed ข้อมูลสมมติ, Admin auth middleware ใช้ `verifiedOwner` เดิม, test harness | Test: auth/unauthorized, isolation test (staging ไม่มี binding ของ prod) |
| 02 | Core Orders: สร้างออเดอร์ (เว็บ + manual), server-side pricing, idempotency, payments, status history, audit log, ค้นหา/กรอง/CSV/batch | Quality Gate: creation, duplicate, price validation, cart compat, payment |
| 03 | Admin Console V2 shell + Overview + Orders (Thai-first, mobile) | Mobile usability |
| 04 | Production summary + batch status + print/export | Production summary test |
| 05 | Shipping + Label generator (A6/A4, PNG 300ppi, PDF) + Sender Settings | Thai label, print layout test |
| 06 | `/track/` | Secure tracking test (enumeration, PII) |
| 07 | Migration tooling: audit, backup, mapping, dry-run, reconcile (read-only จนกว่าอนุมัติ) | Dry-run reconcile = 0 diff |
| 08 | Product Management (ก่อน Drop 04) | Drop 04 สร้างได้โดยไม่แก้โค้ด |
| 09 | Cutover (**ต้องอนุมัติแยก**) | ดู `MIGRATION_PLAN.md` |

หลัง Phase 02 เสถียรจึงเริ่ม Phase 08 ตามที่กำหนด. MOVE KIDS (Events/Media) ไม่ถูกแตะ — Orders V2 ใช้ Worker/DB แยก ไม่แก้ `events-worker`, `event-admin-worker`, `media-worker`; แก้เฉพาะเมนู shell ของ Admin Console ใน Phase 03 พร้อม regression test.


## Status update 2026-11-27 (after independent review)
| Item | Status |
|---|---|
| Review P0-1 payment integrity | **Completed + regression tests** |
| Review P0-2 migration delta sync + reconciliation | **Completed + tests on anonymised fixtures** (not run against real export/D1) |
| Review P1-3 `NORX-LEGACY-xxx` | **Completed + tests** |
| Review P1-4 notification crash window | **Completed + tests** |
| D17 native Cloudflare email provider | **Prepared with mock tests; API shape Blocked on docs access; service not enabled** |
| D18 staging storefront | **Prepared (build + config + runbook); not deployed; DNS/routes/Access = owner** |
| D19 anonymised fixtures / delta tests | **Completed** |
| Phase 03a Admin Console V2 (menu, Overview, Production, CSV, batch production status, storefront settings) | **Completed on staging code; Chromium-verified** |
| Phase 03b (orders batch actions, round create/edit UI, Events card via read-only API, Content/Analytics hooks) | **Pending** |
