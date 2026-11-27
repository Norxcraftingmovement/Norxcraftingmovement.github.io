import { $, api, notice, el } from "./common.mjs";
import { startAutoRefresh, trackInteraction, store } from "./autorefresh.mjs";
const baht = (n) => Number(n).toLocaleString("th-TH") + " บาท";
const hhmm = () => new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const PH = { draft: "ฉบับร่าง", scheduled: "ตั้งเวลาเปิด", accepting: "กำลังเปิดรับ", closed: "ปิดรับแล้ว", sent: "ส่งร้านแล้ว" };
let busy = false;
function card(title, big, sub, items, href, cta) {
  const c = el("section", "card"); c.setAttribute("aria-label", title);
  c.append(el("h2", "", title), el("div", "big", String(big)));
  if (sub) c.append(el("p", "muted", sub));
  if (items?.length) { const ul = el("ul", "mini"); for (const t of items) ul.append(el("li", "", t)); c.append(ul); }
  if (href) { const a = el("a", "btn secondary", cta || "เปิด"); a.href = href; c.append(a); }
  return c;
}
async function load({ quiet = false } = {}) {
  if (busy) return; busy = true;
  try {
    const [d, p] = await Promise.all([api("/api/admin/dashboard" + ($("test").checked ? "?includeTest=1" : "")), api("/api/admin/pulse")]);
    const cards = $("cards"); cards.replaceChildren();
    cards.append(
      card("รอตรวจสอบการชำระเงิน", d.awaitingPayment.count, d.awaitingPayment.count ? "ยอดรวม " + baht(d.awaitingPayment.amount) : "ไม่มีรายการค้าง", d.awaitingPayment.oldest.map((o) => o.id + " · " + o.name + " · " + baht(o.total)), "/admin/orders/?status=" + encodeURIComponent("รอโอน"), "ไปตรวจสอบ"),
      card("พร้อมส่งผลิต", d.readyForProduction.pieces + " ตัว", d.readyForProduction.orders + " ออเดอร์ (ชำระแล้ว/จ่ายหน้างาน ที่ยังไม่ตัดยอด)", d.readyForProduction.rounds.map((r) => r.name + " · " + r.pieces + " ตัว"), "/admin/production/", "ดูสรุปการผลิต"),
      card("รอจัดส่ง", d.awaitingShipment.count, d.awaitingHandover.count ? "รอส่งมอบ (นัดรับ/รับที่งาน) " + d.awaitingHandover.count + " ออเดอร์" : "", d.awaitingShipment.orders.map((o) => o.id + " · " + (o.name || "—")), "/admin/shipping/", "ใบจ่าหน้า / จัดส่ง"),
      card("กิจกรรมที่กำลังเปิดรับสมัคร", "—", "ระบบกิจกรรมแยกจากระบบสั่งซื้อ ดูสถานะและรายชื่อได้ใน Events Manager", [], "/admin/events/", "เปิด Events Manager"),
    );
    if (d.round) { const s = d.round.summary; cards.append(card("รอบสั่งซื้อ: " + d.round.name, PH[d.round.phase], "ชำระแล้ว " + s.paidOrders + " · รอโอน " + s.pendingOrders + " · จ่ายหน้างาน " + s.laterOrders + " ออเดอร์ · ยอดรับแล้ว " + baht(s.revenue), [], "/admin/orders/?round=" + d.round.code, "จัดการรอบ")); }
    const al = $("alerts"); al.replaceChildren();
    const n = d.notifications; if (n.failed || n.dead) { const a = el("div", "notice err", "การแจ้งเตือนส่งไม่สำเร็จ " + (n.failed + n.dead) + " รายการ "); const l = el("a", "", "ดูและส่งใหม่"); l.href = "/admin/orders/#notifs"; a.append(l); al.append(a); }
    if (d.integrityViolations) al.append(el("div", "notice err", "พบข้อมูลการชำระเงินไม่สอดคล้อง " + d.integrityViolations + " ออเดอร์ — แจ้งผู้ดูแลระบบ (ดู /api/admin/integrity)"));
    notice($("notice"), ""); $("live").textContent = "อัปเดตล่าสุด " + hhmm() + " · รีเฟรชอัตโนมัติทุก 15 วินาที"; refresher?.setToken(p.token);
  } catch (e) { if (!quiet) notice($("notice"), e.userMessage || "โหลดข้อมูลไม่ได้ (" + (e.code || e.message) + ")", true); }
  busy = false;
}
$("test").checked = store.get("norx-include-test") === "1";
$("test").onchange = () => { store.set("norx-include-test", $("test").checked ? "1" : "0"); load(); };
$("refresh").onclick = () => load(); $("showFresh").onclick = () => load();
const interacting = trackInteraction();
let refresher = null;
await load();
refresher = startAutoRefresh({ pulse: () => api("/api/admin/pulse"), reload: load, interacting, onPending: (v) => { $("fresh").hidden = !v; }, onError: () => { $("live").textContent = "เชื่อมต่อไม่ได้ จะลองใหม่อัตโนมัติ"; } });
