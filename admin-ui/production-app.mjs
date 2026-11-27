import { $, api, notice, el } from "./common.mjs";
import { startAutoRefresh, trackInteraction, store } from "./autorefresh.mjs";
const SL = { short: "แขนสั้น", long: "แขนยาว" }, hhmm = () => new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
let rounds = [], data = null, busy = false, refresher;
const q = () => new URLSearchParams({ round: $("round").value, includeTest: $("test").checked ? "1" : "0" });
const ask = (title, text) => new Promise((res) => { $("dlgT").textContent = title; $("dlgP").textContent = text; const done = (v) => { $("dlg").close(); res(v); }; $("dlgForm").onsubmit = (e) => { e.preventDefault(); done(true); }; $("dlgNo").onclick = () => done(false); $("dlg").onclose = () => res(false); $("dlg").showModal(); });
const num = (v, c = "") => el("td", "num " + c, String(v));
async function load({ quiet = false } = {}) {
  if (busy) return; busy = true;
  try {
    if (!rounds.length) { rounds = (await api("/api/admin/rounds")).rounds; const keep = new URLSearchParams(location.search).get("round") || store.get("norx-prod-round", "all");
      $("round").replaceChildren(...[["all", "ทุกรอบ"], ...rounds.slice().reverse().map((r) => [r.id, r.name + " (" + r.id + ")"])].map(([v, t]) => { const o = el("option", "", t); o.value = v; return o; })); $("round").value = [...$("round").options].some((o) => o.value === keep) ? keep : "all"; }
    const [d, p] = await Promise.all([api("/api/admin/production/summary?" + q()), api("/api/admin/pulse")]); data = d;
    const tb = $("rows"); tb.replaceChildren();
    if (!d.rows.length) { const tr = el("tr"), td = el("td", "muted", "ยังไม่มีรายการ"); td.colSpan = 11; tr.append(td); tb.append(tr); }
    for (const r of d.rows) {
      const tr = el("tr"); tr.append(el("td", "", r.round), el("td", "", r.collection), el("td", "", r.productName + " · " + r.fitName), el("td", "", SL[r.sleeve]), el("td", "", r.size), num(r.production, "strong"), num(r.paid), num(r.deferred), num(r.pending, "muted"));
      // st.produced counts every piece on lines still "produced" (the bulk actions guard on that number); r.partial = pieces of those lines already received.
      const st = r.status, waiting = st.produced - r.partial, td = el("td", "num noprint", "ส่งร้าน " + st.batched + " · ผลิตเสร็จ (รอรับ) " + waiting + " · รับแล้ว " + (st.received + r.partial)); tr.append(td);
      const act = el("td", "noprint"), rd = rounds.find((x) => x.id === r.round);
      if (rd && rd.state === "sent") { if (st.batched) act.append(btn("ผลิตเสร็จ " + st.batched, () => move(r.round, "batched", "produced", st.batched, r))); if (st.produced) act.append(btn("รับของ " + waiting, () => move(r.round, "produced", "received", st.produced, r))); }
      tr.append(act); tb.append(tr);
    }
    const t = d.totals, f = $("foot"); f.replaceChildren(); const tr = el("tr", "total"), c = el("th", "", "รวม"); c.colSpan = 5; c.scope = "row"; tr.append(c, num(t.production, "strong"), num(t.paid), num(t.deferred), num(t.pending, "muted"), el("td", "noprint"), el("td", "noprint")); f.append(tr);
    $("title").textContent = "— " + ($("round").selectedOptions[0]?.textContent ?? "") + " · " + new Date().toLocaleDateString("th-TH");
    drawBatch(d); if (!quiet) notice($("notice"), ""); $("live").textContent = "อัปเดตล่าสุด " + hhmm() + " · รีเฟรชอัตโนมัติทุก 15 วินาที"; refresher?.setToken(p.token);
  } catch (e) { if (!quiet) notice($("notice"), e.userMessage || "โหลดข้อมูลไม่ได้ (" + (e.code || e.message) + ")", true); }
  busy = false;
}
const btn = (t, f, reverse = false) => { const b = el("button", reverse ? "secondary small secondary-operation" : "secondary small", t); b.type = "button"; b.onclick = f; return b; };
function drawBatch(d) {
  const r = rounds.find((x) => x.id === $("round").value), s = d.totals.status, partial = d.totals.partial ?? 0, box = $("batch"), st = $("stats"); box.replaceChildren(); st.replaceChildren();
  for (const [k, v] of [["รอตัดยอดส่งร้าน", s.pending], ["ส่งร้าน · กำลังผลิต", s.batched], ["ผลิตเสร็จ · รอรับ", s.produced - partial], ["รับของแล้ว", s.received + partial]]) { const x = el("div", "stat", k); x.append(el("b", "", String(v))); st.append(x); }
  if (!r) { $("batchHint").textContent = "เลือกรอบเดียวเพื่ออัปเดตสถานะการผลิตทั้งล็อต"; return; }
  if (r.state !== "sent") {
    $("batchHint").textContent = "รอบนี้ยังไม่ได้ตัดยอดส่งร้าน";
    const link = el("a", "btn secondary", "จัดการรอบและส่งยอดร้าน");
    link.href = "/admin/orders/?" + new URLSearchParams({ round: r.id });
    box.append(link);
    return;
  }
  $("batchHint").textContent = "เปลี่ยนสถานะทุกรายการของรอบนี้พร้อมกัน (ระบบจะตรวจว่าจำนวนชิ้นยังตรงกับที่เห็น)";
  if (s.batched) box.append(btn("ผลิตเสร็จทั้งล็อต (" + s.batched + " ชิ้น)", () => move(r.id, "batched", "produced", s.batched)));
  if (s.produced) box.append(
    btn("รับของจากโรงงานทั้งล็อต", () => move(r.id, "produced", "received", s.produced)),
    btn("รับของไม่ครบ", () => openReceipt(r.id)),
    btn("ย้อนเป็นส่งร้านแล้ว (" + s.produced + ")", () => move(r.id, "produced", "batched", s.produced), true),
  );
  if (s.received) box.append(btn("ย้อนเป็นผลิตเสร็จ (" + s.received + ")", () => move(r.id, "received", "produced", s.received), true));
}
let receipt;
const receiptInputs = () => [...$("receiptRows").querySelectorAll("input")];
async function openReceipt(round) {
  const includeTest = $("test").checked;
  try {
    const result = await api("/api/admin/production/receipts?" + new URLSearchParams({ round, includeTest: includeTest ? "1" : "0" }));
    receipt = { round, includeTest, lines: result.lines };
    $("receiptRows").replaceChildren(...result.lines.map((line) => {
      const detail = line.orderNo + " · " + line.product + " " + SL[line.sleeve] + " " + line.size;
      const row = el("tr"), cell = el("td"), input = el("input");
      input.type = "number";
      input.min = 0;
      input.max = line.qty - line.received;
      input.step = 1;
      input.setAttribute("aria-label", "รับเพิ่ม " + detail);
      cell.append(input);
      row.append(el("th", "", detail), el("td", "", line.received + " / " + line.qty), cell);
      return row;
    }));
    notice($("receiptError"), "");
    $("receiptTotal").textContent = result.lines.length ? "กำลังบันทึกรับเพิ่ม 0 ตัว" : "ไม่มีรายการรอรับ";
    $("receiptSave").disabled = !result.lines.length;
    $("receiptDialog").showModal();
  } catch (error) { notice($("notice"), error.userMessage || error.message, true); }
}
$("receiptRows").oninput = () => {
  $("receiptTotal").textContent = "กำลังบันทึกรับเพิ่ม " + receiptInputs().reduce((sum, input) => sum + (+input.value || 0), 0) + " ตัว";
};
$("receiptClose").onclick = () => $("receiptDialog").close();
$("receiptForm").onsubmit = async (event) => {
  event.preventDefault();
  const lines = receiptInputs().flatMap((input, index) => {
    const line = receipt.lines[index];
    return +input.value > 0 ? [{ id: line.id, expected: line.received, add: +input.value }] : [];
  });
  if (!lines.length) { notice($("receiptError"), "ใส่จำนวนที่รับอย่างน้อยหนึ่งรายการ", true); return; }
  $("receiptSave").disabled = true;
  try {
    const result = await api("/api/admin/production/receipts", { method: "POST", body: { round: receipt.round, includeTest: receipt.includeTest, lines } });
    $("receiptDialog").close();
    await load();
    notice($("notice"), "บันทึกรับเพิ่ม " + result.pieces + " ตัวแล้ว");
  } catch (error) { notice($("receiptError"), error.userMessage || error.message, true); }
  finally { $("receiptSave").disabled = false; }
};
async function move(round, from, to, expected, row) {
  const name = { batched: "ส่งร้านแล้ว", produced: "ผลิตเสร็จ", received: "รับของแล้ว" };
  if (!(await ask("เปลี่ยนสถานะการผลิต", (row ? row.productName + " " + SL[row.sleeve] + " " + row.size + " · " : "ทั้งล็อต · ") + expected + " ชิ้น: " + name[from] + " → " + name[to]))) return;
  try { await api("/api/admin/production/items-status", { method: "POST", body: { round, from, to, expected, includeTest: $("test").checked, ...(row ? { product: row.product, sleeve: row.sleeve, size: row.size } : {}) } }); await load(); }
  catch (e) { notice($("notice"), e.userMessage || "ทำรายการไม่ได้ (" + (e.code || e.message) + ")", true); await load({ quiet: true }); }
}
const includeTest = new URLSearchParams(location.search).get("includeTest");
$("test").checked = (includeTest ?? store.get("norx-include-test")) === "1";
$("test").onchange = () => { store.set("norx-include-test", $("test").checked ? "1" : "0"); load(); };
$("round").onchange = () => { store.set("norx-prod-round", $("round").value); load(); };
$("csv").onclick = () => { location.href = "/api/admin/production/summary.csv?" + q(); };
$("print").onclick = () => window.print(); $("showFresh").onclick = () => load();
const interacting = trackInteraction(() => $("dlg").open || $("receiptDialog").open);
await load();
refresher = startAutoRefresh({ pulse: () => api("/api/admin/pulse"), reload: load, interacting, onPending: (v) => { $("fresh").hidden = !v; }, onError: () => { $("live").textContent = "เชื่อมต่อไม่ได้ จะลองใหม่อัตโนมัติ"; } });
