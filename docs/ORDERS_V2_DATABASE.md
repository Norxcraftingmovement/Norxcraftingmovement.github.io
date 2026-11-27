# Orders V2 — Database (Draft Schema)
D1 (SQLite, STRICT). Production: `norx-orders` · Staging: `norx-orders-staging`. เงินเก็บเป็นสตางค์ไม่จำเป็น — ใช้ **บาทเป็นจำนวนเต็ม** (V1 ใช้บาทเต็ม). เวลา ISO-8601 UTC.
ชื่อ/คอลัมน์ปรับได้หลังอ่าน Apps Script/Sheet จริง.

```sql
meta(key PK, value)                      -- environment label, schema version
counters(name PK, value)                 -- order number sequence

collections(id PK, slug UNIQUE, name, status[draft|active|archived])
products(id PK, collection_id FK, slug UNIQUE, name, short_name, fit, description,
         status[draft|active|archived], image_key, sort, legacy_id)   -- legacy_id: drop02/drop03
product_variants(id PK, product_id FK, sleeve[short|long], price_baht INT CHECK>=0, active)  UNIQUE(product_id,sleeve)
product_sizes(id PK, product_id FK, size, sort, active) UNIQUE(product_id,size)
rounds(id PK, name, kind[fixed|rolling], opens_at, closes_at, payment_due_at,
       shipping_baht INT, deliveries JSON CHECK(json_valid), ready_text, status[draft|open|closed|archived])
round_products(round_id FK, product_id FK, PK(round_id,product_id))

customers(id PK, name, phone, created_at)            -- ไม่ unique บนเบอร์ (ครอบครัวใช้ร่วม)
orders(id PK, order_no UNIQUE, request_key UNIQUE, payload_hash, round_id FK, customer_id FK,
       source[web|facebook|google_form|manual|v1_import], delivery[city|event|ship],
       subtotal_baht, shipping_baht, total_baht,
       payment_status[pending|slip_received|confirmed|refunded|cancelled],
       fulfillment_status[received|in_production|qc|ready_pickup|ready_ship|shipped|cancelled],
       payment_due_at, paid_amount_baht, paid_at, note, tracking_token_hash,
       is_test INT, legacy_ref, created_at, updated_at)
order_items(id PK, order_id FK, product_id FK, variant_id FK, sleeve, size, qty INT CHECK 1..99,
            unit_price_baht, line_total_baht, production_status[pending|batched|produced|received])
shipping_addresses(order_id PK FK, recipient, phone, address, postal_code, edited_at)
shipments(id PK, order_id FK, provider, tracking_no, shipped_at, label_printed_count, last_label_at)
payments(id PK, order_id FK, amount_baht, method, reference, slip_key, status[recorded|confirmed|void], recorded_by, created_at)
order_status_history(id PK, order_id FK, kind[payment|fulfillment], from_status, to_status, actor, at, note)
audit_log(id PK, at, actor_hash, action, entity, entity_id, before JSON, after JSON)
settings(key PK, value JSON)             -- sender info, logo key, bank info
```

## Indexes
`orders(order_no)`, `orders(payment_status, fulfillment_status)`, `orders(round_id)`, `orders(created_at)`, `order_items(order_id)`, `order_items(product_id,sleeve,size)` (production summary), `shipments(order_id)`.

## กฎข้อมูล
- `order_items` เก็บ `unit_price_baht` ณ เวลาสั่ง (snapshot) — แก้ราคาสินค้าภายหลังไม่กระทบออเดอร์เดิม
- ห้าม DELETE ออเดอร์ (ยกเลิก = เปลี่ยนสถานะ); `is_test=1` แยกออกจากรายงาน/production summary เป็นค่าเริ่มต้น
- `legacy_ref` = เลขแถว/ID ใน Sheets เพื่อ idempotent migration และ reconcile
- ข้อมูลผู้ส่ง (`settings.sender`) ไม่อยู่ใน repo/seed จริง; seed staging ใช้ข้อมูลสมมติเท่านั้น
- Migration files: `migrations/orders/NNNN_*.sql` (additive, ไม่แตะ `migrations/events/`)
