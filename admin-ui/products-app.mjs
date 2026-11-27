import { $, api, notice, el } from "./common.mjs";
const statusText = { draft: "ฉบับร่าง", active: "เปิดขาย", archived: "เก็บไว้" };
let products = [], collections = [], current = null, dirty = false, busy = false, ready = false;
const message = error => error.userMessage || "โหลดหรือบันทึกไม่ได้ กรุณาลองใหม่อีกครั้ง";
const leave = async () => {
  if (!dirty) return true;
  return new Promise(resolve => {
    const dialog = $("discardDraft"), done = value => { resolve(value); dialog.close(); };
    $("discardKeep").onclick = () => done(false); $("discardConfirm").onclick = () => done(true);
    dialog.oncancel = event => { event.preventDefault(); done(false); }; dialog.onclose = () => resolve(false); dialog.showModal();
  });
};
const fields = ["productName", "productShort", "productSlug", "productCollection", "productFit", "productFitName", "priceShort", "priceLong", "productSizes", "productDescription"];
const input = () => ({ slug: $("productSlug").value, name: $("productName").value, shortName: $("productShort").value, fit: $("productFit").value, fitName: $("productFitName").value, description: $("productDescription").value, collectionId: $("productCollection").value ? Number($("productCollection").value) : null, prices: Object.fromEntries([["short", $("priceShort").value], ["long", $("priceLong").value]].filter(([, value]) => value !== "").map(([key, value]) => [key, Number(value)])), sizes: $("productSizes").value.split(",").map(s => s.trim()).filter(Boolean) });
function preview() {
  const p = input();
  $("previewStatus").textContent = current ? statusText[current.status] + (current.status === "draft" ? " · ยังไม่เปิดขาย" : " · ดูข้อมูล") : "ฉบับร่าง · ยังไม่เปิดขาย";
  $("previewName").textContent = p.name.trim() || "ชื่อสินค้า"; $("previewFit").textContent = p.fitName; $("previewDescription").textContent = p.description;
  const prices = $("previewPrices"); prices.replaceChildren();
  for (const [sleeve, value] of Object.entries(p.prices)) if (Number.isFinite(value) && value > 0) prices.append(el("dt", "", sleeve === "short" ? "แขนสั้น" : "แขนยาว"), el("dd", "", value.toLocaleString("th-TH") + " บาท"));
  $("previewSizes").replaceChildren(...p.sizes.map(size => el("li", "", size.toUpperCase())));
}
function controls() {
  $("productFields").disabled = busy || !ready || (!!current && !current.editable);
  $("saveDraft").disabled = busy || !ready || (!!current && !current.editable);
  for (const id of ["newDraft", "reloadProducts", "productSearch", "productStatus"]) $(id).disabled = busy || !ready;
  $("saveDraft").textContent = busy ? "กำลังบันทึก…" : "บันทึกฉบับร่าง";
}
function selectProduct(product) {
  current = product; dirty = false; notice($("productError"), "");
  const fit = product?.fit || "boxy";
  $("productFit").replaceChildren(...[["boxy", "Boxy"], ["regular", "ทรงปกติ"], ...(!["boxy", "regular"].includes(fit) ? [[fit, product.fitName]] : [])].map(([value, label]) => { const o = el("option", "", label); o.value = value; return o; }));
  const values = [product?.name || "", product?.shortName || "", product?.slug || "", product?.collectionId || "", fit, product?.fitName || "ทรง Boxy", product?.prices.short ?? "", product?.prices.long ?? "", product?.sizes.join(", ") || "", product?.description || ""];
  fields.forEach((id, i) => { $(id).value = values[i]; }); $("productSlug").readOnly = !!product;
  $("editorHeading").textContent = product ? product.name : "ฉบับร่างใหม่";
  $("editState").textContent = product && !product.editable ? "ดูข้อมูลได้อย่างเดียว เพื่อรักษาสินค้าที่เปิดขายและข้อมูลออเดอร์เดิม" : "บันทึกเป็นฉบับร่างเท่านั้น ยังไม่แสดงให้ลูกค้าสั่งซื้อ";
  controls(); renderList(); preview();
}
function renderList() {
  const query = $("productSearch").value.trim().toLocaleLowerCase("th"), status = $("productStatus").value;
  const shown = products.filter(p => (!status || p.status === status) && (!query || (p.name + " " + p.slug).toLocaleLowerCase("th").includes(query)));
  $("catalogCount").textContent = shown.length + " จาก " + products.length + " สินค้า";
  const list = $("productList"); list.replaceChildren();
  for (const p of shown) {
    const li = el("li"), button = el("button", "product-select" + (current?.id === p.id ? " selected" : "")); button.type = "button"; button.disabled = busy;
    button.append(el("strong", "", p.name), el("span", "badge", statusText[p.status]), el("small", "muted", p.slug + " · " + (p.collectionName || "ไม่ระบุ Collection")), el("span", "product-open", p.editable ? "แก้ไขฉบับร่าง" : "ดูข้อมูล"));
    button.setAttribute("aria-pressed", String(current?.id === p.id));
    button.onclick = async () => { if (!busy && await leave()) { selectProduct(p); $("editorHeading").scrollIntoView({ block: "start" }); } };
    li.append(button); list.append(li);
  }
  if (!shown.length) list.append(el("li", "muted", products.length ? "ไม่พบสินค้าที่ตรงกับตัวกรอง" : "ยังไม่มีสินค้า เริ่มจากสร้างฉบับร่างใหม่"));
}
async function load(selectId = current?.id) {
  const result = await api("/api/admin/products"); products = result.products; collections = result.collections;
  $("productCollection").replaceChildren(...[["", "ไม่ระบุ Collection"], ...collections.map(c => [String(c.id), c.name + (c.status === "archived" ? " (เก็บไว้)" : "")])].map(([value, label]) => { const o = el("option", "", label); o.value = value; return o; }));
  ready = true; selectProduct(products.find(p => p.id === selectId) || null);
}
$("productForm").addEventListener("input", () => { dirty = true; $("editState").textContent = "มีการแก้ไขที่ยังไม่บันทึก"; preview(); });
$("productFit").addEventListener("change", () => { $("productFitName").value = $("productFit").value === "regular" ? "ทรงปกติ" : "ทรง Boxy"; dirty = true; preview(); });
$("productForm").onsubmit = async event => {
  event.preventDefault(); if (busy || !ready || (current && !current.editable)) return;
  if (!$("productForm").reportValidity()) return;
  const body = input(); if (!Object.keys(body.prices).length) { notice($("productError"), "ใส่ราคาแขนสั้นหรือแขนยาวอย่างน้อยหนึ่งแบบ", true); return; }
  if (current) body.expectedRevision = current.revision;
  busy = true; controls(); renderList(); notice($("productError"), ""); notice($("notice"), "");
  try {
    const result = await api("/api/admin/products" + (current ? "/" + current.id : ""), { method: current ? "PUT" : "POST", body });
    dirty = false; $("productStatus").value = "draft";
    // Keep the accepted revision even if the subsequent catalog refresh fails.
    current = result.product; selectProduct(current);
    notice($("notice"), "บันทึกฉบับร่างแล้ว ยังไม่เปิดขาย");
    try { await load(result.product.id); } catch { notice($("notice"), "บันทึกฉบับร่างแล้ว แต่โหลดรายการใหม่ไม่ได้ กดโหลดข้อมูลใหม่ได้"); }
  } catch (error) { notice($("productError"), message(error), true); }
  finally { busy = false; controls(); renderList(); }
};
$("newDraft").onclick = async () => { if (!busy && await leave()) { selectProduct(null); $("productName").focus(); } };
$("reloadProducts").onclick = async () => { if (busy || !(await leave())) return; busy = true; controls(); try { await load(); notice($("notice"), "โหลดข้อมูลล่าสุดแล้ว"); } catch (error) { notice($("notice"), message(error), true); } finally { busy = false; controls(); renderList(); } };
$("productSearch").oninput = renderList; $("productStatus").onchange = renderList;
$("showProductPreview").onclick = () => { preview(); $("productPreview").open = true; $("productPreview").scrollIntoView({ block: "start" }); };
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
controls();
try { await load(); } catch (error) { notice($("notice"), message(error) + " · รีเฟรชหน้านี้เพื่อลองใหม่", true); }
