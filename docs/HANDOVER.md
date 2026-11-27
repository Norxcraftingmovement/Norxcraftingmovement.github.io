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
