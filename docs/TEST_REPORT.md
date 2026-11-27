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
