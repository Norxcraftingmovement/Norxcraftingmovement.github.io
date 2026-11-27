import { $, api, notice, el } from "./common.mjs";
import { startAutoRefresh, trackInteraction, store } from "./autorefresh.mjs";

const PHASE = { draft: "ฉบับร่าง", scheduled: "ตั้งเวลาเปิด", accepting: "เปิดรับ", closed: "ปิดรับแล้ว", sent: "ส่งร้านแล้ว" };
const dateTime = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const time = new Intl.DateTimeFormat("th-TH", { timeStyle: "medium", timeZone: "Asia/Bangkok" });
const number = new Intl.NumberFormat("th-TH");
let busy = false;
let refresher;

function link(label, url, style = "dashboard-link") {
  const a = el("a", style, label);
  a.href = url;
  return a;
}

function roundPanel(title, theme = "") {
  const panel = el("section", "dashboard-round " + theme);
  panel.append(el("h2", "", title));
  return panel;
}

function renderRounds(round, production, scope) {
  const sales = roundPanel("รอบรับออเดอร์", "dashboard-sales");
  if (round) {
    const status = el("span", "dashboard-status", PHASE[round.phase]);
    status.dataset.phase = round.phase;
    sales.append(status, el("p", "dashboard-round-name", round.name));
    if (round.phase === "scheduled") sales.append(el("p", "muted", "เปิดรับ " + dateTime.format(new Date(round.opensAt))));
    if (round.phase === "accepting" || round.phase === "scheduled") {
      sales.append(el("p", "muted", "ปิดรับ " + dateTime.format(new Date(round.closesAt))));
    }
    if (round.paymentDue && round.phase !== "sent") sales.append(el("p", "muted", "ชำระภายใน " + dateTime.format(new Date(round.paymentDue))));
    sales.append(link("จัดการรอบ", "/admin/orders/?" + new URLSearchParams({ round: round.code })));
  } else {
    sales.append(el("p", "muted", "ยังไม่มีรอบรับออเดอร์"));
  }

  const batch = roundPanel("รอบที่พร้อมส่งร้าน");
  if (production.length) {
    const list = el("ul", "dashboard-round-list");
    for (const r of production) {
      const item = el("li");
      item.append(link(r.name + " · " + number.format(r.pieces) + " ตัว", "/admin/production/?" + new URLSearchParams({ round: r.code, ...scope })));
      list.append(item);
    }
    batch.append(list);
  } else {
    batch.append(el("p", "muted", "ยังไม่มีรอบที่ปิดรับและพร้อมส่งยอด"));
  }
  $("rounds").replaceChildren(sales, batch);
}

function queueCard(title, count, unit, detail, href, label) {
  const section = el("section", "dashboard-queue");
  section.dataset.hasWork = String(count > 0);
  const card = href ? link("", href, "dashboard-queue-content") : el("div", "dashboard-queue-content");
  const metric = el("p", "dashboard-count");
  metric.append(el("strong", "", number.format(count)), el("span", "", unit));
  card.append(el("h3", "", title), metric);
  if (detail) card.append(el("p", "dashboard-detail", detail));
  if (href) {
    const action = el("span", "dashboard-action", label);
    const arrow = el("span", "dashboard-arrow", "↗");
    arrow.setAttribute("aria-hidden", "true");
    action.append(arrow);
    card.append(action);
  }
  section.append(card);
  return section;
}

function renderDashboard(d, includeTest) {
  const scope = { includeTest: includeTest ? "1" : "0" };
  const { paymentReview, production, readyToShip, readyToPickUp } = d.work;
  const pieces = production.reduce((total, r) => total + r.pieces, 0);
  const pending = d.awaitingPayment.count - paymentReview;
  const unpaidUrl = "/admin/orders/?" + new URLSearchParams({ queue: "unpaid", ...scope });
  const reviewUrl = "/admin/orders/?" + new URLSearchParams({ queue: "review", ...scope });
  const productionUrl = production.length === 1 ? "/admin/production/?" + new URLSearchParams({ round: production[0].code, ...scope }) : "";
  const shipmentUrl = "/admin/shipping/?" + new URLSearchParams({ queue: "ready", ...scope });
  renderRounds(d.round, production, scope);
  $("cards").replaceChildren(
    paymentReview
      ? queueCard("ตรวจชำระ", paymentReview, "รายการ", "ออเดอร์ที่ส่งหลักฐานแล้ว", reviewUrl, "เปิดคิวตรวจชำระ")
      : queueCard("รอโอน", pending, "รายการ", "ยังไม่มีหลักฐานชำระในระบบ", unpaidUrl, "ดูออเดอร์รอโอน"),
    queueCard("ตรวจยอดก่อนส่งร้าน", pieces, "ตัว", pieces ? "จาก " + number.format(production.length) + " รอบที่ปิดรับ" : "ยังไม่มียอดพร้อมส่งร้าน", productionUrl || (pieces ? "#rounds" : ""), productionUrl ? "ดูยอดแยกไซส์" : "เลือกรอบที่พร้อมส่งร้าน"),
    queueCard("เตรียมจัดส่ง", readyToShip, "พัสดุ", readyToShip ? "มีที่อยู่จัดส่งและพร้อมดำเนินการ" : "ยังไม่มีพัสดุพร้อมส่ง", shipmentUrl, "เปิดคิวจัดส่ง"),
    queueCard("รอลูกค้ามารับ", readyToPickUp, "ออเดอร์", "นัดรับในเมืองหรือรับที่งาน", "/admin/orders/?" + new URLSearchParams({ queue: "pickup", ...scope }), "เปิดคิวนัดรับ"),
  );
  const alerts = $("alerts");
  alerts.replaceChildren();
  if (paymentReview && pending) {
    const item = el("li");
    item.append(el("span", "", "ลูกค้ายังรอโอน " + number.format(pending) + " รายการ · "), link("ดูรายการที่ยังไม่ยืนยันทั้งหมด", unpaidUrl));
    alerts.append(item);
  }
  if (d.notifications.needsAttention) {
    const item = el("li");
    item.append(link("ตรวจการแจ้งเตือน " + number.format(d.notifications.needsAttention) + " รายการ", "/admin/orders/#notifs"));
    alerts.append(item);
  }
  if (d.integrityViolations) alerts.append(el("li", "notice err", "ข้อมูลการชำระไม่สอดคล้อง " + number.format(d.integrityViolations) + " ออเดอร์ · แจ้งผู้ดูแลระบบ"));
  $("follow-up").hidden = !alerts.childElementCount;
  $("dashboard").hidden = false;
}

async function load({ quiet = false } = {}) {
  if (busy) return;
  busy = true;
  const includeTest = $("test").checked;
  try {
    const [d, pulse] = await Promise.all([api("/api/admin/dashboard" + (includeTest ? "?includeTest=1" : "")), api("/api/admin/pulse")]);
    if ($("test").checked !== includeTest) return;
    renderDashboard(d, includeTest);
    notice($("notice"), "");
    $("fresh").hidden = true;
    $("live").textContent = "อัปเดตล่าสุด " + time.format(new Date());
    refresher?.setToken(pulse.token);
  } catch (error) {
    if (!quiet) notice($("notice"), error.userMessage || "โหลดข้อมูลไม่ได้ (" + (error.code || error.message) + ")", true);
  } finally {
    busy = false;
    if ($("test").checked !== includeTest) void load();
  }
}

$("test").checked = store.get("norx-include-test") === "1";
$("test").onchange = () => {
  store.set("norx-include-test", $("test").checked ? "1" : "0");
  load();
};
$("refresh").onclick = () => load();
$("showFresh").onclick = () => load();
refresher = startAutoRefresh({
  pulse: () => api("/api/admin/pulse"),
  reload: load,
  interacting: trackInteraction(() => $("dashboard").contains(document.activeElement)),
  onPending: (value) => { $("fresh").hidden = !value; },
  onError: () => { $("live").textContent = "เชื่อมต่อไม่ได้ จะลองใหม่อัตโนมัติ"; },
});
await load();
