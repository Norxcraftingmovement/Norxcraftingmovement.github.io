# Decisions

## ตัดสินใจแล้ว (ADR)
- **A1** ใช้ Admin Access Worker + `verifiedOwner()` เดิม ไม่สร้าง auth ใหม่
- **A2** Orders V2 ใช้ Worker + D1 แยกจาก Events/Media (ไม่แก้ worker เดิม ยกเว้นเมนู shell)
- **A3** Staging/Production แยกด้วย Wrangler `env` ที่ประกาศ bindings ครบ + runtime guard (`meta.environment`)
- **A4** Storefront compatibility ด้วย adapter ที่ใช้สัญญา V1; สลับ `NORX_API` ตอน cutover เท่านั้น
- **A5** ราคา/ค่าส่งคำนวณ server-side; snapshot ราคาใน `order_items`
- **A6** ไม่ลบข้อมูล, ไม่ dual-write; V1 ยังอยู่เป็น read-only หลัง cutover
- **A7** Label render ฝั่ง browser จากข้อมูลที่ผ่าน Access; ไม่มี public URL; พิมพ์ไม่เปลี่ยนสถานะ

## ต้องให้เจ้าของตัดสินใจก่อนเริ่ม Implementation
| # | คำถาม | คำแนะนำ |
|---|---|---|
| D1 | ส่งออก **ซอร์ส Apps Script ทั้งหมด** + หัวตาราง/แถวตัวอย่างที่ปิดบังจาก Sheets ให้ได้หรือไม่ (ผมเข้าไม่ถึง) | จำเป็น — Blocker ของ Phase 02 |
| D2 | ออเดอร์ V1 ปัจจุบันยังเปิดรับอยู่หรือไม่ / รอบถัดไปคือเมื่อใด (กำหนดช่วง cutover) | |
| D3 | ยืนยันสร้าง D1 `norx-orders-staging` และ `norx-orders` + Worker staging (ไม่มีค่าใช้จ่ายเพิ่มบน free tier; ถ้าต้องจ่าย ต้องแจ้งก่อน) และให้ผมเตรียม config เอง ส่วนคุณสร้างใน dashboard | แนะนำ: ใช่ |
| D4 | ปิด preview-build ของ Worker หลัก (S2) หรือยอมรับ flag-guard — **การแก้ dashboard เป็นอำนาจของเจ้าของ** | แนะนำ: ปิด/override bindings |
| D5 | จะรวม `main` (9 commit community) กับ `feature/cloudflare-migration` อย่างไร ก่อน cutover | ทำก่อน Phase 09 |
| D6 | Payment: ยืนยันด้วยมือจากสลิป (ไม่เชื่อมธนาคาร) และเก็บรูปสลิปใน R2 หรือไม่ | แนะนำ: ไม่เก็บสลิป ใน Phase แรก |
| D7 | ฟอนต์ภาษาไทยสำหรับใบจ่าหน้า (ต้องมีสิทธิ์ใช้ฝัง) เช่น Noto Sans Thai / Sarabun (OFL) | แนะนำ Sarabun |
| D8 | ไฟล์โลโก้ต้นฉบับ (เวกเตอร์ SVG/PDF หรือ PNG ความละเอียดสูง) — `assets/logo.png` ใช้ได้หรือไม่ | |
| D9 | รูปแบบเลขออเดอร์และต้องคงของเดิมแบบใด (รอ D1) | |
| D10 | Tracking: ใช้ลิงก์ส่วนตัว (token) หรือ เลขออเดอร์+รหัสตรวจสอบ หรือทั้งสอง | แนะนำ: ลิงก์ token เป็นหลัก + เลขออเดอร์+เบอร์ท้าย 4 หลักสำรอง |
| D11 | สถานะ "พร้อมรับสินค้า" (นัดรับ) vs "พร้อมจัดส่ง" แยกตามวิธีรับ ใช่หรือไม่ | แนะนำ: ใช่ |
| D12 | Admin: ผู้ใช้คนเดียว (เจ้าของ) ตลอด Phase นี้ ใช่หรือไม่ | แนะนำ: ใช่ |

## เพิ่ม 2026-11-27
- **A8** Migration ที่ยังไม่เคย apply แก้ได้; หลัง apply แล้วตรึง (additive-only ไฟล์ใหม่)
- **A9** Label render ฝั่งเบราว์เซอร์; PDF ฝังภาพ 300 PPI ขนาดจริง (ไม่ฝังฟอนต์); A4 = 4 ช่องขนาดจริงไม่ย่อ, เนื้อหาห่างขอบ ≥7 มม.
- **A10** ฟอนต์ Sarabun (OFL) และโลโก้ NORX ต้นฉบับ ฝังใน admin Worker (ไม่พึ่ง CDN); ไฟล์ license อยู่ใน `admin-ui/fonts/OFL-Sarabun.txt`
- **A11** Notification ใช้ outbox + Cron + retry/failure log; ล้มเหลวไม่กระทบการสร้างออเดอร์; วัด latency สร้างออเดอร์กับแจ้งเตือนแยกกัน
- **A12** ยังไม่เริ่มระบบราคา/เลขออเดอร์จริงจนกว่าจะตรวจ Apps Script ครบ (ตามคำสั่งเจ้าของ)

| # | ใหม่ — ต้องตัดสินใจ | คำแนะนำ |
|---|---|---|
| D13 | ออเดอร์จ่ายหน้างานเข้า Production Summary ก่อนรับเงินได้หรือไม่ | นับเข้าแต่แยกคอลัมน์ "ยังไม่ชำระ" |
| D14 | "ส่งร้านแล้ว" ใน V1 หมายถึงอะไร (ยืนยัน mapping §7.3) | ตรวจกับซอร์ส Apps Script |
| D15 | ช่องทางแจ้งเตือนลูกค้า (email/LINE/คัดลอกข้อความเอง) โดยไม่เพิ่มค่าใช้จ่าย | เริ่มที่ "คิวข้อความให้เจ้าของส่งเอง" |
| D16 | โลโก้ต้นฉบับเป็น PNG 176×160 (≈300 PPI ที่กว้าง 15 มม. ขอบจะหยัก) — มีไฟล์เวกเตอร์ (SVG/PDF) ไหม | ส่งไฟล์เวกเตอร์ แล้วเปลี่ยนเป็นเวกเตอร์ได้ทันที |


## เพิ่ม Phase 02 (2026-11-27)
- **A13** จ่ายหน้างาน = `payment_status: deferred_on_site` (ไม่ถือว่าชำระ); เลิก `payment_timing`; ตัด `customers/counters/round_products` ที่ V1 ไม่มี
- **A14 (D14 ตอบแล้ว)** "ส่งร้านแล้ว" = ตัดยอดรอบส่งโรงงาน/ร้าน → `confirmed` + `in_production`; แปลงสถานะ V1↔V2 ไม่สูญเสีย (มีเทส)
- **A15** ซอร์ส V1 ไม่ลง repo; ใช้ golden vectors (input/output สมมติ) + differential test กับซอร์สในเครื่อง (`NORX_V1_SOURCE`) + `scripts/v1-verify-source.mjs`
- **A16** แจ้งเตือน = outbox + Cron + retry/backoff/dead-letter/failure log; provider เป็น webhook ทั่วไป (ไม่ผูกบริการเสียเงิน) — D15 ยังเปิดอยู่เรื่องช่องทางจริง
- **A17** Admin refresh = pulse token + ไม่แทนที่ UI ขณะโต้ตอบ
- **A18** รหัสรอบคง `ROUND-NNN`; รอบรายสัปดาห์สร้างซ้ำไม่ได้ (`successor_of UNIQUE`)
- **A19** ไม่พอร์ต "เจ้าของสั่งในโหมดทดสอบโดยไม่ต้องใช้ key" ของ V1

| # | ใหม่ — ต้องตัดสินใจ | คำแนะนำ |
|---|---|---|
| D17 | ต้องมีอีเมลแจ้งเตือนเจ้าของแบบเดิม (เนื้อหา V1: เลขออเดอร์ ชื่อ รายการ ยอด ลิงก์หลังบ้าน) ผ่านช่องทางใด โดยไม่มีค่าใช้จ่าย | เริ่มที่ webhook→บริการที่คุณมีอยู่แล้ว หรือดูในหน้า Admin อย่างเดียว (มี auto-refresh) |
| D18 | ทดสอบ storefront กับ staging ต้องมี origin หน้าร้านชั่วคราว (preview ของ Worker หลักผูก binding production — ดู S2) | สร้างหน้าร้านชุดทดสอบแยก origin ที่ชี้ `NORX_API` ไป staging |
| D19 | ตัวนำเข้า V1: จะส่งออก Sheets เป็น CSV (ลบ PII สำหรับ staging) ได้เมื่อไร | หลัง staging พร้อม |


## เพิ่ม (2026-11-27, หลังรีวิวอิสระ)
- **A20** Payment integrity: ยกเลิก/ย้อนจากชำระแล้ว = void payment (เก็บประวัติ); มี `UNIQUE` บางส่วน "1 confirmed payment ต่อออเดอร์"; ตรวจสอบได้ที่ `/api/admin/integrity` และบนแดชบอร์ด
- **A21** Import = delta sync ด้วย `import_hash` + guard ฝั่ง V2; `safe` ไม่ทับงานฝั่ง V2, `v1-wins` เฉพาะ final sync ตอน freeze; ไม่ลบ orphan
- **A22** แจ้งเตือน at-least-once: บันทึก `provider_called_at` ก่อนเรียก provider; กรณีไม่แน่ใจ = ส่งซ้ำพร้อม idempotency key เดิมและข้อความ "อาจซ้ำ"
- **A23 (D17)** provider อีเมลแบบ native เตรียมไว้หลัง adapter จุดเดียว (`sendViaBinding`) — **ยังไม่ยืนยันกับเอกสาร Cloudflare** (เข้าไม่ได้); ไม่เปิดบริการ/DNS
- **A24 (D18)** staging storefront แยกเดี่ยว (assets-only) ที่ `staging.norxcraftingmovement.com` (ข้อเสนอ); build ล้มเหลวถ้ามีการอ้างถึง production
- **A25 (D19)** fixtures anonymised + `scripts/anonymize-v1-export.mjs`
- **A26** เมนู Admin ชุดเดียว 8 รายการ (ภาพรวม ออเดอร์ การผลิต จัดส่ง สินค้า กิจกรรม สื่อ ตั้งค่า) render ฝั่ง server; Content/Analytics ยังไม่แสดง
| # | ใหม่ | คำแนะนำ |
|---|---|---|
| D20 | อ่านหน้าเอกสาร Email Service ให้ครบ (ให้เพิ่ม host `developers.cloudflare.com` ใน allowlist ของ session หรือวางเนื้อหา) แล้วยืนยัน/แก้ `sendViaBinding` | ทำก่อนเปิดใช้ |
| D21 | Access ครอบทั้ง host staging (แนะนำ) หรือเฉพาะ `/admin*` | ทั้ง host |
| D22 | Overview ต้องแสดง "กิจกรรมที่เปิดรับสมัคร" จริง: ต้องมี read-only endpoint จาก Events Worker (ไม่ผูก EVENTS_DB เข้ากับ Orders Worker) | ทำใน Phase 03b ถ้าต้องการ |


## Staging readiness (2026-11-27)
- **D17 decided:** Cloudflare Email Service via Workers `send_email` binding restricted to the verified owner address. Provider acceptance ≠ inbox delivery. No custom idempotency header assumed.
- **D18 decided:** `staging.norxcraftingmovement.com`; three staging Workers; no production bindings; workers.dev and preview URLs off.
- **D19 decided:** synthetic data only on staging (fixtures, seed, PromptPay ID, bank details).
- **D21 decided:** Access on the entire staging hostname (owner policy + a service-token policy for the smoke test); the public staging Worker additionally enforces the owner check.
- **D22 deferred:** no live Events metrics; Events system untouched (Orders Workers no longer import any Events/Media module: `src/orders-access.mjs`).
- **A27** Ambiguous delivery is bounded: one retry, then `unconfirmed` (owner decides). Normal failures ≤ 5 calls. Outcomes are compare-and-set on `lock_token`.
- **A28** Notification history never stores raw provider errors (codes only).
- **A29** Staging configs are rendered flat from env vars into git-ignored `.staging/`; render/pre-flight refuse production ids; remote D1 writes need `--remote`, a verified id and the environment guard.
- **A30 (payments)** Dynamic PromptPay QR only from a verified PromptPay ID (never a bank account number); QR/slip never marks paid; manual verification retained; bank transaction reference is unique per confirmed payment. See `docs/PAYMENTS.md`.
- **A31** Cut-off after a manual early close is allowed (V1 behaviour) — found by the staging smoke rehearsal; cron drains bursts (6×25 per run).
| # | Open |
|---|---|
| D23 | Owner scans the 1.00 THB preview QR with a banking app (no transfer) before the first real PromptPay use |
| D24 | Sending domain for `NOTIFY_FROM` (may need DNS records) — approval needed |
| D25 | Provide D1 id, rate-limit namespace id, Access AUD, verified owner address (see STAGING_RUNBOOK §3) |


## Final staging review (2026-11-27)
- **A32 (seed)** The runbook SQL (migrate → marker → read-back → guarded seed) is tested exactly as generated, repeated; every seed INSERT is `OR IGNORE`; the marker command never overwrites an environment.
- **A33 (auth)** No service token and no service-identity allow-list. Integration tests use the owner's authenticated session. `verifiedOwner` is unchanged and environment-independent; identity headers are never trusted (tested). Supersedes the service-token part of D21.
- **A34 (rate limit)** Limit stays 10 / 60 s per IP, identical in staging and production (tested). The smoke test paces itself; rate limiting is tested only in its own phase; rate-limited answers in normal phases fail the run.
- **A35 (notifications)** After the first ambiguous outcome at most ONE further automatic attempt regardless of its outcome, then `unconfirmed`. Failure drills never touch account-level destination addresses.
- **A36 (payments)** QR bound to the issuing account; account change needs acknowledgement when unpaid QR orders exist; owner can withdraw outstanding QRs; admin flags old-account QRs.
- **A37 (deployment order)** Access application first → Workers without routes → DNS record + routes → gate → tests. Rollback = remove routes only; nothing deleted.


## Owner decisions — Recovery session (2026-11-27)
- **A38 (hand-over needs full receipt)** ส่งมอบแล้ว is refused while any item of the order has not been received from the shop/factory. Confirmed by the owner. Migration note: V1 orders imported as ส่งร้านแล้ว need their receipts recorded in V2 before they can be marked delivered.
- **A39 (จ่ายหน้างาน)** No hand-over without payment; the money and the shirts change hands at the same moment. The option is used rarely (mainly close acquaintances who order first and pay when they get the shirt). Today's implementation (restored from staging Admin 589b707d) needs two clicks — record the on-site payment, then ส่งมอบแล้ว. **Open:** whether the Admin should offer one combined action ("รับเงินและส่งมอบ", as in V1). Until the owner chooses, the current two-step behaviour stays.
