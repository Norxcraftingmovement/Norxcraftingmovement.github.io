import { $, api, notice, el, errText } from "./common.mjs";
import { loadAssets, buildLabel, renderA6, renderA4Sheets, canvasToPng, canvasesToPdf, download, printCanvases } from "./label-canvas.mjs";
import { SIZES } from "./label-layout.mjs";
import { canonicalCarrier, checkTracking } from "./carriers.mjs";
// A format warning never blocks: the first submit shows it, a second submit of the SAME values goes through.
let acknowledged = "";
const needsAck = (key, warnings) => { if (!warnings.length || acknowledged === key) return false; acknowledged = key; return true; };

const sel = new Set(); let orders = [], data = new Map(), sender = null, lastPrintIds = [], timer;
const fmt = () => document.querySelector('input[name="fmt"]:checked').value;
const ids = () => orders.map((o) => o.id).filter((i) => sel.has(i));
const readyForBatch = (o) => o.fulfillmentStatus === "ready_ship" && o.paymentStatus === "confirmed" && !o.shippedAt;
const filters = new URLSearchParams(location.search);
if (filters.get("queue") === "ready") $("readyQueue").hidden = false;

async function loadOrders() {
  const p = new URLSearchParams({ q: $("q").value, printed: $("printed").value });
  if (filters.get("queue") === "ready") {
    p.set("queue", "ready");
    p.set("includeTest", filters.get("includeTest") === "1" ? "1" : "0");
  }
  try { orders = (await api("/api/admin/labels/orders?" + p)).orders; } catch (e) { notice($("notice"), errText(e), true); return; }
  for (const i of [...sel]) if (!orders.some((o) => o.id === i)) sel.delete(i);
  const ul = $("list"); ul.replaceChildren();
  if (!orders.length) ul.append(el("li", "muted", "ไม่พบออเดอร์ที่ต้องจัดส่ง"));
  for (const o of orders) {
    const li = el("li"), cb = el("input"); cb.type = "checkbox"; cb.checked = sel.has(o.id); cb.id = "o" + o.id;
    cb.addEventListener("change", () => { cb.checked ? sel.add(o.id) : sel.delete(o.id); changed(); });
    const lab = el("label", "grow"); lab.htmlFor = cb.id;
    const t = el("strong", "", o.orderNo); if (o.isTest) t.append(el("span", "tag", "ทดสอบ")); if (o.printedCount) t.append(el("span", "tag", "พิมพ์แล้ว ×" + o.printedCount));
    // The unfiltered list shows every shipping order (labels can be prepared early); the tag keeps unpaid / not-yet-received ones from being mistaken for "ready to ship".
    if (o.paymentStatus !== "confirmed") t.append(el("span", "tag", "ยังไม่ชำระ")); else if (["received", "in_production", "qc"].includes(o.fulfillmentStatus)) t.append(el("span", "tag", "รอรับของจากโรงงาน"));
    lab.append(t, el("br"), document.createTextNode(o.recipient), el("br"), el("small", "muted", [o.provider, o.trackingNo].filter(Boolean).join(" ") || "ยังไม่มีเลขพัสดุ"));
    li.append(cb, lab); ul.append(li);
  }
  changed();
}

async function fetchLabels(version) {
  const want = ids().filter((i) => !data.has(i));
  if (want.length) {
    const r = await api("/api/admin/labels/data", { method: "POST", body: { ids: want } });
    if (version !== selectionVersion) return [];
    sender = r.sender;
    for (const l of r.labels) data.set(l.id, l);
  } else if (!sender) {
    const r = await api("/api/admin/settings/sender");
    if (version !== selectionVersion) return [];
    sender = r.sender;
  }
  return ids().map((i) => data.get(i)).filter(Boolean);
}

let layouts = [], selectionVersion = 0;
async function refresh() {
  const version = selectionVersion;
  $("count").textContent = "เลือก " + sel.size + " รายการ";
  const has = sel.size > 0; $("slotRow").hidden = fmt() !== "A4";
  const selected = orders.filter((o) => sel.has(o.id));
  $("selectionHint").textContent = !selected.length ? "เลือกออเดอร์เพื่อดูตัวอย่างใบจ่าหน้า" : selected.length > 50 ? "เลือกได้สูงสุด 50 ออเดอร์ต่อการบันทึกจัดส่งหนึ่งครั้ง" : !selected.every(readyForBatch) ? "เตรียมใบจ่าหน้าได้ แต่ยังบันทึกส่งไม่ได้: ต้องชำระแล้ว รับสินค้าครบ และยังไม่ส่ง" : selected.length > 1 ? "พร้อมจัดส่ง " + selected.length + " ออเดอร์ · แก้ที่อยู่หรือกรอกเลขพัสดุแยกทีละออเดอร์ได้" : "พร้อมจัดส่ง · ตรวจที่อยู่และใบจ่าหน้าก่อนพิมพ์";
  const c = $("preview"); c.getContext("2d").clearRect(0, 0, c.width, c.height);
  if (!has) { layouts = []; for (const b of ["png", "pdf", "print"]) $(b).disabled = true; notice($("warn"), ""); return; }
  let labels; try { labels = await fetchLabels(version); } catch (e) { if (version === selectionVersion) notice($("notice"), errText(e), true); return; }
  if (version !== selectionVersion) return;
  layouts = labels.map((l) => buildLabel(l, sender));
  const problems = [];
  if (!sender) problems.push("ยังไม่ได้ตั้งค่าผู้ส่ง — ไปที่ “ตั้งค่า” ก่อนพิมพ์");
  layouts.forEach((l, i) => { if (l.warnings.some((w) => w !== "SENDER_MISSING")) problems.push(labels[i].orderNo + ": ข้อความยาวเกินพื้นที่ (" + l.warnings.filter((w) => w !== "SENDER_MISSING").join(", ") + ") แก้ที่อยู่ให้สั้นลงก่อน"); });
  notice($("warn"), problems.join("\n"), true);
  for (const b of ["png", "pdf", "print"]) $(b).disabled = problems.length > 0;
  for (const b of ["edit", "ship"]) $(b).disabled = sel.size !== 1;
  $("shipBatch").disabled = !selected.length || selected.length > 50 || !selected.every(readyForBatch);
  const ppi = 110, prev = fmt() === "A4" ? renderA4Sheets(layouts, ppi, { startSlot: +$("slot").value })[0] : renderA6(layouts[0], ppi);
  c.width = prev.width; c.height = prev.height; c.getContext("2d").drawImage(prev, 0, 0);
}
const changed = () => {
  selectionVersion++;
  for (const b of ["edit", "ship", "shipBatch", "png", "pdf", "print"]) $(b).disabled = true;
  clearTimeout(timer); timer = setTimeout(refresh, 80);
};

const pages = () => fmt() === "A4" ? { canv: renderA4Sheets(layouts, 300, { startSlot: +$("slot").value }), ...SIZES.A4, name: "A4" } : { canv: layouts.map((l) => renderA6(l, 300)), ...SIZES.A6, name: "A6" };
const stamp = () => new Date().toISOString().slice(0, 10);

$("png").addEventListener("click", async () => {
  const p = pages(), labels = ids().map((i) => data.get(i));
  for (const [i, c] of p.canv.entries()) download(await canvasToPng(c, 300), p.name === "A6" ? `NORX-label-${labels[i].orderNo}.png` : `NORX-A4-${stamp()}-${i + 1}.png`, "image/png");
});
$("pdf").addEventListener("click", async () => { const p = pages(); download(await canvasesToPdf(p.canv, p.w, p.h), `NORX-labels-${p.name}-${stamp()}.pdf`, "application/pdf"); });
$("print").addEventListener("click", async () => { const p = pages(); lastPrintIds = ids(); await printCanvases(p.canv, p.w, p.h); $("afterPrint").hidden = false; });
$("markPrinted").addEventListener("click", async () => {
  try { await api("/api/admin/labels/printed", { method: "POST", body: { ids: lastPrintIds } }); $("afterPrint").hidden = true; for (const i of lastPrintIds) data.delete(i); await loadOrders(); notice($("notice"), "บันทึกว่าพิมพ์แล้ว (สถานะออเดอร์ไม่เปลี่ยน)"); } catch (e) { notice($("notice"), errText(e), true); }
});
$("dismissPrint").addEventListener("click", () => { $("afterPrint").hidden = true; });

// Edit address
$("edit").addEventListener("click", () => { const l = data.get(ids()[0]); $("addrOrder").textContent = l.orderNo; $("aName").value = l.recipient; $("aPhone").value = l.phone; $("aAddr").value = l.address; notice($("aErr"), ""); $("addrDlg").showModal(); });
$("aCancel").addEventListener("click", () => $("addrDlg").close());
$("addrForm").addEventListener("submit", async (ev) => {
  ev.preventDefault(); const id = ids()[0];
  try { await api(`/api/admin/orders/${id}/address`, { method: "PUT", body: { recipient: $("aName").value, phone: $("aPhone").value, address: $("aAddr").value } }); data.delete(id); $("addrDlg").close(); await loadOrders(); } catch (e) { notice($("aErr"), errText(e), true); }
});
// Shipment details (does not change order status)
$("ship").addEventListener("click", () => { const o = orders.find((x) => x.id === ids()[0]); $("shipOrder").textContent = o.orderNo; $("sProv").value = o.provider ?? ""; $("sTrack").value = o.trackingNo ?? ""; notice($("sErr"), ""); $("shipDlg").showModal(); });
$("sCancel").addEventListener("click", () => $("shipDlg").close());
$("shipForm").addEventListener("submit", async (ev) => {
  ev.preventDefault(); const id = ids()[0];
  const provider = canonicalCarrier($("sProv").value), trackingNo = $("sTrack").value.trim().toUpperCase();
  $("sProv").value = provider; $("sTrack").value = trackingNo;
  const check = checkTracking(provider, trackingNo);
  if (needsAck(["one", id, provider, trackingNo].join("|"), check.warnings)) { notice($("sErr"), "⚠ " + check.warnings[0] + " — ตรวจกับฉลากอีกครั้ง ถ้าถูกต้องแล้วกด \"บันทึก\" อีกครั้งเพื่อยืนยัน", true); return; }
  // No date here (R5): "shipped" is only recorded by the batch save.
  try { await api(`/api/admin/orders/${id}/shipment`, { method: "PUT", body: { provider, trackingNo } }); data.delete(id); $("shipDlg").close(); await loadOrders(); } catch (e) { notice($("sErr"), errText(e), true); }
});

let batchInputs = new Map();
$("shipBatch").onclick = () => {
  batchInputs = new Map();
  $("batchRows").replaceChildren(...orders.filter(o => sel.has(o.id)).map((order) => {
    const row = el("tr"), td = el("td"), input = el("input");
    input.required = true;
    input.maxLength = 40;
    input.pattern = "[A-Za-z0-9\\-]+";
    input.setAttribute("aria-label", "เลขพัสดุ " + order.orderNo);
    input.value = order.trackingNo || "";
    batchInputs.set(order.orderNo, input);
    td.append(input);
    row.append(el("th", "", order.orderNo), el("td", "", order.recipient || ""), td);
    return row;
  }));
  $("batchPaste").value = "";
  $("batchDate").value = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date());
  notice($("batchError"), "");
  $("batchDialog").showModal();
};
$("applyTracking").onclick = () => {
  const pairs = new Map();
  for (const [i, line] of $("batchPaste").value.trim().split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const [order, number, extra] = line.trim().split(/[\t,]/).map(value => value.trim());
    if (extra !== undefined || !batchInputs.has(order) || pairs.has(order) || !/^[A-Za-z0-9-]{1,40}$/.test(number ?? "")) {
      notice($("batchError"), "ตรวจแถวที่ " + (i + 1) + " ให้เป็นเลขออเดอร์ที่เลือกกับเลขพัสดุ และอย่าใส่ออเดอร์ซ้ำ", true);
      return;
    }
    pairs.set(order, number);
  }
  for (const [order, number] of pairs) batchInputs.get(order).value = number;
  notice($("batchError"), "");
};
$("batchClose").onclick = () => $("batchDialog").close();
$("batchForm").onsubmit = async (event) => {
  event.preventDefault();
  const provider = canonicalCarrier($("batchCarrier").value);
  $("batchCarrier").value = provider;
  const rows = [...batchInputs].map(([orderNo, field]) => ({ orderNo, trackingNo: field.value.trim().toUpperCase(), provider }));
  for (const [i, field] of [...batchInputs.values()].entries()) field.value = rows[i].trackingNo;
  const flagged = rows.map((r) => ({ r, c: checkTracking(provider, r.trackingNo) })).filter((x) => !x.c.ok);
  if (needsAck(["batch", provider, ...rows.map((r) => r.orderNo + "=" + r.trackingNo)].join("|"), flagged)) {
    notice($("batchError"), "⚠ เลขพัสดุที่ผิดรูปแบบ: " + flagged.map(({ r, c }) => r.orderNo + " (" + r.trackingNo + ") — " + c.warnings[0]).join(" · ") + " — ตรวจกับกล่อง/ฉลากอีกครั้ง ถ้าถูกต้องแล้วกดบันทึกอีกครั้งเพื่อยืนยัน", true);
    return;
  }
  $("batchSave").disabled = true;
  try {
    const result = await api("/api/admin/shipments/batch", { method: "POST", body: { rows, shippedAt: $("batchDate").value } });
    $("batchDialog").close();
    for (const id of sel) data.delete(id);
    sel.clear();
    await loadOrders();
    notice($("notice"), "บันทึกจัดส่งแล้ว " + result.shipped + " รายการ");
  } catch (error) { notice($("batchError"), error.userMessage || errText(error), true); }
  finally { $("batchSave").disabled = false; }
};

$("all").addEventListener("click", () => { for (const o of orders) sel.add(o.id); for (const cb of $("list").querySelectorAll("input")) cb.checked = true; changed(); });
$("none").addEventListener("click", () => { sel.clear(); for (const cb of $("list").querySelectorAll("input")) cb.checked = false; changed(); });
$("q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(loadOrders, 250); });
$("printed").addEventListener("change", loadOrders);
for (const r of document.querySelectorAll('input[name="fmt"]')) r.addEventListener("change", changed);
$("slot").addEventListener("change", changed);
(async () => { await loadAssets(); await loadOrders(); })().catch((e) => notice($("notice"), errText(e), true));
