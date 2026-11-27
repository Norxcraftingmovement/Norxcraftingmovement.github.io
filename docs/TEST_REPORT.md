# Test Report
## Phase 00 — 2026-11-27
Baseline: `node --test tests/*.test.mjs` บน HEAD `c227b7a` (Node v22.23.5) → **30 tests, 30 pass, 0 fail** (admin-access, event-admin, events-registration, media-manager).
ยังไม่มีเทสของ Orders V2 (ยังไม่เริ่ม implementation). ไม่มีการรันกับ staging/production หรือข้อมูลลูกค้าจริง.

## แผนทดสอบ (Quality Gate) — สถานะ: Pending ทั้งหมด
Order creation · Duplicate submission · Server-side price validation · Cart compatibility (`norx-cart-v2`, `drop02/drop03`) · Payment status · Production summary · Batch actions · Thai shipping labels · A6/A4 layout · Secure tracking (enumeration/PII) · Admin authentication · Unauthorized API access (ทุก route 403) · Data migration (dry-run/reconcile) · Rollback · Mobile usability · Regression: Website/Events/Media · Staging isolation (config ไม่มี binding production)
