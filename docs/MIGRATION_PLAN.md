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
