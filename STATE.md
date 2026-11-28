# STATE — NORX Website / Orders V2
> จุดเริ่มต้นเท่านั้น: ตรวจ git HEAD/status และโค้ดจริงก่อนเสมอ; แทนที่ไฟล์นี้เมื่อจบ session

As of: 28 พ.ย. 2026 · deployed source bc2b4d1 (HEAD อาจใหม่กว่าเพราะเอกสาร) · production ไม่แตะ
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
Shared sidebar/mobile menu + compact Orders, refined to owner black/white references with warm off-white/frosted Overview per 28 Nov clarification; opaque operational data. Orders, Production, Settings and Shipping now share warm/frosted layers and compact actions. Shipping separates labels/downloads/tracking/actual shipment; versioned selection prevents late label results re-enabling stale actions. Production counts/receipt actions precede table; Settings grouped. Production rejection notice persists through quiet reload; scoped print rule restored main/table visibility. Existing confirmations/guards retained. Typography remains readable with 44px action targets. See DESIGN.md; orange remains experimental. Overview work list, Settings section anchors, notification deep-link reveal; not deployed. Local 8/8 workflow + 24 viewport checks pass; full 242: 241 pass / 1 skip / 0 fail. See TEST_REPORT: Monochrome reference refinement. Events/Media destinations retained; separate consoles unchanged.

## Products draft preparation — development only
Products แสดงแคตตาล็อก/ค้นหา/กรอง สร้างและแก้ร่าง ดูตัวอย่างข้อมูลได้; active/archived/มีออเดอร์อ่านอย่างเดียว. CAS revision + atomic audit/child writes; ไม่เปลี่ยนแคตตาล็อกสาธารณะหรือออเดอร์เก่า. ไม่มี migration/deploy. ดู TEST_REPORT: Products draft preparation. ต่อยอดรูปปกและพรีวิวแล้วตามหัวข้อถัดไป; ยังไม่มีสร้าง Collection ใหม่/เผยแพร่หรือหน้าเว็บสินค้าอัตโนมัติ

## Products cover + template preview — development only
เลือก/เปลี่ยน/นำรูปปกออก และพรีวิวมือถือ/คอมพิวเตอร์ก่อนบันทึก; แก้ข้อมูลแล้วต้องพรีวิวใหม่. ใช้ CSS จาก Home Terrain ที่ตรงกับเว็บออนไลน์ แต่ markup preview ใหม่ ยังไม่ใช่หน้าเผยแพร่/checkout. อัปโหลดตอนบันทึกร่างเท่านั้น; private cover uses existing image_key/CAS/audit, no migration. Browser 16/16; full 259:258 pass/1skip/0fail; solo self-review. PRODUCT_MEDIA เป็น binding ที่เสนอ ยังไม่เชื่อม Cloudflare; local storage จำลอง. ดู docs/PRODUCTS_MEDIA.md และ TEST_REPORT. รูปเก่าเก็บเพื่อ rollback แต่ URL ถูกเพิกถอนเมื่อไม่มี current reference

## Product themes plan — 28 Nov, planning only
ตรวจเว็บจริง GET200 + render desktop/mobile ของ Home Terrain และ Woven Stride; source ตรงกับ live ณ วันตรวจ. สองธีม: dark/orange vs white/paper/grid; gallery และ size columns ต่างกัน. ดู docs/PRODUCT_THEMES_PLAN.md = แผนหลัก. PR17 preview ใช้เพียง first Home Terrain style block ไม่ใช่ full theme parity. ถัดไปแยก Layout/Theme/Content และทำ 2-theme preview จาก fixtures เดิม แล้ว active-product content drafts/gallery/sizing, homepage/publish/rollback บน staging ตามอนุมัติ. ไม่แก้ runtime/deploy ในงานวิเคราะห์นี้

## Two-theme preview — development milestone
ลำดับ 1 ของ PRODUCT_THEMES_PLAN พัฒนาแล้ว: full CSS/body classes แยก dark/orange กับ paper/grid; shared markup + source fixtures hero/gallery/Lookbook/sizing. Draft เลือกธีมแยกจาก fit และเก็บ settings ใน atomic CAS/audit batch, ไม่มี migration. Existing active products ยังอ่านอย่างเดียว. Browser 24/24 และตรวจภาพ desktop/mobile; ผลชุดรวมดู TEST_REPORT. ไม่ deploy/เปลี่ยน storefront source/Events/Media. Lookbook static assets ต้องอยู่ใน staging build รอบที่จะอนุมัติ deploy

## Next exact action
Products/Website: ทำตาม docs/PRODUCT_THEMES_PLAN.md ลำดับ 2: content drafts สำหรับหน้าเดิม พร้อมกลุ่มรูป จุดเด่น และตารางไซส์แยกแต่ละรุ่น โดยไม่ปลดล็อก commercial fields; เตรียม dedicated private storage/binding + staging Admin deploy ให้เจ้าของอนุมัติตาม CRITICAL ก่อนเปิดอัปโหลดจริง; แล้วตรวจ deployed preview/access/rollback. Gallery/Collection/size chart/Publish ยังเป็นรอบถัดไป. ต่อ A2 รับบางส่วน/รับเงินพร้อมส่งมอบบน staging ด้วยข้อมูลสมมติ และ A4/A6 ก่อน production/cutover. คำอนุมัติเมลรอบนี้ไม่ครอบคลุมส่งเมลลูกค้าจริง
งานปกติ/ทดสอบ/รวมกิ่งพัฒนาทำต่อเอง ใช้ Single Writer; ถามเรื่องสำคัญต่อระบบ/ข้อมูล/วิธีใช้งาน. Claude ติดลิมิต ให้ Codex solo self-review และรายงานตามจริง

## ทิศทางระยะถัดไป
NORX Management Platform: เจ้าของจัดการผ่าน Admin + Template; ต่อ Commerce/Orders = Products (Drop 04 → Preview → Publish) ใช้ schema/API เดิม รักษา snapshot ออเดอร์เก่า. ตามด้วย Website, Events, Content/Media, Routes/GPX, Analytics/SEO, Growth; ไม่รื้อ Phase เดิม
Trello: https://trello.com/c/a89Pbdgg = สถานะ; GitHub = หลักฐาน; ไม่อ่านประวัติทั้งหมด
