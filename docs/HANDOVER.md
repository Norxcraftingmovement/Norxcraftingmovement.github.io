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
