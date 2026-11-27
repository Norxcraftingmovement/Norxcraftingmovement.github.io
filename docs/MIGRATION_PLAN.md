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
