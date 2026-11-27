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

---
## 7. Addendum (Phase 02a, 2026-11-27)

### 7.1 จ่ายหน้างาน (pay on site)
> **อัปเดต Phase 02:** ใช้ `payment_status = deferred_on_site` (ตรงกับ V1 "จ่ายหน้างาน") แทน `payment_timing` — ดู §8
- `orders.payment_timing` = `prepaid` | `on_site`. ออเดอร์ `on_site` ใช้กับ `delivery='event'` (และนัดรับ) — ไม่ต้องมีสลิปก่อน; `payment_status` เริ่ม `pending` แล้วเจ้าของบันทึก `payments` (method เช่น `cash_on_site`/`transfer_on_site`) และยืนยัน ณ จุดรับ → `confirmed`
- ยอดชำระ/ค่าคงเหลือคำนวณจาก `payments` ไม่ใช่ flag เดียว; ทุกการเปลี่ยนเขียน `order_status_history` + `audit_log`
- **ต้องตัดสินใจ (D13):** ออเดอร์ `on_site` เข้า Production Summary ได้ก่อนรับเงินหรือไม่ (ค่าเริ่มต้นออกแบบ: นับแยกเป็น "ยังไม่ชำระ" ใน summary ไม่ใช่ตัดทิ้ง)

### 7.2 สถานะ "รับสินค้าเรียบร้อย"
- เพิ่ม `fulfillment_status = completed` (+ `orders.received_at`) เป็นสถานะปลายทางของทั้งนัดรับ/รับที่งาน/จัดส่ง (จัดส่ง: เจ้าของยืนยันเองหรือจากการตรวจ tracking ภายหลัง — ไม่มี API ขนส่งใน Phase นี้)
- Payment Status แยกจาก Fulfillment Status ตามเดิม; หน้า `/track/` แสดง `completed` เป็น "รับสินค้าเรียบร้อย"
- ทรานซิชันที่อนุญาต (จะบังคับในโค้ด Phase 02): received → in_production → qc → ready_pickup|ready_ship → shipped → completed; cancelled จากสถานะใดก็ได้ก่อน completed; ห้ามย้อนโดยไม่มี audit note

### 7.3 Mapping สถานะ "ส่งร้านแล้ว" จาก V1 — **ยืนยันแล้วจากซอร์ส V1 (ดู §8.2)**
ยังไม่เห็นซอร์ส Apps Script จึงยังไม่ทราบว่า V1 ใช้คำนี้หมายถึงอะไร ข้อเสนอที่ต้องเจ้าของ/ซอร์สยืนยัน (D14):
| V1 | V2 payment | V2 fulfillment | order_items.production_status | หมายเหตุ |
|---|---|---|---|---|
| ส่งร้านแล้ว | (คงสถานะชำระเดิมของแถวนั้น) | `in_production` | `batched` | ถ้าหมายถึง "ส่งยอดให้โรงงาน/ร้านผลิตแล้ว" |
กฎ migration: **ค่าสถานะ V1 ที่ไม่อยู่ใน mapping = หยุดและรายงาน (fail closed)** ไม่เดา; mapping เก็บเป็นไฟล์ข้อมูล + มี `verified:false` จนเจ้าของยืนยัน; reconcile ต้องนับจำนวนต่อสถานะก่อน-หลัง

### 7.4 Notification Queue / Retry / Failure Log (outbox pattern)
- สร้างออเดอร์ = `db.batch` ทรานแซกชันเดียว: order + items + history + audit + **แถว `notification_queue`** — การส่งแจ้งเตือนล้มเหลวต้องไม่ทำให้ออเดอร์ล้มเหลว/ช้า
- Consumer: Cron Trigger (ฟรี) หยิบ `status IN ('queued','failed') AND next_attempt_at<=now` ทีละชุดเล็ก → `sending` → `sent`
- Retry: exponential backoff 1 นาที → 5 นาที → 30 นาที → 2 ชม. → 12 ชม. (`max_attempts=5`) แล้วเป็น `dead`; ทุกความล้มเหลวเขียน `notification_failures` (attempt, error ที่ตัดข้อมูลส่วนบุคคล)
- Idempotency: unique key ต่อ (order_id, template) กันส่งซ้ำ; Admin เห็นรายการ failed/dead และกด retry เองได้
- ช่องทางส่ง (email/LINE/อื่น) ยังไม่กำหนด — ต้องเลือกโดยไม่มีค่าใช้จ่ายเพิ่ม (D15). ในกรณีที่ไม่มี provider ระบบยังทำงาน: แจ้งเตือนเป็นคิวให้เจ้าของส่งเอง (ข้อความพร้อมคัดลอก)

### 7.5 การวัด latency แยกกัน
- `latency_log(kind='order_creation')`: เวลาจากรับ request ถึง commit ออเดอร์ (ไม่รวมการแจ้งเตือน)
- `latency_log(kind='notification')`: `sent_at − created_at` ของคิว (ไม่รวมเวลาสร้างออเดอร์)
- ข้อควรระวัง: ใน Workers `Date.now()` เดินตามการทำ I/O จึงเหมาะกับการวัดเวลาที่ผ่านการเรียก D1/ภายนอก; รายงาน p50/p95 แยก 2 ชุดใน Admin Overview ภายหลัง

### 7.6 Shipping labels (implemented)
- Layout engine เป็น pure module (`admin-ui/label-layout.mjs`) ทดสอบได้โดยไม่ต้องมีเบราว์เซอร์; เรนเดอร์ด้วย Canvas + ฟอนต์ Sarabun (OFL, ฝังใน Worker ไม่โหลดจากภายนอก) + โลโก้ NORX ต้นฉบับ `assets/logo.png` (ไฟล์เดียวกันแบบ byte-identical; recolor เป็นดำขณะพิมพ์)
- A6 = 105×148 มม. เนื้อหาห่างขอบ ≥7 มม. ทุกด้าน; A4 = แบ่งสี่ส่วนเท่ากัน วาง A6 **ขนาดจริง ไม่ย่อ** (หมึกจริงห่างขอบกระดาษ ≥6.9 มม. วัดจากไฟล์ที่ส่งออก)
- ที่อยู่ยาว: ตัดคำไทยตามขอบเขตคำ (`Intl.Segmenter`), ลดขนาด 14→9pt; ถ้ายังไม่พอ → แจ้งเตือน `ADDRESS_OVERFLOW` และ **ล็อกการส่งออก/พิมพ์** (ไม่ตัดข้อความเงียบ ๆ)
- PNG 300 PPI (1240×1748; A4 2480×3508) พร้อม pHYs; PDF ขนาดหน้าจริง (A6/A4) ฝังภาพ 300 PPI (ข้อความเป็นภาพ ไม่ใช่เวกเตอร์ — ข้อจำกัดที่ยอมรับเพื่อไม่ต้องฝังฟอนต์ไทยใน PDF)
- ไม่มี Public URL: หน้า/asset/API ทั้งหมดอยู่หลัง `verifiedOwner`, CSP เข้ม (ไม่มี inline script/style), ข้อมูลผู้ส่งอยู่ใน D1 `settings` เท่านั้น
- พิมพ์/ส่งออก **ไม่เปลี่ยนสถานะ**; "บันทึกว่าพิมพ์แล้ว" เป็นปุ่มแยกที่เพิ่มแค่ตัวนับ reprint


---
## 8. Phase 02 as-built (2026-11-27) — อ้างอิงซอร์ส Orders V1 ที่เจ้าของส่งให้

### 8.1 พฤติกรรม V1 ที่ยืนยันจากซอร์ส และคงไว้ (ทดสอบเทียบกับ pure logic ของ V1 โดยตรง)
- เลขออเดอร์ `NORX-` + 8 ตัวแรกของ UUID พิมพ์ใหญ่ (V1 ไม่ตรวจชน — V2 มี UNIQUE + retry)
- Idempotency: `requestId` (16–80 ตัว `[-a-zA-Z0-9]`) + fingerprint = SHA-256 ของ JSON ที่ normalize แล้ว (ลำดับ key เหมือน V1 → fingerprint ของออเดอร์ V1 ใช้ต่อได้ใน V2); ซ้ำ+ข้อมูลเหมือน = คืนใบเสร็จเดิมแม้รอบปิดแล้ว; ซ้ำ+ข้อมูลต่าง = ปฏิเสธ
- ราคาจากตารางราคาฝั่ง server เท่านั้น, `expectedTotal` ต้องตรงเป๊ะ, ค่าส่งต่อออเดอร์ (เฉพาะ `ship`), city/event ไม่คิดค่าส่ง, รวมรายการซ้ำ, จำกัด 99/รายการ, 100 รายการ/ออเดอร์
- รอบ: เปิดรับเมื่อ `state=open` และ `opens<=now<=closes` (ขอบเขตรวมปลายทั้งสอง); รอบรายสัปดาห์: ปิดวันอาทิตย์ 23:59 (เวลาไทย) ถัดไป (ถ้าเหลือ ≤12 ชม. ข้ามไปสัปดาห์หน้า), ชื่อ "รอบ N+1", ตัด `event` ออก, ข้อความ "สินค้าพร้อมประมาณ …"
- Snapshot ชื่อ/ทรง/ราคา/รอบ ต่อออเดอร์; สรุปผลิต แยกรุ่น/ทรง/แขน/ไซส์ เรียงตามแคตตาล็อก
- จ่ายหน้างาน: นับเข้าการผลิต แต่ **ไม่นับเป็นรายได้**; ต้องรอตัดยอด (รอบ `sent`) ก่อนเปลี่ยนเป็น "ส่งมอบแล้ว" (= รับเงินแล้ว)
- กติกาเปลี่ยนสถานะ (MOVES), ต้องใส่ยอดเงินตรงกับยอดออเดอร์เมื่อเปลี่ยนเป็นชำระแล้ว/ส่งมอบแล้ว (ยกเว้นจากส่งร้านแล้ว), หลังตัดยอดห้ามกลับเป็นรอโอน/ชำระ/ยกเลิก, ตัดยอดต้องไม่มีรอโอนค้างและยอดตัวต้องตรงกับที่แอดมินเห็น, ยกเลิกรายการที่ไม่โอนต้องยืนยันจำนวน

### 8.2 สถานะ: V1 (หนึ่งแกน) ↔ V2 (สองแกน) แปลงได้ไม่สูญเสีย
| V1 | payment_status | fulfillment_status |
|---|---|---|
| รอโอน | pending | received |
| ชำระแล้ว (และ "เห็นยอดแล้ว" เดิม) | confirmed | received |
| **จ่ายหน้างาน** | **deferred_on_site** (ไม่ถือว่าชำระ) | received |
| ส่งร้านแล้ว (ตัดยอดรอบ → ส่งโรงงาน/ร้าน) | confirmed | in_production |
| ส่งมอบแล้ว (V1 ถือว่าชำระแล้ว) | confirmed | completed |
| ยกเลิก | cancelled | cancelled |
ขั้นสถานะ V2 ภายหลัง (qc, ready_pickup, ready_ship, shipped) อ่านกลับเป็น "ส่งร้านแล้ว" ให้ V1/รายงานเดิม

### 8.3 สร้างออเดอร์: atomic และไม่รออีเมล
`submitOrder` = normalize → fingerprint → ตรวจซ้ำ → quote → **`db.batch` เดียว**: แถวออเดอร์ + รายการ + ที่อยู่ + ประวัติสถานะ + แถว outbox. แถวออเดอร์ถูกแทรกเฉพาะเมื่อ *ใน SQL ขณะ commit* รอบยังเปิด, ค่าส่งไม่เปลี่ยน, และราคาทุกรายการตรงที่ quote ไว้ — ถ้าไม่ตรง ไม่มีอะไรถูกเขียนเลย (เทส mutation ยืนยัน). ออเดอร์ชนกัน (request_key) → คืนออเดอร์เดิม
V1 ที่พบ: ส่งอีเมลกับสร้างออเดอร์ใช้ Script Lock ร่วมกัน และ trigger 5 นาที, ไม่มี retry เมื่อ REVIEW → V2: outbox + Cron (ทุก 1 นาที) + retry/backoff + failure log + dead-letter + ปุ่มส่งใหม่ + `notification_queue UNIQUE(order_id,channel,template)`

### 8.4 Admin auto-refresh
หน้า `/admin/orders/` เรียก `/api/admin/pulse` (token = hash ของจำนวน/เวลาแก้ไขล่าสุดของ orders, รอบ, คิวแจ้งเตือน) ทุก 15 วินาที เฉพาะตอนแท็บมองเห็น; ถ้ามีการเปลี่ยนแปลงและผู้ใช้ไม่ได้กำลังโต้ตอบ (dialog เปิด / พิมพ์ภายใน 4 วินาที / ช่องค้นหา focus) → โหลดเงียบ ๆ; ถ้ากำลังโต้ตอบ → แสดงแถบ "มีการเปลี่ยนแปลงใหม่ [แสดงเลย]" แทนการแทนที่ UI; error → backoff 30→60 วินาที

### 8.5 จุดที่ **ตั้งใจให้ต่างจาก V1**
1. ราคา/ค่าส่ง/รอบ ตรวจซ้ำใน SQL ขณะ commit (V1 พึ่ง lock)
2. เวลาในรอบตอบเป็น UTC `Z` (instant เท่ากัน) แทนสตริง `+07:00`
3. เบอร์โทร/ชื่อเก็บไม่มี `'` นำหน้า (V1 ใส่กัน formula ใน Sheets) — การส่งออก CSV ต้องกัน formula injection เอง
4. โหมดทดสอบ: V1 ให้บัญชีเจ้าของสั่งโดยไม่ต้องมี key — **ไม่พอร์ต** (public Worker ไม่มีตัวตนผู้ใช้); ใช้ `testKey` เท่านั้น
5. ข้อผิดพลาดภายในตอบข้อความทั่วไป ไม่เปิดเผยรายละเอียด
6. ข้อความแจ้งเตือนส่งเป็น JSON ไปยัง provider (webhook) — **เนื้อหาอีเมลแบบ V1 ยังไม่ได้ทำเทมเพลต** (รอ D15)
