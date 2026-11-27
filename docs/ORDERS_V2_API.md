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
