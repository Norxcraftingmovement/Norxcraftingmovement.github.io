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

## Changes 2026-11-27 (ยังไม่เคย apply ลง D1 ใด ๆ จึงแก้ 0001 ตรง ๆ; **หลัง apply ครั้งแรก 0001 ถูกตรึง** การเปลี่ยนต่อไปต้องเป็นไฟล์ใหม่)
- `orders.payment_timing` (`prepaid|on_site`), `orders.received_at`, `fulfillment_status` เพิ่ม `completed`
- `UNIQUE(shipments.order_id)` (แทน index ธรรมดา) เพื่อ upsert ตัวนับ reprint
- ตารางใหม่: `notification_queue`, `notification_failures`, `latency_log` (ดู ARCHITECTURE §7)
- Seed สมมติเพิ่มออเดอร์ TEST-0002..0005 (รวมที่อยู่ภาษาไทยยาว และจ่ายหน้างาน)


## Changes 2026-11-27 (Phase 02) — 0001 ยังไม่ถูก apply ที่ใด
- ลบ `payment_timing`, `customers`, `counters`, `round_products` (V1 ไม่มี; ลดแหล่งความจริงซ้ำ). ลูกค้า = `orders.customer_name/phone`
- `payment_status` เพิ่ม `deferred_on_site` (จ่ายหน้างาน ≠ ชำระแล้ว)
- `rounds`: `code` (= roundId V1 "ROUND-003"), `supplier_shipping_baht`, `sent_at`, `successor_of UNIQUE` (กันสร้างรอบรายสัปดาห์ซ้ำ), สถานะ `draft|open|closed|sent`, เวลาต้องเป็น `YYYY-MM-DDTHH:MM:SS.sssZ` (CHECK) เพื่อให้เทียบสตริง = เทียบเวลา
- `products.slug` = id สาธารณะที่หน้าร้านใช้ (`drop02`/`drop03`), เพิ่ม `fit_name`
- `orders`: `fingerprint`, `round_snapshot`, `status_updated_by/at`; `order_items`: snapshot `product_name/fit/fit_name`, `UNIQUE(order,product,sleeve,size)`
- `order_status_history.kind` เพิ่ม `legacy` (เก็บสถานะแบบ V1 ตามที่แอดมินเห็น)
- `notification_queue`: `locked_at`, `UNIQUE(order_id,channel,template)`
- `settings`: `storefront` (บัญชีธนาคาร ลิงก์ โหมดทดสอบ/เปิดจริง รอบรายสัปดาห์ ผู้รับแจ้งเตือน test-key เป็น hash) และ `sender` — **ไม่อยู่ใน repo**


## Changes (review fixes + Phase 03) — 0001 still not applied anywhere
`payments`: `voided_at`, `void_reason`, partial `UNIQUE(order_id) WHERE status='confirmed'` · `orders.import_hash`, `rounds.import_hash` (delta sync markers) · `notification_queue`: `provider_called_at`, `possible_duplicate`.


## Changes (staging readiness) — 0001 still not applied anywhere
`payment_requests`, `payment_events`, `payments(+request_id, provider, bank_txn_ref, verified_at, verified_by)` with unique confirmed `bank_txn_ref` (see PAYMENTS.md) · `notification_queue`: status `unconfirmed`, `ambiguous_count`, `lock_token`, `last_error_code`, `provider_message_id`, `provider_accepted_at`, `delivery_confirmed_at` (raw `last_error` removed) · `notification_failures(+kind, code)` · new append-only `notification_events`.
