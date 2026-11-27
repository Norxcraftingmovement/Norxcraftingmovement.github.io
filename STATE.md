# STATE — NORX Website / Orders V2
> จุดเริ่มต้นของ session ใหม่ **ไม่ใช่ตัวแทนการตรวจโค้ด**: รัน `git log -1 --format=%h` และ `git status` ก่อนเสมอ ถ้า HEAD ไม่ตรงบรรทัด "As of" ให้เชื่อ git/โค้ด แล้วแก้ไฟล์นี้ (**แทนที่ ไม่ต่อท้าย**, ไม่เกิน ~3K ตัวอักษร)

As of: 2026-11-27 ค่ำ · `feature/orders-v2` @ `ed24c14` (GitHub = เครื่องบ้าน) · production `feature/cloudflare-migration` @ `c227b7a` — ห้ามแตะ
กฎการทำงาน/ระดับงาน: [CLAUDE.md](CLAUDE.md) · ประวัติ/หลักฐาน (ต่อท้าย อย่าอ่านทั้งไฟล์): [docs/HANDOVER.md](docs/HANDOVER.md) · ด่านขึ้นระบบจริง: [docs/GO_LIVE_CHECKLIST.md](docs/GO_LIVE_CHECKLIST.md)

## Staging ที่ deploy อยู่
Admin `9aa87251` (rollback ได้เฉพาะ `589b707d` ห้าม `eed44c52`) · Public `26439a64` · storefront `3bcf6749` · D1 = 0001 + 0002 + นำเข้า V1 ปิดข้อมูล (`V1-ROUND-001` ส่งร้านแล้ว, `V1-ROUND-002` เปิดรับ; 17 ออเดอร์ `v1_import` + 8 สมมติ; สำรองก่อนนำเข้าอยู่ใน `private/`)

## ด่าน (รายละเอียด GO_LIVE ข้อ A และ G)
- A1 Apps Script ที่ใช้อยู่ = ซอร์สที่พอร์ต: **เขียว** (เวอร์ชัน 7, 26 พ.ย. 19:46) — ตรวจซ้ำคืน cutover
- A2 smoke/UI บน build ที่จะขึ้น: **ค้าง** (ปุ่ม "รับเงินและส่งมอบ", รับของบางส่วน ยังไม่เคยลองบน staging)
- A3 อีเมล: **ค้าง** — เจ้าของต้องเปิด Email Service + ยืนยัน destination + โดเมนผู้ส่ง (D24); Admin แสดงความพร้อมผิด Worker (รออนุมัติ deploy Admin)
- A4 QR แอปธนาคาร + independent retest QR staging: **ค้าง**
- A5 ซ้อมนำเข้า V1: **เขียว** (staging 17 ออเดอร์/2 รอบ reconcile 0 diff) — เจ้าของดูตัวเลขใน Admin
- A6 ซ้อมทางถอยกับสำเนาชีต V1 จริง: **ค้าง** (เจ้าของ)
- go/no-go **ศ. 4 ธ.ค.** · cutover คืน 5–6 ธ.ค. ถ้าทุกด่านเขียว · ห้ามแตะ production 11–13 ธ.ค.

## รออนุมัติ/ตัดสินใจ (เจ้าของ)
Email Service + โดเมนผู้ส่ง · deploy Admin (readiness) · ทรัพยากร production ทีละคำสั่ง · ทุกอย่างของ cutover

## Next exact action (Claude)
เตรียมทรัพยากร production ทีละคำสั่ง **เมื่อเจ้าของสั่ง** (ขออนุมัติทุกคำสั่ง) · ไม่แตะ production จนกว่าอนุมัติ

## สถานะบน Trello
การ์ดสถานะสั้น: https://trello.com/c/a89Pbdgg · การ์ดเดิม https://trello.com/c/2imGq33Y = ประวัติ (ไม่ต้องอ่านทั้งการ์ด)
