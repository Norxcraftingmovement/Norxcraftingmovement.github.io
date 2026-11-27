# STATE — NORX Website / Orders V2
> จุดเริ่มต้นเท่านั้น: ตรวจ git HEAD/status และโค้ดจริงก่อนเสมอ; แทนที่ไฟล์นี้เมื่อจบ session

As of: 27 พ.ย. 2026 ค่ำ · deployed source bc2b4d1 (HEAD อาจใหม่กว่าเพราะเอกสาร) · production ไม่แตะ
กฎ: [CLAUDE.md](CLAUDE.md) · หลักฐาน: [TEST_REPORT](docs/TEST_REPORT.md#staging-rollout--27-nov-2026-codex) · ด่าน: [GO_LIVE_CHECKLIST](docs/GO_LIVE_CHECKLIST.md)

## Staging ที่ใช้อยู่
Public e1cabdf2 → Admin 27b04360 (ตามอนุมัติ); storefront ไม่เปลี่ยน. Bindings/runtime เท่าเดิม; ไม่เปลี่ยน routes/DNS/cron schedule/schema
D1 marker staging ถูกตัว; สำรองนอก git. ก่อน/หลัง 25 orders / 29 items เท่ากัน; คิวรอส่ง 0; ตั้งผู้รับแจ้งเตือนและทดสอบส่งสำเร็จแล้ว. Public cron รายงานได้; Admin แสดงว่าขาดผู้รับถูกต้อง
ตรวจหน้าหลังบ้าน 6 หน้า + mobile Orders ไม่พบ console error; Access gate 16/16 ปิดผู้ไม่ล็อกอิน (Codex solo post-deploy checks ไม่ใช่ independent QA)
Rollback ก่อนรอบนี้: Public 26439a64, Admin 9aa87251; เก็บ D1 ไว้. Admin 589b707d เป็น fallback ที่บันทึกเดิมรับรอง; ห้าม eed44c52

## ด่านที่เหลือ
- A1 ซอร์ส Apps Script = deployed V1: เขียวตามรายงานเดิม; ตรวจซ้ำก่อน cutover
- A2: read-only smoke/visual staging ผ่าน; end-to-end รับบางส่วน/รับเงินพร้อมส่งมอบบน staging ยังค้าง (local 8 checkpoints ผ่านแล้ว)
- A3: Public cron → Email binding → NORX inbox → personal inbox ผ่านหนึ่งฉบับด้วยข้อมูลสมมติ (27 พ.ย. 23:28 น.). ต้นฉบับยังอยู่ NORX; ไม่สร้างออเดอร์. ดู TEST_REPORT หัวข้อ Owner alert delivery. ยังไม่ใช่ full checkout/production test
- A4: QR แอปธนาคาร/ทดสอบ QR staging และฉลากกระดาษยังค้าง
- A5: นำเข้า 17 ออเดอร์/2 รอบ reconcile 0 diff ตามรายงานเดิม; เจ้าของตรวจตัวเลข
- A6: ซ้อม rollback กับสำเนาชีต V1 จริงยังค้าง
ขึ้นระบบเร็วที่สุดเมื่อด่านพร้อม; วันที่เดิมปรับได้ ไม่ข้าม Security Gate/QA/rollback

## UX/UI update — development only
Shared sidebar/mobile menu + compact Orders, refined to owner black/white references with warm off-white/frosted Overview per 28 Nov clarification; opaque operational data. Typography/spacing refinement adds readable 14–16px operational text, consistent spacing and long-name wrapping. See DESIGN.md; orange remains experimental. Overview work list, Settings section anchors, notification deep-link reveal; not deployed. Local 8/8 workflow + 24 viewport checks pass; full 242: 241 pass / 1 skip / 0 fail. See TEST_REPORT: Monochrome reference refinement. Events/Media destinations retained; separate consoles unchanged.

## Next exact action
ต่อ A2 รับบางส่วน/รับเงินพร้อมส่งมอบบน staging ด้วยข้อมูลสมมติ และ A4/A6 ก่อน production/cutover. คำอนุมัติเมลรอบนี้ไม่ครอบคลุมส่งเมลลูกค้าจริง
งานปกติ/ทดสอบ/รวมกิ่งพัฒนาทำต่อเอง ใช้ Single Writer; ถามเรื่องสำคัญต่อระบบ/ข้อมูล/วิธีใช้งาน. Claude ติดลิมิต ให้ Codex solo self-review และรายงานตามจริง

## ทิศทางระยะถัดไป
NORX Management Platform: เจ้าของจัดการผ่าน Admin + Template; ต่อ Commerce/Orders = Products (Drop 04 → Preview → Publish) ใช้ schema/API เดิม รักษา snapshot ออเดอร์เก่า. ตามด้วย Website, Events, Content/Media, Routes/GPX, Analytics/SEO, Growth; ไม่รื้อ Phase เดิม
Trello: https://trello.com/c/a89Pbdgg = สถานะ; GitHub = หลักฐาน; ไม่อ่านประวัติทั้งหมด
