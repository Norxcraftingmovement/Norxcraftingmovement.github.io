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
