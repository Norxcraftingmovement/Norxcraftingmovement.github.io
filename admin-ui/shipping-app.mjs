import { $, api, notice, el, errText } from "./common.mjs";
import { loadAssets, buildLabel, renderA6, renderA4Sheets, canvasToPng, canvasesToPdf, download, printCanvases } from "./label-canvas.mjs";
import { SIZES } from "./label-layout.mjs";

const sel = new Set(); let orders = [], data = new Map(), sender = null, lastPrintIds = [], timer;
const fmt = () => document.querySelector('input[name="fmt"]:checked').value;
const ids = () => orders.map((o) => o.id).filter((i) => sel.has(i));

async function loadOrders() {
  const p = new URLSearchParams({ q: $("q").value, printed: $("printed").value });
  try { orders = (await api("/api/admin/labels/orders?" + p)).orders; } catch (e) { notice($("notice"), errText(e), true); return; }
  for (const i of [...sel]) if (!orders.some((o) => o.id === i)) sel.delete(i);
  const ul = $("list"); ul.replaceChildren();
  if (!orders.length) ul.append(el("li", "muted", "ไม่พบออเดอร์ที่ต้องจัดส่ง"));
  for (const o of orders) {
    const li = el("li"), cb = el("input"); cb.type = "checkbox"; cb.checked = sel.has(o.id); cb.id = "o" + o.id;
    cb.addEventListener("change", () => { cb.checked ? sel.add(o.id) : sel.delete(o.id); changed(); });
    const lab = el("label", "grow"); lab.htmlFor = cb.id;
    const t = el("strong", "", o.orderNo); if (o.isTest) t.append(el("span", "tag", "ทดสอบ")); if (o.printedCount) t.append(el("span", "tag", "พิมพ์แล้ว ×" + o.printedCount));
    lab.append(t, el("br"), document.createTextNode(o.recipient), el("br"), el("small", "muted", [o.provider, o.trackingNo].filter(Boolean).join(" ") || "ยังไม่มีเลขพัสดุ"));
    li.append(cb, lab); ul.append(li);
  }
  changed();
}

async function fetchLabels() {
  const want = ids().filter((i) => !data.has(i));
  if (want.length) {
    const r = await api("/api/admin/labels/data", { method: "POST", body: { ids: want } }); sender = r.sender;
    for (const l of r.labels) data.set(l.id, l);
  } else if (!sender) sender = (await api("/api/admin/settings/sender")).sender;
  return ids().map((i) => data.get(i)).filter(Boolean);
}

let layouts = [];
async function refresh() {
  $("count").textContent = "เลือก " + sel.size + " รายการ";
  const has = sel.size > 0; $("slotRow").hidden = fmt() !== "A4";
  for (const b of ["edit", "ship"]) $(b).disabled = sel.size !== 1;
  const c = $("preview"); c.getContext("2d").clearRect(0, 0, c.width, c.height);
  if (!has) { layouts = []; for (const b of ["png", "pdf", "print"]) $(b).disabled = true; notice($("warn"), ""); return; }
  let labels; try { labels = await fetchLabels(); } catch (e) { notice($("notice"), errText(e), true); return; }
  layouts = labels.map((l) => buildLabel(l, sender));
  const problems = [];
  if (!sender) problems.push("ยังไม่ได้ตั้งค่าผู้ส่ง — ไปที่ “ตั้งค่า” ก่อนพิมพ์");
  layouts.forEach((l, i) => { if (l.warnings.some((w) => w !== "SENDER_MISSING")) problems.push(labels[i].orderNo + ": ข้อความยาวเกินพื้นที่ (" + l.warnings.filter((w) => w !== "SENDER_MISSING").join(", ") + ") แก้ที่อยู่ให้สั้นลงก่อน"); });
  notice($("warn"), problems.join("\n"), true);
  for (const b of ["png", "pdf", "print"]) $(b).disabled = problems.length > 0;
  const ppi = 110, prev = fmt() === "A4" ? renderA4Sheets(layouts, ppi, { startSlot: +$("slot").value })[0] : renderA6(layouts[0], ppi);
  c.width = prev.width; c.height = prev.height; c.getContext("2d").drawImage(prev, 0, 0);
}
const changed = () => { clearTimeout(timer); timer = setTimeout(refresh, 80); };

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
$("ship").addEventListener("click", () => { const o = orders.find((x) => x.id === ids()[0]); $("shipOrder").textContent = o.orderNo; $("sProv").value = o.provider ?? ""; $("sTrack").value = o.trackingNo ?? ""; $("sDate").value = o.shippedAt ?? ""; notice($("sErr"), ""); $("shipDlg").showModal(); });
$("sCancel").addEventListener("click", () => $("shipDlg").close());
$("shipForm").addEventListener("submit", async (ev) => {
  ev.preventDefault(); const id = ids()[0];
  try { await api(`/api/admin/orders/${id}/shipment`, { method: "PUT", body: { provider: $("sProv").value, trackingNo: $("sTrack").value.trim(), shippedAt: $("sDate").value || null } }); data.delete(id); $("shipDlg").close(); await loadOrders(); } catch (e) { notice($("sErr"), errText(e), true); }
});

$("all").addEventListener("click", () => { for (const o of orders) sel.add(o.id); for (const cb of $("list").querySelectorAll("input")) cb.checked = true; changed(); });
$("none").addEventListener("click", () => { sel.clear(); for (const cb of $("list").querySelectorAll("input")) cb.checked = false; changed(); });
$("q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(loadOrders, 250); });
$("printed").addEventListener("change", loadOrders);
for (const r of document.querySelectorAll('input[name="fmt"]')) r.addEventListener("change", changed);
$("slot").addEventListener("change", changed);
(async () => { await loadAssets(); await loadOrders(); })().catch((e) => notice($("notice"), errText(e), true));
