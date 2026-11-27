# Handoff prompt — paste this whole block into the next Claude/Codex chat (on the owner's Windows machine)

```text
คุณคือผู้พัฒนาต่อของโปรเจกต์ NORX Orders V2 (Cloudflare Workers + D1) ทำงานบนเครื่อง Windows ของเจ้าของ ให้ทำตามลำดับ ห้ามข้ามขั้น และตอบเป็นภาษาไทย

## 0) บริบท (ตรวจจริงก่อน อย่าเชื่อข้อความนี้อย่างเดียว)
- Repo: https://github.com/Norxcraftingmovement/Norxcraftingmovement.github.io  Branch ทำงาน: feature/orders-v2 (ห้าม merge เข้า feature/cloudflare-migration ซึ่งเป็น production)
- Trello (อ่านการ์ด + "คอมเมนต์ล่าสุด" ด้วย): https://trello.com/c/2imGq33Y — บอร์ด "NORX — Test Log & QA"
- GitHub HEAD ล่าสุดที่ cloud เห็น: aea5b04 (ต่อจาก df74c47). งานในเครื่องเจ้าของ: commit 7b20b5f (work/norx-dashboard) + outputs/NORX-Orders-V2-r3.patch (ฐาน df74c47) + outputs/NORX-Orders-V2-Handoff-r2.md  — ยังไม่ขึ้น GitHub เพราะ git push ได้ 403 (บัญชี git ผิด)
- อ่านก่อน: docs/HANDOVER.md (ท้ายไฟล์), docs/TEST_REPORT.md, docs/STAGING_RUNBOOK.md, docs/GO_LIVE_CHECKLIST.md

## 1) แก้ git login แล้ว push (งานแรกสุด)
ในโฟลเดอร์ work/norx-dashboard:
  git status ; git log --oneline -5 ; git remote -v ; gh auth status
ถ้าไม่ได้ login ด้วยบัญชีที่เขียน repo ได้: gh auth logout ; gh auth login  (GitHub.com → HTTPS → ให้เจ้าของล็อกอินเอง — ห้ามขอ/เก็บรหัสผ่านหรือ token) แล้วลบ credential เก่า: cmdkey /list | Select-String github  →  cmdkey /delete:git:https://github.com
  git fetch origin feature/orders-v2
  git merge --no-edit origin/feature/orders-v2     # รวม aea5b04 (เพิ่มแค่ docs/GO_LIVE_CHECKLIST.md และ docs/HANDOFF_PROMPT.md)
  node --test tests/*.test.mjs                      # ต้อง Node >= 22.12 ; คาดหวัง ~212 ข้อ ผ่าน 211 ข้าม 1
  git push -u origin feature/orders-v2
ถ้า push ไม่ได้อีก ให้หยุดและรายงานเจ้าของ (ห้าม force-push, ห้ามเขียนทับ branch อื่น)
**ก่อน push ตรวจ diff ว่าไม่มี: Cloudflare account/D1/AUD ID จริง, อีเมลเจ้าของ, เลขบัญชี/ PromptPay จริง, ซอร์ส Apps Script V1, token, ไฟล์ .staging/ หรือ owner-session**

## 2) หลัง push สำเร็จ — แจ้ง "push แล้ว" พร้อม HEAD SHA แล้วทำตามลำดับ (staging เท่านั้น ข้อมูลสมมติเท่านั้น)
 a. ตรวจ migration 0003_round_event_name.sql: ปลอดภัยกับ D1 staging ที่มี 0001+0002 (ไม่ทำลายข้อมูล, ใส่ได้ซ้ำ) → ขออนุมัติเจ้าของก่อน apply
 b. ปิด/แก้ QR บน staging ที่ checkout ซึ่งแสดงชื่อผู้รับเป็นบุคคลจริง (ป้าย "QR เดิม") — ตรวจที่มาของ QR/payee ใน settings ให้เป็น TEST เท่านั้น ก่อนให้ใครทดสอบ
 c. รีวิวและทดสอบ scripts/export-v2-to-v1.mjs (rollback V2→V1) และ scripts/rehearse-v1-local.mjs; ยืนยัน "ไปกลับไม่สูญเสีย" และระบุข้อมูลที่ V1 เก็บไม่ได้
 d. แก้ปัญหาที่พบ: seed TEST-0001..0005 ใช้ปุ่ม Admin ไม่ได้ (รับเฉพาะรหัส NORX-…), ตาราง Production แสดง "รับแล้ว 0" ตอนรับบางส่วน, ช่อง "วันที่ส่ง" ในเลขพัสดุตั้ง shipped_at โดยไม่ตั้งใจ
 e. QA ที่ยังเหลือ: อีเมลถึง inbox จริง (ยัง recipient_not_configured), cron, latency บน Cloudflare, สแกน QR ด้วยแอปธนาคาร (ไม่โอนจริง), พิมพ์ฉลาก A4/A6 บนกระดาษ, จ่ายหน้างาน, กดสั่งซ้ำใกล้เส้นตาย
 f. อัปเดต docs/HANDOVER.md + docs/TEST_REPORT.md และการ์ด Trello (แยก "developer-reported" กับ "independent retest" ไม่อ้างว่าผ่านถ้ายังไม่ได้ทดสอบ)

## 3) ขอบเขต (ห้ามละเมิด)
- แตะได้เฉพาะ staging + ข้อมูลสมมติ. ห้ามแตะ Production, Orders V1 (Apps Script/Sheet), Events, Media, DNS จริง, Billing, Access ของ production
- ห้ามรัน migration/seed ซ้ำโดยไม่จำเป็น, ห้าม redeploy Worker ที่ปลอดภัยแล้วโดยไม่ขออนุมัติ, ห้ามอัปเกรดหรือซื้อบริการ, ห้ามเปิด workers.dev/preview
- ห้ามโอนเงินจริงหรือส่งอีเมลถึงลูกค้าจริง; ห้ามใส่ secret/PII/ID จริงใน repo, Trello, หรือแชต
- ห้ามเปลี่ยน NORX_API ของหน้าร้านจริง / ห้าม cutover — ต้องรออนุมัติแยกจากเจ้าของตาม docs/GO_LIVE_CHECKLIST.md
- Cloudflare auth ใช้ wrangler login ของเจ้าของ (บัญชี NORX) ไม่ใช้ token ที่ฝังในไฟล์; Deploy ที่ต้องทำให้เจ้าของรันเองหรือขออนุมัติทีละคำสั่ง

## 4) รูปแบบรายงาน
สรุปสั้น: environment/branch/HEAD, สิ่งที่ทำ, หลักฐาน, ผล PASS/FAIL/NOT TESTED, blocker, next exact action, สิ่งที่ต้องให้เจ้าของอนุมัติ
```
