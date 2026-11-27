# Orders V2 — Architecture (Draft, Phase 00)

## 1. หลักการ
1. Storefront เดิมต้องไม่พัง: ใช้ **adapter** ที่พูดสัญญาเดียวกับ Apps Script (`GET` config, `POST {action:'submit',order}`) แล้วค่อยสลับ `window.NORX_API` ตอน cutover
2. ราคา/ค่าส่ง/ยอดรวมคำนวณฝั่ง server จากตาราง products/variants/rounds เท่านั้น; `expectedTotal` จาก client ใช้แค่ตรวจว่าตรงกัน
3. Auth: ใช้ `verifiedOwner()` (Cloudflare Access `ctx.access` + AUD + email hash) ใน `src/admin-access-worker.mjs` เดิม ไม่สร้าง auth ใหม่
4. แยก environment จริง: Worker + D1 + (R2) คนละชุด

## 2. สัญญา V1 ที่อนุมัติจาก storefront (ต้องคงไว้)
**GET config** → `{ok, serverNow, rolling?, testOnly?, eventName, round|null, nextRound, products[], bank{name,account,holder}}`
- `round`: `{id,name,opensAt,closesAt,paymentDue,shipping,deliveries[city|event|ship],readyText}`
- `product`: `{id,name,short,fit,sizes[],prices{short,long}}`

**POST submit** `{action:'submit', order:{roundId,name,phone,delivery,address,items[{product,fit,sleeve,size,qty}],preorder,sizing,privacy,website(honeypot),expectedTotal,requestId,testKey?}}`
→ `{ok:true,id,name,items,total,paymentDue}` หรือ `{ok:false,error}`

Client-side rules ที่ server ต้อง enforce ซ้ำ: ชื่อ ≥2 ตัว, เบอร์ `^0[0-9]{8,9}$`, ship ต้องมีที่อยู่ ≥15 ตัว + รหัสไปรษณีย์ 5 หลัก, ต้องติ๊กยอมรับ 3 ข้อ, qty 1–99 จำนวนเต็ม, ค่าส่งคิดต่อออเดอร์ (ไม่ต่อรุ่น), city/event ไม่มีค่าส่ง, `requestId` เปลี่ยนเมื่อ payload เปลี่ยน (idempotency), `website` ต้องว่าง (honeypot), `testKey` = โหมดทดสอบ.
คำเตือน: CORS ปัจจุบัน POST ไม่มี preflight (`text/plain` body) — adapter ต้องรองรับ.

**ไม่ทราบ (ต้องอ่าน Apps Script):** รูปแบบเลขออเดอร์, สถานะที่มีใน Sheet, วิธีนับรอบ rolling/ตัดยอด, การจัดการ `testKey`, การล็อกเมื่อสั่งพร้อมกัน, ข้อมูลธนาคารเก็บที่ใด.

## 3. Components
```
Browser (storefront/cart)  ──POST/GET──►  Worker: orders-public   (anonymous, rate-limited)
  /api/orders/config, /api/orders/submit, /api/track
Owner (Access) ───────────►  Worker: orders-admin    (ไม่มี Static Assets เพราะ ctx.access)
  /admin/orders*, /admin/production*, /admin/shipping*, /admin/products*, /admin/settings*, /api/admin/*
Both ──► D1 (norx-orders | norx-orders-staging)    R2 (labels/product images — staging แยก bucket)
```
- แยกเป็น 2 Worker (public / admin) ตามแนวที่ Admin Access Worker ใช้อยู่ — admin Worker fail-closed ตาม `verifiedOwner` ทุก route; public Worker ไม่มี route ที่คืนข้อมูลลูกค้านอกจาก tracking
- Admin Console V2 = หน้า shell เมนู: Overview, Orders, Production, Shipping, Products, Events, Media, Settings (Events/Media ลิงก์เข้าของเดิมแบบไม่แก้)
- Route allowlist: ปฏิเสธทุก path ที่ไม่ match; ตรวจ Origin/Host เหมือน `admin-access-worker`
- **Label generation:** render ฝั่ง browser (SVG/Canvas → PNG 300ppi, PDF ขนาดจริง ด้วย lib vendored ในไฟล์) หลัง fetch ข้อมูลจาก API ที่ผ่าน Access; **ไม่มี URL สาธารณะ**, ไม่เก็บ PNG ใน R2 โดยค่าเริ่มต้น. ฟอนต์ไทย vendored (ต้องเลือกฟอนต์ ดู D7).
- Sender Settings เก็บใน D1 (`settings`) ไม่ฝังในโค้ด/repo. โลโก้ NORX ต้นฉบับ: ใช้ `assets/logo.png` ที่มีอยู่ (ตรวจว่าเป็นต้นฉบับ/มีเวกเตอร์หรือไม่ — D8)
- Tracking: token สุ่ม 128-bit เก็บเฉพาะ hash; หรือ order number + รหัส 6–8 ตัว; rate limit + ตอบ 404 เหมือนกันทุกกรณีไม่พบ; แสดงเฉพาะสถานะ ชื่อย่อ รายการ ไม่แสดงที่อยู่/เบอร์

## 4. Environment Isolation (ข้อกำหนด)
- ไฟล์ config ใหม่ `wrangler.orders.jsonc` ใช้ `env.staging` / `env.production` ที่ **ประกาศ bindings ของตนเองเต็มทุกตัว** (Wrangler ไม่สืบทอด bindings ข้าม env)
- staging: D1 `norx-orders-staging`, rate-limit namespace แยก, `ENVIRONMENT=staging`, ไม่มี EVENTS_DB/MEDIA_BUCKET
- Runtime guard: Worker เริ่มต้นตรวจ `env.ENVIRONMENT` กับ `env.DB_LABEL` (ค่าที่เก็บในตาราง `meta`) ถ้าไม่ตรง → 503 (กันผูก binding ผิด)
- CI/test: test ยืนยันว่า config staging ไม่มี `database_id`/`bucket_name` ของ production
- ห้าม merge `feature/orders-v2` เข้า `feature/cloudflare-migration` จนกว่าจะอนุมัติ (S1)

## 5. Idempotency & Concurrency
- `orders.request_key` UNIQUE (จาก `requestId`) + บันทึก payload hash; request ซ้ำคืนผลเดิม, requestId เดิมแต่ payload ต่างกัน → 409
- เลขออเดอร์: sequence ในตาราง `counters` ผ่าน `UPDATE ... RETURNING` ใน D1 batch (atomic); รูปแบบต้องตรง V1 (รอข้อมูล)
- การสร้างออเดอร์ = `db.batch([...])` ทรานแซกชันเดียว (order, items, history, audit)

## 6. Audit & Security
- ทุกการเปลี่ยนแปลง admin เขียน `audit_log` (actor email hash, action, entity, before/after JSON)
- ห้ามบันทึก PII ใน log ของ Worker; CSV กัน formula injection (ใช้ `csvCell` แบบที่ `event-admin-worker` ทำอยู่)
- Security headers และ `Cache-Control: no-store` ตามแบบเดิม
