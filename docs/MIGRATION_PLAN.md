# Migration Plan: Orders V1 (Apps Script + Sheets) → V2 (Workers + D1)
สถานะ: ร่าง Phase 00. ไม่มีการเข้าถึงข้อมูลจริงในรอบนี้ ไม่มีการเปลี่ยนแปลง production.

## ขั้นตอน
1. **Read-only audit** (เจ้าของส่งออก Code.gs + หัวตาราง/แถวตัวอย่างที่ปิดบังแล้ว): ระบุ sheet, คอลัมน์, รูปแบบเลขออเดอร์, สถานะ, สูตร, trigger, LockService, ตัวนับ
2. **Backup**: สำเนา Spreadsheet (File → Make a copy) + CSV export ทุกชีต เก็บใน Drive ส่วนตัว ไม่ลง repo; บันทึก checksum และจำนวนแถว ณ เวลานั้น
3. **Data mapping** (ร่าง): แถวออเดอร์/รายการ → `orders`/`order_items`/`customers`/`shipping_addresses`; ราคา snapshot จากแถวเดิม (ไม่คำนวณใหม่); เลขออเดอร์เดิมคงไว้; `legacy_ref` = เลขแถว/ID; `source='v1_import'`
4. **Migration script** (`scripts/migrate-v1.mjs`): อ่านจาก CSV export → SQL/JSON; `INSERT ... ON CONFLICT(order_no) DO NOTHING` (กันซ้ำ); รัน **dry-run** เป็นค่าเริ่มต้น (ไม่เขียน DB) ส่งรายงานต่าง
5. **Reconciliation report**: เทียบ จำนวนออเดอร์, จำนวนชิ้น, ยอดสินค้า, ค่าส่ง, ยอดรวม, สถานะชำระ, ผู้รับ/สถานะจัดส่ง; ต้อง 0 diff หรือมีรายการยกเว้นที่เจ้าของรับทราบ
6. **ทดลองบน staging** ด้วยข้อมูล V1 ที่ **ลบ/สลับ PII แล้ว** เท่านั้น (ข้อมูลลูกค้าจริงไม่เข้า staging)

## Cutover (ต้องอนุมัติแยก)
เลือกรูปแบบให้ **มีแหล่งรับออเดอร์จริงเพียงแหล่งเดียวในทุกเวลา** — ไม่ dual-write:
1. กำหนดหน้าต่างเวลา (นอกช่วงเปิดรอบขาย/ใกล้ตัดยอด)
2. Freeze V1: ตั้ง Apps Script ให้ปิดรับ (หรือแจ้งปิดรอบสั้น ๆ) → บันทึก high-water mark (เลขออเดอร์/เวลาท้ายสุด)
3. Export V1 สุดท้าย → import เข้า V2 production (delta จาก high-water mark) → reconcile = 0 diff
4. สลับ `NORX_API` ใน storefront เป็น V2 → smoke test ด้วยออเดอร์ทดสอบที่ติด `is_test` และยกเลิกทันที
5. เปิดรับ; V1 อยู่โหมด read-only (ไม่ลบ Apps Script/Sheets)
ออเดอร์ที่เข้า V1 ระหว่างพัฒนา: ถูกนำเข้าด้วย delta import ในข้อ 3 (idempotent ด้วย `order_no`/`legacy_ref`)

## Rollback
- ก่อนเปิดรับบน V2: ย้อน `NORX_API` กลับ V1 และ unfreeze (ไม่มีออเดอร์ V2 จริง)
- หลังเปิดรับแล้ว: freeze V2 → export ออเดอร์ที่เกิดหลัง cutover ลง Sheet V1 ด้วยสคริปต์ย้อนกลับ (ต้องเตรียมและทดสอบบน staging ก่อน cutover) → สลับ `NORX_API` กลับ
- เกณฑ์ตัดสินใจ rollback ต้องกำหนดล่วงหน้า (เช่น reconcile ไม่ผ่าน, submit error > X%)

## ความเสี่ยง
เลขออเดอร์ชนกัน (sequence ต้องเริ่มต่อจาก V1), ออเดอร์เข้าระหว่าง freeze, ราคา/ค่าส่งคำนวณต่างจาก V1, ผู้ใช้ที่มีตะกร้าค้างใน localStorage (`norx-cart-v2` ต้องใช้ได้ต่อ — รักษา schema ตะกร้าและ `product.id` เดิม `drop02`, `drop03`).


---
## Update 2026-11-27 — หลังได้รับซอร์ส V1
**บันทึกการตรวจ:** ไฟล์ซอร์สที่ได้รับ SHA-256 = `a9f9b78a36b654717453ef6f94d05bb18a06e190d2cb1d3447506305b08d7a59`; บล็อก pure logic (`NorxCore`) SHA-256 = `b371971fdbfd006cc282b55255eaae72fa50938880b8d846b6d1760c997bb745`. ซอร์สไม่ถูก commit (มีบัญชีธนาคาร อีเมล และรหัส Sheet) — เก็บไว้นอก repo; `.gitignore` กัน `/v1-source/`, `/private/`, `*.v1.gs`, `*.v1.txt` และมีเทส `repo-hygiene` ตรวจรูปแบบข้อมูลลับ

**ตรวจว่าซอร์สตรงกับเวอร์ชันที่ deploy จริง — ยังทำไม่ได้จากฝั่งผม** (เรียก Google ไม่ได้). ขั้นตอนที่เจ้าของ/ผู้ดูแลต้องทำก่อน cutover:
1. Apps Script → Deploy → Manage deployments → ดู **เวอร์ชันของ deployment ที่ใช้งานจริง** (ไม่ใช่ HEAD) → เปิดโค้ดของเวอร์ชันนั้น → บันทึกลงไฟล์ในเครื่อง
2. `node scripts/v1-verify-source.mjs <ไฟล์>` → ต้องได้ `RESULT: pure business logic identical` และ hash ตรงกับข้างบน (พิมพ์เฉพาะ hash ไม่พิมพ์ซอร์ส)
3. ส่วนที่ไม่ใช่ pure logic (Sheets, admin, trigger, PropertiesService ค่า `LIVE_ENABLED`/`ROLLING_WEEKLY`/`EMAIL_ENABLED`) ให้เทียบไฟล์ทั้งหมดกับที่ตรวจแล้ว (hash ไฟล์ทั้งก้อนต้องตรง) และบันทึกค่า Script Properties ปัจจุบัน
4. `GET` config จริงของ V1 (อ่านอย่างเดียว) เทียบกับ `publicConfig` ของ V2 หลัง import: products/ราคา/รอบ/วิธีรับ

**เครื่องมือที่ทำแล้ว** (`src/v1-import.mjs`): วางแผนนำเข้า (fail-closed: สถานะ/ยอดเงิน/รายการ/สินค้า/ซ้ำ ไม่ถูกต้อง = หยุด), dry-run, นำเข้าแบบ idempotent (`ON CONFLICT DO NOTHING` ต่อ `order_no`/`code`; ทรานแซกชันต่อออเดอร์), **คง `NORX-XXXXXXXX`, requestId, fingerprint, เวลาสั่ง, snapshot ราคา**, reconcile (จำนวนออเดอร์/ชิ้น, ยอดสินค้า/ค่าส่ง/รวม, จำนวนต่อสถานะ, ผู้รับ/เบอร์/ที่อยู่/รอบ ต่อออเดอร์). เทส cutover: retry ของลูกค้าที่ requestId เดิมหลัง import → ได้ออเดอร์เดิม ไม่เกิดซ้ำ.
**ยังไม่ได้ทำ:** ตัวอ่าน CSV/Sheets ของจริง (ตอนนี้รับแถวที่ parse แล้ว), delta import หลัง freeze, สคริปต์ rollback ย้อนเข้า Sheets, ทดสอบกับข้อมูลจริงที่ปิดบังแล้ว


---
## Update 2026-11-27 (review fixes) — delta sync, reconciliation, anonymised fixtures
**Import is now a repeatable sync** (`src/v1-import.mjs`, `planSync` / `runSync` / `renderSql` / `reconcileState`). Each synced order/round stores `import_hash` (hash of the V1 canonical form it came from). On every run, per row: new → insert · V1 changed & V2 untouched → update from V1 · V2 edited locally → keep and report · both changed → **conflict** (report; nothing overwritten in `safe` mode) · identical → no-op. `v1-wins` mode (for the **final sync while V1 is frozen**) overwrites with an audit row (`order.v1_overwrite`). Rows present in V2 but missing from the V1 export are reported as **orphans** and never deleted. Native V2 orders (accepted before cutover) are counted and reported. Updates are guarded in SQL (`import_hash` + the V2 row's `updated_at` as seen at plan time), so a V2 edit landing between plan and apply is not overwritten. Statuses, payments (void/insert so exactly one confirmed payment per paid-like order), items (upsert in place; production progress kept), shipping address and round fields all follow V1.
**Reconciliation** compares counts, pieces, subtotal/shipping/total sums, status counts, paid total vs confirmed payments, then per order: status, name, phone, delivery, address, items (sleeve/size/qty/price), money, round, note, test flag, requestId, fingerprint, created and due dates, payments; per round: name, times, state, shipping, supplier shipping, deliveries, ready text, sent time.
**Offline procedure (no network needed from this repo):** export V1 sheets to CSV (private) → `scripts/anonymize-v1-export.mjs` for staging → read V2 state with the SQL in `STATE_SQL` via `wrangler d1 execute … --json` → `planSync` → review the report (updated / inserted / conflicts / orphans / local changes) → `renderSql` → `wrangler d1 execute … --file sync.sql` → read state again → `reconcileState` must return `ok:true`. Tested end-to-end on SQLite: rendered SQL produces the identical database to direct apply.
**Final delta (cutover):** freeze V1 (stop accepting) → export → `v1-wins` plan → apply → reconcile = 0 diff, orphans reviewed, native-order count = 0 → switch `NORX_API`.
**Fixtures (D19):** `tests/fixtures/v1-anonymized/` — two snapshots (35 → 37 orders, 3 rounds): all six statuses + "เห็นยอดแล้ว", `NORX-LEGACY-00x` ids, long Thai address, test order, status moves, an address edit, a quantity edit, new orders, a removed row, a round closed→sent and a round time change. Generated by `scripts/make-anonymized-fixtures.mjs` through the real anonymiser (pseudonyms keyed by order id, fingerprints recomputed).
**Not done:** real private export has not been read (none provided); rollback script into Sheets; `wrangler d1 execute` was never run (no staging DB yet).


---
## Update 2026-11-27 (Recovery R4) — rollback tool `scripts/export-v2-to-v1.mjs`
Rewritten after the earlier local version was lost with 7b20b5f. It only READS (three SELECT statements); it never writes to D1, the Sheets or V1.

**Use (after freezing V2 and taking a D1 backup/snapshot):**
```
node scripts/export-v2-to-v1.mjs --print-sql
npx wrangler d1 execute norx-orders-production --remote --json --command "<each SQL>" > private/orders.json      (rounds.json, products.json)
node scripts/export-v2-to-v1.mjs --orders private/orders.json --rounds private/rounds.json --products private/products.json --out private/rollback-YYYYMMDD
```
`--all` exports every order (rebuild the sheet); `--include-test` adds synthetic orders (excluded by default). `--out` must be outside the repo or in `/private/` or `/.staging/` — the files hold customer data and the tool refuses anything else.

**Output:** `orders-v1.csv` and `rounds-v1.csv` (the exact columns the V1 → V2 importer reads), `manifest.json` (ids to **append** vs **replace**, row counts, sums of ค่าเสื้อ/ค่าส่ง/ยอดรวม, rows per status, SHA-256 of both CSVs, warnings, the 6 steps to apply them, and what V1 cannot hold — ids and counts only, no customer data).
**Default (delta):** orders born in V2 → append; imported orders whose V2 state differs from what was imported (hash compare with `import_hash`) → replace the row; untouched imports are not exported (V1 still has them, which holds because V1 stays read-only after cutover). Rounds likewise.

**Proof built in (exit code 1 if it fails — do not use the files then):** the CSVs are re-read with the importer's own parser and fail-closed validation, then reconciled against the V2 rows field by field (status, name, phone, address, items, money, round, note, test flag, requestId, fingerprint, dates, payments) and against the manifest totals. Tests also load the exported CSV into a fresh V2 and reconcile (re-cutover after a rollback), and corrupt the CSV on purpose to show the check catches it.

**What V1 cannot hold (stays in D1 — keep the snapshot):** carrier / tracking number / shipped date, partial-receipt progress, payment method / bank reference / QR requests, status history, audit log, notifications, customer tracking tokens. Finer fulfillment states (qc, ready pickup, ready ship, shipped) collapse to V1's ส่งร้านแล้ว; test orders are marked by the note "ทดสอบ" (V1's convention). The manifest counts these.
**Not verified (needs the owner):** how the real V1 Sheet stores phone numbers and dates and whether its Apps Script reads pasted rows correctly. Rehearse on a COPY of the real Sheet (GO_LIVE_CHECKLIST A6) before any cutover; the tool's job is to make that rehearsal possible and the result checkable.
