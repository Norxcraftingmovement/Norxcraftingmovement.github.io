import { $, api, notice, el } from "./common.mjs";
import { startAutoRefresh, trackInteraction } from "./autorefresh.mjs";
const TH_PHASE = { draft: "ฉบับร่าง", scheduled: "ตั้งเวลาเปิด", accepting: "กำลังเปิดรับ", closed: "ปิดรับแล้ว", sent: "ส่งร้านแล้ว" };
const BTN = { "ชำระแล้ว": "ยืนยันรับเงิน", "จ่ายหน้างาน": "จ่ายหน้างาน", "รอโอน": "กลับเป็นรอโอน", "ยกเลิก": "ยกเลิก", "ส่งมอบแล้ว": "ส่งมอบแล้ว", "ส่งร้านแล้ว": "ย้อนเป็นส่งร้านแล้ว" };
// A39: an on-site order is paid AT the hand-over — one button records the money (on_site) and the delivery together.
const btnLabel = (o, to) => (o.status === "จ่ายหน้างาน" && to === "ส่งมอบแล้ว" ? "รับเงินและส่งมอบ" : BTN[to] || to);
const CLS = { "รอโอน": "pending", "ชำระแล้ว": "paid", "ส่งร้านแล้ว": "paid", "ส่งมอบแล้ว": "paid", "จ่ายหน้างาน": "later", "ยกเลิก": "cancel" };
const baht = (n) => Number(n).toLocaleString("th-TH") + " บาท";
const hhmm = () => new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
let lastR = null, lastN = [], lastL = { order_creation: { count: 0 }, notification: { count: 0 } };
let rounds = [], orders = [], current = "", busy = false, errs = 0;
const filters = new URLSearchParams(location.search);
const queue = filters.get("queue");
const filteredQueue = ["review", "unpaid", "pickup"].includes(queue);
function orderListUrl() {
  const query = new URLSearchParams();
  if (current) query.set("round", current);
  if (filteredQueue) {
    query.set("queue", queue);
    query.set("includeTest", filters.get("includeTest") === "1" ? "1" : "0");
  }
  return "/api/admin/orders?" + query;
}
const msg = (e) => e.userMessage || (e.code === "USER_ERROR" ? e.message : "เกิดข้อผิดพลาด (" + (e.code || e.message) + ")");

// One reusable confirm dialog; resolves with the typed value (or true) or null when cancelled.
let askExtra = "";
function ask({ title, text, label, label2, validate }) {
  return new Promise((resolve) => {
    $("dlgT").textContent = title; $("dlgP").textContent = text || ""; $("dlgIn").hidden = !label; $("dlgL").textContent = label || ""; $("dlgInput").value = ""; $("dlgIn2").hidden = !label2; $("dlgL2").textContent = label2 || ""; $("dlgInput2").value = ""; notice($("dlgErr"), "");
    const done = (v) => { $("dlgForm").onsubmit = null; $("dlgNo").onclick = null; $("dlg").close(); resolve(v); };
    $("dlgForm").onsubmit = (ev) => { ev.preventDefault(); const v = label ? $("dlgInput").value.trim() : true; const bad = validate && validate(v); if (bad) { notice($("dlgErr"), bad, true); return; } askExtra = label2 ? $("dlgInput2").value.trim() : ""; done(v); };
    $("dlgNo").onclick = () => done(null); $("dlg").onclose = () => resolve(null); $("dlg").showModal();
  });
}

async function load({ quiet = false } = {}) {
  if (busy) return; busy = true;
  try {
    const [r, o, n, l, p] = await Promise.all([api("/api/admin/rounds"), api(orderListUrl()), api("/api/admin/notifications"), api("/api/admin/metrics/latency"), api("/api/admin/pulse")]);
    rounds = r.rounds; orders = o.orders; errs = 0;
    if (!filteredQueue && (!current || !rounds.some((x) => x.id === current))) { current = (rounds.find((x) => x.phase === "accepting") || rounds.at(-1) || {}).id || ""; if (current) orders = (await api(orderListUrl())).orders; }
    draw(n.notifications, l.latency, n.readiness); refresher?.setToken(p.token); $("fresh").hidden = true; $("live").textContent = "อัปเดตล่าสุด " + hhmm() + " · รีเฟรชอัตโนมัติทุก 15 วินาที";
    // A quiet reconciliation must not erase the reason an action was rejected.
    // Explicit refresh or a successful action clears it through the normal load.
    if (!quiet) notice($("notice"), "");
  } catch (e) { errs++; if (!quiet) notice($("notice"), msg(e), true); $("live").textContent = "เชื่อมต่อไม่ได้ จะลองใหม่อัตโนมัติ"; }
  busy = false;
}

function draw(notifs, lat, ready = lastR) {
  lastN = notifs; lastL = lat; lastR = ready;
  $("ready").textContent = ready ? (ready.ready ? "ช่องทางแจ้งเตือน: ตั้งค่าครบ (" + ready.mode + ") · ยังไม่ยืนยันการส่งถึงผู้รับ" : "ช่องทางแจ้งเตือน: ยังไม่พร้อม — " + (ready.missing || []).join(", ")) : "";
  const sel = $("round"); sel.replaceChildren(...rounds.slice().reverse().map((r) => { const o = el("option", "", r.name + " (" + r.id + ") · " + TH_PHASE[r.phase]); o.value = r.id; return o; })); sel.value = current;
  if (filteredQueue) {
    const all = el("option", "", "ทุกรอบ");
    all.value = "";
    sel.prepend(all);
    sel.value = current;
  }
  const r = rounds.find((x) => x.id === current), box = $("roundBox"); box.replaceChildren();
  if (r) {
    const s = r.summary, st = el("div", "stats");
    for (const [k, v] of [["ออเดอร์", s.orders], ["ชำระแล้ว", s.paidOrders], ["รอโอน", s.pendingOrders + " (" + baht(s.pendingAmount) + ")"], ["จ่ายหน้างาน", s.laterOrders + " (ค้าง " + baht(s.laterAmount) + ")"], ["ยอดรับแล้ว", baht(s.revenue)], ["ต้องผลิต (ตัว)", s.pieces]]) { const d = el("div", "stat", k); d.append(el("b", "", String(v))); st.append(d); }
    box.append(el("p", "", "สถานะรอบ: " + TH_PHASE[r.phase]), st);
    const acts = el("div", "acts");
    const add = (t, f, alt = true) => { const b = el("button", alt ? "secondary" : "", t); b.type = "button"; b.onclick = f; acts.append(b); };
    if (r.state === "draft" || r.state === "closed") if (r.phase !== "closed" || r.state === "closed") add("เปิดรับ", () => roundOp(r, "open", "เปิดรับรอบนี้?"));
    if (r.state === "open" && r.phase === "accepting") add("ปิดรับตอนนี้", () => roundOp(r, "close", "ปิดรับรอบนี้ตอนนี้?"));
    if (r.phase === "closed" && s.pendingOrders) add("ยกเลิกออเดอร์ที่ไม่โอน (" + s.pendingOrders + ")", () => roundOp(r, "cancel-unpaid", "ยกเลิกออเดอร์รอโอน " + s.pendingOrders + " รายการ?", { expected: s.pendingOrders }));
    if (r.phase === "closed" && s.pieces) add("ตัดยอดส่งร้าน (" + s.pieces + " ตัว)", () => roundOp(r, "send-to-shop", "ตัดยอดส่งร้าน " + s.pieces + " ตัว? หลังจากนี้เปลี่ยนสถานะรอโอน/ชำระ/ยกเลิกไม่ได้", { expectedPieces: s.pieces }), false);
    if (s.pieces) { add("คัดลอกข้อความส่งร้าน", async () => { try { await navigator.clipboard.writeText(r.shopText); notice($("notice"), "คัดลอกแล้ว"); } catch { notice($("notice"), "คัดลอกไม่ได้ เลือกข้อความด้านล่างเอง", true); } }); }
    box.append(acts); if (s.pieces) box.append(el("pre", "shop", r.shopText));
  }
  const q = $("q").value.trim().toLowerCase(), f = $("status").value, ul = $("orders"); ul.replaceChildren();
  const shown = orders.filter((o) => (!f || o.status === f) && (!q || (o.id + " " + o.name + " " + o.phone).toLowerCase().includes(q)));
  if (!shown.length) ul.append(el("li", "muted", "ไม่พบออเดอร์"));
  for (const o of shown) {
    const li = el("li"), g = el("div", "grow"), t = el("strong", "", o.id); const b = el("span", "badge " + (CLS[o.status] || ""), o.status);
    g.append(t, b); if (o.isTest) g.append(el("span", "tag", "ทดสอบ")); if (o.payment?.legacyPayee && o.status === "รอโอน") g.append(el("span", "tag", "QR บัญชีเดิม"));
    g.append(el("br"), document.createTextNode(o.name + " · " + o.phone + " · " + ({ city: "นัดรับในเมือง", event: "รับที่งาน", ship: "จัดส่ง" }[o.delivery])), el("br"),
      el("small", "muted", o.items.map((i) => i.name + " " + (i.sleeve === "short" ? "แขนสั้น" : "แขนยาว") + " " + i.size + "×" + i.qty).join(", ")), el("br"), el("b", "", baht(o.total) + (o.shipping ? " (รวมส่ง " + baht(o.shipping) + ")" : "")));
    const acts = el("div", "acts");
    for (const to of o.moves) {
      if (queue === "pickup" && to !== "ส่งมอบแล้ว") continue; // pickup queue: one hand-over button (paid, or รับเงินและส่งมอบ)
      const bt = el("button", "secondary small", btnLabel(o, to)); bt.type = "button"; bt.onclick = () => move(o, to); acts.append(bt);
    }
    g.append(acts); li.append(g); ul.append(li);
  }
  $("nsum").textContent = notifs.length ? notifs.length + " รายการ (รอส่ง/ล้มเหลว) · ส่งอัตโนมัติและลองใหม่เมื่อล้มเหลว" : "ไม่มีรายการค้าง";
  const nl = $("notifs"); nl.replaceChildren();
  const NS = { queued: "รอส่ง", sending: "กำลังส่ง", failed: "ส่งไม่สำเร็จ (จะลองใหม่)", dead: "ส่งไม่สำเร็จ (ครบจำนวนครั้ง)", unconfirmed: "ยืนยันผลการส่งไม่ได้ (หยุดส่งอัตโนมัติ)" };
  for (const n of notifs) { const li = el("li"), g = el("div", "grow"); g.append(el("strong", "", n.orderNo || "-"), el("span", "badge" + (n.status === "dead" || n.status === "unconfirmed" ? " cancel" : ""), NS[n.status] || n.status), el("br"), el("small", "muted", "ลองแล้ว " + n.attempts + "/" + n.maxAttempts + (n.possibleDuplicate ? " · อาจส่งซ้ำ" : "") + (n.lastErrorCode ? " · รหัส: " + n.lastErrorCode : "")));
    const post = (path) => async () => { try { await api("/api/admin/notifications/" + n.id + path, { method: "POST", body: {} }); await load(); } catch (e) { notice($("notice"), msg(e), true); } };
    if (["failed", "dead", "unconfirmed"].includes(n.status)) { const b = el("button", "secondary small", "ส่งใหม่"); b.type = "button"; b.onclick = post("/retry"); g.append(el("br"), b); }
    if (["dead", "unconfirmed"].includes(n.status)) { const b = el("button", "secondary small", "ยืนยันว่าได้รับแล้ว"); b.type = "button"; b.onclick = post("/received"); g.append(b); }
    li.append(g); nl.append(li); }
  const f2 = (k) => (lat[k].count ? "p50 " + lat[k].p50 + " ms · p95 " + lat[k].p95 + " ms (" + lat[k].count + " ครั้ง)" : "ยังไม่มีข้อมูล");
  $("lat").textContent = "สร้างออเดอร์: " + f2("order_creation") + "  |  ส่งแจ้งเตือน: " + f2("notification");
}

async function move(o, to) {
  let amount;
  if ((to === "ชำระแล้ว" || to === "ส่งมอบแล้ว") && o.status !== "ส่งร้านแล้ว") {
    amount = await ask({ title: btnLabel(o, to) + " " + o.id, text: "ยอดที่ต้องได้รับ " + baht(o.total) + " — พิมพ์ยอดที่ได้รับจริงเพื่อยืนยัน" + (o.payment?.legacyPayee ? "  ⚠ QR ของออเดอร์นี้ออกให้บัญชีผู้รับเดิม (" + (o.payment.payeeMasked || "") + " · " + (o.payment.payeeName || "") + ") — ตรวจเงินเข้าบัญชีนั้น ไม่ใช่บัญชีปัจจุบัน" : ""), label: "ยอดที่ได้รับ (บาท)", label2: to === "ชำระแล้ว" ? "เลขอ้างอิงรายการโอนจากรายการเดินบัญชี (ไม่บังคับ — ใช้กันยืนยันซ้ำ)" : "", validate: (v) => (Number(v) === o.total ? "" : "ยอดไม่ตรงกับยอดออเดอร์") });
    if (amount === null) return; amount = Number(amount);
  } else if (!(await ask({ title: btnLabel(o, to) + " " + o.id + "?", text: o.status + " → " + to }))) return;
  try { await api("/api/admin/orders/" + encodeURIComponent(o.id) + "/status", { method: "POST", body: { from: o.status, to, amount, ...(askExtra ? { bankTxnRef: askExtra } : {}) } }); await load(); } catch (e) { notice($("notice"), msg(e), true); await load({ quiet: true }); }
}
async function roundOp(r, op, text, body = {}) {
  if (!(await ask({ title: r.name, text }))) return;
  try { await api("/api/admin/rounds/" + r.id + "/" + op, { method: "POST", body }); await load(); } catch (e) { notice($("notice"), msg(e), true); await load({ quiet: true }); }
}

// ---- Auto refresh (shared module): cheap pulse every 15 s while visible; never replaces the UI mid-interaction ----
const interacting = trackInteraction(() => $("dlg").open || document.activeElement === $("q"));
let refresher = null;
$("refresh").onclick = () => load(); $("showFresh").onclick = () => load();
$("round").onchange = async () => { current = $("round").value; await load(); };
$("q").oninput = () => draw(lastN, lastL); $("status").onchange = () => draw(lastN, lastL);
$("csv").onclick = () => { location.href = "/api/admin/orders/export.csv?" + new URLSearchParams({ round: current, status: $("status").value }); };
if (!filteredQueue && filters.get("status")) $("status").value = filters.get("status");
if (filters.get("round")) current = filters.get("round");
if (filteredQueue) {
  $("reviewQueue").hidden = false;
  $("reviewQueueText").textContent = { review: "เฉพาะออเดอร์ที่ส่งหลักฐานแล้ว", unpaid: "ออเดอร์ที่ยังไม่ได้ยืนยันการชำระ", pickup: "เฉพาะออเดอร์ที่ของครบและรอลูกค้ามารับ" }[queue];
  $("status").hidden = true;
  $("csv").hidden = true;
}
refresher = startAutoRefresh({ pulse: () => api("/api/admin/pulse"), reload: load, interacting, onPending: (v) => { $("fresh").hidden = !v; }, onError: () => { $("live").textContent = "เชื่อมต่อไม่ได้ จะลองใหม่อัตโนมัติ"; } });
await load();
