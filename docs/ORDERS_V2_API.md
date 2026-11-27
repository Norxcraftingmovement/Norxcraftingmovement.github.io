# Orders V2 — API (Draft)
ทุก `/api/admin/*` และหน้า `/admin/*` ใหม่ต้องผ่าน `verifiedOwner()` (fail-closed 403) ก่อนเข้า handler. ใช้ `Cache-Control: no-store`, ตรวจ Origin สำหรับ method ที่เปลี่ยนข้อมูล.

## Public (anonymous, rate-limited)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/orders/config` | สัญญาเดียวกับ V1 GET (products, round, bank) |
| POST | `/api/orders/submit` | `{action:'submit',order}` ตรงกับ V1; idempotent ด้วย `requestId`; คำนวณราคาฝั่ง server |
| POST | `/api/track` | `{orderNo, code}` หรือ GET `/track/t/{token}` → สถานะ + payment status แยก, ไม่มี PII |
ข้อผิดพลาดของ tracking ทุกกรณีตอบเหมือนกัน (ไม่เปิดเผยว่าเลขมีอยู่).

## Admin (Access-protected)
| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/admin/overview` | จำนวนงานค้าง: รอตรวจเงิน, พร้อมส่งผลิต, รอจัดส่ง, กิจกรรมเปิดรับ |
| GET | `/api/admin/orders?q=&payment=&fulfillment=&round=&from=&to=&cursor=` | ค้นหา/กรอง (cursor pagination) |
| POST | `/api/admin/orders` | เพิ่มออเดอร์ manual (Facebook/Google Forms) |
| GET/PATCH | `/api/admin/orders/{id}` | ดู/แก้ไข (บันทึก audit) |
| POST | `/api/admin/orders/{id}/payments` | บันทึก/ยืนยันยอด |
| POST | `/api/admin/orders/batch` | `{ids[],action,params}` — เปลี่ยนสถานะเป็นชุด (all-or-nothing, จำกัดขนาด) |
| GET | `/api/admin/orders/export.csv` | CSV (กัน formula injection) |
| GET | `/api/admin/production/summary?round=&collection=&…` | สรุปตาม round/collection/รุ่น/แขน/ไซซ์/สถานะจ่ายเงิน (+ `.csv`, หน้า print) |
| POST | `/api/admin/production/batch` | เปลี่ยน `production_status` ของ order_items |
| GET/POST | `/api/admin/shipments`, `/api/admin/orders/{id}/shipment` | provider, tracking, shipped date (ตั้งสถานะ shipped เป็น action แยก) |
| GET | `/api/admin/orders/{id}/label-data` | ข้อมูลสำหรับสร้าง label (นับ reprint) — **ไม่เปลี่ยนสถานะ** |
| GET/PUT | `/api/admin/settings/sender` | ข้อมูลผู้ส่ง |
| CRUD | `/api/admin/products`, `/variants`, `/sizes`, `/rounds` | Phase 08 |
| GET | `/api/admin/audit?entity=&id=` | ดู audit |

Error format: `{ok:false,error:"CODE"}` + HTTP status ที่ถูกต้อง (V1 adapter ใช้ 200 + `ok:false` เพื่อเข้ากับ `shop.js`).
OpenAPI/ตัวอย่าง request-response จะเพิ่มใน Phase 02.

## Implemented (Phase 02a) — `src/orders-admin-worker.mjs`, `src/orders-admin-api.mjs`
ทุก route: allowlist → host → method → `verifiedOwner` (403) → environment guard (API, 503) → เขียนข้อมูลต้อง `Origin` ตรง + `application/json` ≤64KB (CSRF).
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/admin/shipping/`, `/admin/settings/` | หน้า Admin (CSP เข้ม) |
| GET | `/admin/assets/{file}` | JS/CSS/Sarabun/โลโก้ (เฉพาะไฟล์ใน allowlist) |
| GET/PUT | `/api/admin/settings/sender` | ผู้ส่ง: brandName ≤60, senderName ≤80, address 10–300, phone; audit |
| GET | `/api/admin/labels/orders?q=&printed=0\|1` | ออเดอร์ `delivery=ship` ที่มีที่อยู่ (≤100) |
| POST | `/api/admin/labels/data` `{ids≤50}` | ข้อมูลใบจ่าหน้า + sender + `missing[]` |
| POST | `/api/admin/labels/printed` `{ids}` | เพิ่มตัวนับ reprint เท่านั้น |
| PUT | `/api/admin/orders/{id}/address` | แก้ที่อยู่ (กฎเดียวกับ V1: เบอร์ `^0\d{8,9}$`, ที่อยู่ ≥15 ตัว + รหัส ปณ. 5 หลัก), audit before/after |
| PUT | `/api/admin/orders/{id}/shipment` | provider / tracking `[A-Za-z0-9-]{0,40}` / shippedAt `YYYY-MM-DD` — ไม่เปลี่ยนสถานะ |


## Phase 02 — Storefront contract (public Worker, `src/orders-public-worker.mjs`)
`GET /api/orders` → `{ok,testOnly,rolling,serverNow,bank,chatUrl,pageUrl,eventName,products[],round,nextRound}` · `POST /api/orders` body (text/plain หรือ JSON) `{action:"submit",order}` → ใบเสร็จ V1 `{ok,id,name,roundId,items,subtotal,shipping,total,paymentDue,status}` หรือ `{ok:false,error}`. HTTP 200 เสมอ (สัญญา V1), CORS เฉพาะ `ORDERS_PUBLIC_ORIGINS`, จำกัดขนาด 64 KB, rate limit ผ่าน binding `ORDERS_LIMITER`. หน้าร้านสลับด้วยการเปลี่ยน `window.NORX_API` เท่านั้น (ไม่ต้องแก้ `shop.js`).
## Phase 02 — Admin เพิ่มเติม (ทุกเส้นทางผ่าน `verifiedOwner`; เขียนข้อมูลต้อง same-origin + JSON)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/admin/orders/` | หน้าออเดอร์ + รีเฟรชอัตโนมัติ |
| GET | `/api/admin/orders?round=&status=&q=` | รายการ + `moves[]` ที่ทำได้ |
| POST | `/api/admin/orders/{NORX-XXXXXXXX}/status` `{from,to,amount}` | กติกา V1; optimistic concurrency ที่ระดับแถว; 400 `{ok:false,error:"USER_ERROR",message}` |
| GET/POST | `/api/admin/rounds` | สรุปรอบ+phase+shopText / สร้าง-แก้รอบ |
| POST | `/api/admin/rounds/{code}/open\|close\|cancel-unpaid\|send-to-shop` | ตัดยอดเป็น atomic batch |
| GET | `/api/admin/pulse` | token การเปลี่ยนแปลง (auto-refresh) |
| GET / POST | `/api/admin/notifications` , `/{id}/retry` | คิวแจ้งเตือนที่ค้าง/ล้มเหลว, ส่งใหม่ |
| GET | `/api/admin/metrics/latency` | p50/p95 แยก `order_creation` กับ `notification` |
| GET/PUT | `/api/admin/settings/storefront` | บัญชีธนาคาร ลิงก์ โหมดเปิดจริง รอบรายสัปดาห์ ผู้รับแจ้งเตือน test-key (เก็บ hash ไม่ส่งกลับ) |
