# STATE — NORX Website / Orders V2
> จุดเริ่มต้นของ session ใหม่ **ไม่ใช่ตัวแทนการตรวจโค้ด**: รัน `git log -1 --format=%h` และ `git status` ก่อนเสมอ ถ้า HEAD ไม่ตรงบรรทัด "As of" ให้เชื่อ git/โค้ด แล้วแก้ไฟล์นี้ (**แทนที่ ไม่ต่อท้าย**, ไม่เกิน ~3K ตัวอักษร)

As of: 2026-11-27 ค่ำ · Orders V2 มีตัวแก้ข้อความปฏิเสธ @ `2bebd35` และตัวแก้สถานะอีเมลในชุดนี้ — ตรวจ git HEAD ปัจจุบันเสมอ · production `feature/cloudflare-migration` @ `c227b7a` — ห้ามแตะ
กฎการทำงาน/ระดับงาน: [CLAUDE.md](CLAUDE.md) · ประวัติ/หลักฐาน (ต่อท้าย อย่าอ่านทั้งไฟล์): [docs/HANDOVER.md](docs/HANDOVER.md) · ด่านขึ้นระบบจริง: [docs/GO_LIVE_CHECKLIST.md](docs/GO_LIVE_CHECKLIST.md)

## Staging ที่ deploy อยู่
Admin `9aa87251` (rollback ได้เฉพาะ `589b707d` ห้าม `eed44c52`) · Public `26439a64` · storefront `3bcf6749` · D1 = 0001 + 0002 + นำเข้า V1 ปิดข้อมูล (`V1-ROUND-001` ส่งร้านแล้ว, `V1-ROUND-002` เปิดรับ; 17 ออเดอร์ `v1_import` + 8 สมมติ; สำรองก่อนนำเข้าอยู่ใน `private/`)

## ด่าน (รายละเอียด GO_LIVE ข้อ A และ G)
- A1 Apps Script ที่ใช้อยู่ = ซอร์สที่พอร์ต: **เขียว** (เวอร์ชัน 7, 26 พ.ย. 19:46) — ตรวจซ้ำคืน cutover
- A2 smoke/UI บน build ที่จะขึ้น: **ค้างบน staging**. ซ้อม local ด้วยข้อมูลสมมติผ่าน 8 checkpoints (รับบางส่วน → กันส่งมอบ → รับครบ → ตรวจยอดเงิน → รับเงินพร้อมส่งมอบ); พบข้อความปฏิเสธถูก quiet refresh ลบทิ้ง แก้ในกิ่งพัฒนาแล้ว ต้องตรวจซ้ำบน staging build ที่จะใช้จริง
- A3 อีเมล: **ค้างบน staging** — แก้ในกิ่งพัฒนาให้ Public cron รายงานสถานะและ Admin อ่าน; ไม่มีรายงาน/เก่าเกิน 5 นาทีไม่ขึ้นพร้อม. ยังต้องเปิด Email Service + ยืนยัน destination + โดเมนผู้ส่ง; rollout ต้อง Public แล้ว Admin และตรวจอีเมลถึงผู้รับจริง
- A4 QR แอปธนาคาร + independent retest QR staging: **ค้าง**
- A5 ซ้อมนำเข้า V1: **เขียว** (staging 17 ออเดอร์/2 รอบ reconcile 0 diff) — เจ้าของดูตัวเลขใน Admin
- A6 ซ้อมทางถอยกับสำเนาชีต V1 จริง: **ค้าง** (เจ้าของ)
- เจ้าของยืนยันเป้าหมาย: ขึ้นระบบให้เร็วที่สุดเมื่อพร้อม; วันที่เดิมปรับได้ ไม่ใช้เป็นด่านเวลาอัตโนมัติ แต่ Security Gate, QA, rollback และการอนุมัติแต่ละการเปลี่ยนแปลงยังครบตามเดิม

## รออนุมัติ/ตัดสินใจ (เจ้าของ)
Email Service + โดเมนผู้ส่ง · deploy staging Public + Admin (readiness/UI fixes) · ทรัพยากร production · cutover

## Workflow Phase 1 review (Codex, 27 พ.ย.)
ชุด Phase 1 ผ่าน Codex solo ตามที่เจ้าของมอบหมาย: แก้ base ผิด/ประวัติค่าลับ/ข้อมูลขึ้นต้น ++. focused 16/16; full suite 235 ผ่าน 234 ข้าม 1 ล้ม 0; preflight OK (solo self-review ไม่ใช่ independent QA). ตัวแก้ PR #3; สถานะรวมให้เช็ค GitHub/HEAD. ไม่ deploy/ไม่แก้ checkout ของ Claude

## Next exact action
เตรียม rollout staging Public → Admin เมื่อขอบเขตได้รับอนุมัติ แล้วตรวจ A2/A3 จริง. ตัวแก้อีเมล: focused 31/31; full suite 242 ผ่าน 241 ข้าม 1 ล้ม 0; visual/functional 390/1280 ผ่าน สถานะปรับตามรายงานโดยไม่กดรีเฟรช (solo self-review). ไม่มี deploy/ส่งอีเมลจริง/เปลี่ยน DNS ในรอบนี้

## ทิศทางรอบถัดไป (เจ้าของยืนยัน)
NORX Management Platform: เจ้าของจัดการข้อมูลผ่าน Admin + Template ของ NORX; AI เพิ่มความสามารถใหม่. ต่อจาก Commerce/Orders ให้ทำ Products (สร้าง Drop 04 → Preview → Publish โดยไม่แก้โค้ดรายสินค้า) โดยต่อยอด schema/API เดิมและไม่เปลี่ยน snapshot ของออเดอร์เก่า. จากนั้น Website, Events, Content/Media, Routes/GPX, Analytics/SEO, Growth ตาม roadmap ภาพรวม; ไม่รื้อ Phase ทางเทคนิคเดิม

## สถานะบน Trello
การ์ดสถานะสั้น: https://trello.com/c/a89Pbdgg · การ์ดเดิม https://trello.com/c/2imGq33Y = ประวัติ (ไม่ต้องอ่านทั้งการ์ด)
