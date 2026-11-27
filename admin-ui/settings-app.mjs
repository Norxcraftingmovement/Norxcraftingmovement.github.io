import { $, api, notice, errText } from "./common.mjs";
import { loadAssets, buildLabel, renderA6 } from "./label-canvas.mjs";
const f = ["brandName", "senderName", "address", "phone"];
const sample = { orderNo: "SAMPLE-0001", recipient: "ทดสอบ นามสมมติ", phone: "0800000000", address: "99/9 หมู่ 9 ถนนทดสอบ ตำบลทดสอบ อำเภอเมืองสมมติ จังหวัดสมมติ 10000", itemCount: 2 };
const read = () => Object.fromEntries(f.map((k) => [k, $(k).value]));
async function preview() {
  const s = read(), c = $("preview"), r = renderA6(buildLabel(sample, f.every((k) => s[k].trim()) ? s : null), 100);
  c.width = r.width; c.height = r.height; c.getContext("2d").drawImage(r, 0, 0);
}
(async () => {
  await loadAssets();
  try { const { sender } = await api("/api/admin/settings/sender"); if (sender) for (const k of f) $(k).value = sender[k] ?? ""; else notice($("notice"), "ยังไม่ได้ตั้งค่าผู้ส่ง — กรอกข้อมูลแล้วกดบันทึกก่อนพิมพ์ใบจ่าหน้า"); } catch (e) { notice($("notice"), errText(e), true); }
  for (const k of f) $(k).addEventListener("input", preview);
  $("form").addEventListener("submit", async (ev) => {
    ev.preventDefault(); $("save").disabled = true;
    try { await api("/api/admin/settings/sender", { method: "PUT", body: read() }); notice($("notice"), "บันทึกข้อมูลผู้ส่งแล้ว"); } catch (e) { notice($("notice"), errText(e), true); }
    $("save").disabled = false;
  });
  preview();
})();

// ---- Storefront & notification settings ----
const sf = ["bankName", "bankAccount", "bankHolder", "chatUrl", "pageUrl", "eventName", "notifyTo"];
const confirmLive = () => confirm("เปิดรับออเดอร์จริงใช่หรือไม่? ลูกค้าจะสั่งและโอนเงินจริงผ่านหน้าร้าน");
(async () => {
  try {
    const { storefront: s } = await api("/api/admin/settings/storefront");
    if (s) { $("bankName").value = s.bank.name; $("bankAccount").value = s.bank.account; $("bankHolder").value = s.bank.holder; $("chatUrl").value = s.chatUrl; $("pageUrl").value = s.pageUrl; $("eventName").value = s.eventName || ""; $("notifyTo").value = s.notifyTo || ""; $("liveEnabled").checked = !!s.liveEnabled; $("rolling").checked = !!s.rolling; $("keyState").textContent = s.testKeySet ? "ตั้งรหัสทดสอบไว้แล้ว" : "ยังไม่ได้ตั้งรหัสทดสอบ"; }
    const n = await api("/api/admin/notifications"); const r = n.readiness; $("ready").textContent = r.ready ? "ช่องทางแจ้งเตือน: พร้อม (" + r.mode + ")" : "ช่องทางแจ้งเตือน: ยังไม่พร้อม — ขาด " + r.missing.join(", ");
  } catch (e) { notice($("notice"), errText(e), true); }
  let wasLive = $("liveEnabled").checked;
  $("storeForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if ($("liveEnabled").checked && !wasLive && !confirmLive()) return;
    $("saveStore").disabled = true;
    try {
      await api("/api/admin/settings/storefront", { method: "PUT", body: { bank: { name: $("bankName").value, account: $("bankAccount").value, holder: $("bankHolder").value }, chatUrl: $("chatUrl").value, pageUrl: $("pageUrl").value, eventName: $("eventName").value, notifyTo: $("notifyTo").value, liveEnabled: $("liveEnabled").checked, rolling: $("rolling").checked, ...($("testKey").value ? { testKey: $("testKey").value } : {}) } });
      wasLive = $("liveEnabled").checked; $("testKey").value = ""; notice($("notice"), "บันทึกการตั้งค่าหน้าร้านแล้ว");
    } catch (e) { notice($("notice"), e.code === "INVALID_STOREFRONT" ? "ข้อมูลไม่ถูกต้อง ตรวจเลขบัญชี ลิงก์ (ต้องเป็น https) อีเมล และรหัสทดสอบ (≥8 ตัว)" : errText(e), true); }
    $("saveStore").disabled = false;
  });
})();

// ---- PromptPay payment settings ----
(async () => {
  const draw = (p) => {
    if (!p) { $("ppState").textContent = "ยังไม่ได้ตั้งค่า — ออเดอร์ใหม่จะแสดงเฉพาะการโอนผ่านเลขบัญชี"; $("ppPreview").hidden = true; return; }
    $("ppType").value = p.idType; $("ppName").value = p.payeeName; $("ppId").value = ""; $("ppId").placeholder = p.idMasked + " (กรอกใหม่เฉพาะเมื่อต้องการเปลี่ยน)";
    $("ppOut").textContent = p.outstandingUnpaid ? "ออเดอร์ที่ยังรอชำระด้วย QR ปัจจุบัน: " + p.outstandingUnpaid + " รายการ — หากเปลี่ยนบัญชีรับเงิน QR เหล่านั้นจะยังชี้ไปบัญชีเดิม ต้องคงตรวจยอดบัญชีเดิมต่อ" : "";
    $("ppRevoke").hidden = !p.outstandingUnpaid;
    $("ppState").textContent = (p.verified ? "เปิดใช้งานแล้ว (ยืนยันเมื่อ " + new Date(p.verifiedAt).toLocaleString("th-TH") + ")" : "ยังไม่ยืนยัน — ยังไม่แสดง QR ให้ลูกค้า") + " · " + p.idTypeLabel + " " + p.idMasked;
    $("ppPreview").src = "/api/admin/settings/payment/preview.svg?" + Date.now(); $("ppPreview").hidden = false;
  };
  try { draw((await api("/api/admin/settings/payment")).payment); } catch (e) { notice($("notice"), errText(e), true); }
  const msg = (e) => e.userMessage || errText(e);
  $("payForm").addEventListener("submit", async (ev) => {
    ev.preventDefault(); $("ppSave").disabled = true;
    try {
      const body = { idType: $("ppType").value, id: $("ppId").value, payeeName: $("ppName").value };
      let r; try { r = await api("/api/admin/settings/payment", { method: "PUT", body }); }
      catch (e) { if (e.userMessage && /ยังรอชำระ/.test(e.userMessage) && confirm(e.userMessage + "\n\nรับทราบและบันทึกต่อหรือไม่?")) r = await api("/api/admin/settings/payment", { method: "PUT", body: { ...body, acknowledgeOutstanding: true } }); else throw e; } draw(r.payment); notice($("notice"), "บันทึกแล้ว — ต้องยืนยันชื่อผู้รับก่อนจึงจะแสดง QR"); } catch (e) { notice($("notice"), msg(e), true); }
    $("ppSave").disabled = false;
  });
  $("ppRevoke").addEventListener("click", async () => {
    if (!confirm("เพิกถอน QR ของทุกออเดอร์ที่ยังไม่ชำระ? ลูกค้าจะเห็นว่า QR ถูกยกเลิกและต้องติดต่อเพจ (ออเดอร์ยังอยู่ในสถานะรอโอน)")) return;
    try { const r = await api("/api/admin/payments/revoke-outstanding", { method: "POST", body: { confirm: true } }); notice($("notice"), "เพิกถอน QR แล้ว " + r.revoked + " รายการ"); draw((await api("/api/admin/settings/payment")).payment); } catch (e) { notice($("notice"), msg(e), true); }
  });
  $("verifyForm").addEventListener("submit", async (ev) => {
    ev.preventDefault(); $("ppVerify").disabled = true;
    try { const r = await api("/api/admin/settings/payment/verify", { method: "POST", body: { confirmName: $("ppConfirm").value } }); draw(r.payment); $("ppConfirm").value = ""; notice($("notice"), "ยืนยันแล้ว — ออเดอร์ใหม่จะแสดง QR"); } catch (e) { notice($("notice"), msg(e), true); }
    $("ppVerify").disabled = false;
  });
})();
