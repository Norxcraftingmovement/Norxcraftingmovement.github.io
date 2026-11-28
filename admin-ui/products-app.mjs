import { $, api, notice, el } from "./common.mjs";
import { productTemplate } from "./product-template.mjs";
import { PRODUCT_THEMES, defaultProductTheme } from "./product-theme-options.mjs";
import { productFixtures } from "./product-theme-fixtures.mjs";
const statusText = { draft: "ฉบับร่าง", active: "เปิดขาย", archived: "เก็บไว้" };
let mediaReady = false, coverFile = null, coverUrl = "", coverRemoved = false, imageBusy = false, imageVersion = 0, reviewed = "";
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
const fields = ["productName", "productShort", "productSlug", "productCollection", "productFit", "productFitName", "priceShort", "priceLong", "productSizes", "productDescription", "productTheme"];
const input = () => ({ slug: $("productSlug").value, name: $("productName").value, shortName: $("productShort").value, fit: $("productFit").value, fitName: $("productFitName").value, description: $("productDescription").value, themeId: $("productTheme").value, collectionId: $("productCollection").value ? Number($("productCollection").value) : null, prices: Object.fromEntries([["short", $("priceShort").value], ["long", $("priceLong").value]].filter(([, value]) => value !== "").map(([key, value]) => [key, Number(value)])), sizes: $("productSizes").value.split(",").map(s => s.trim()).filter(Boolean) });
function preview() {
  const p = input();
  $("previewStatus").textContent = current ? statusText[current.status] + (current.status === "draft" ? " · ยังไม่เปิดขาย" : " · ดูข้อมูล") : "ฉบับร่าง · ยังไม่เปิดขาย";
  $("previewName").textContent = p.name.trim() || "ชื่อสินค้า"; $("previewFit").textContent = p.fitName; $("previewDescription").textContent = p.description;
  const prices = $("previewPrices"); prices.replaceChildren();
  for (const [sleeve, value] of Object.entries(p.prices)) if (Number.isFinite(value) && value > 0) prices.append(el("dt", "", sleeve === "short" ? "แขนสั้น" : "แขนยาว"), el("dd", "", value.toLocaleString("th-TH") + " บาท"));
  $("previewSizes").replaceChildren(...p.sizes.map(size => el("li", "", size.toUpperCase())));
}
const fingerprint = () => JSON.stringify([input(), coverUrl, coverRemoved]);
function controls() {
  $("productFields").disabled = busy || !ready || (!!current && !current.editable);
  $("saveDraft").disabled = busy || imageBusy || !ready || reviewed !== fingerprint() || (!!current && !current.editable);
  $("showProductPreview").disabled = busy || imageBusy || !ready;
  $("productCover").disabled = busy || !mediaReady || (!!current && !current.editable);
  $("removeCover").disabled = busy || imageBusy || (!!current && !current.editable);
  for (const id of ["newDraft", "reloadProducts", "productSearch", "productStatus"]) $(id).disabled = busy || !ready;
  $("saveDraft").textContent = busy ? "กำลังบันทึก…" : "บันทึกฉบับร่าง";
}
function selectProduct(product) {
  ++imageVersion; if (coverUrl.startsWith("blob:")) URL.revokeObjectURL(coverUrl);
  coverFile = null; coverUrl = product?.coverUrl || ""; coverRemoved = false; imageBusy = false; reviewed = ""; $("productCover").value = ""; showCover();
  current = product; dirty = false; notice($("productError"), "");
  const fit = product?.fit || "boxy";
  $("productFit").replaceChildren(...[["boxy", "Boxy"], ["regular", "ทรงปกติ"], ...(!["boxy", "regular"].includes(fit) ? [[fit, product.fitName]] : [])].map(([value, label]) => { const o = el("option", "", label); o.value = value; return o; }));
  const values = [product?.name || "", product?.shortName || "", product?.slug || "", product?.collectionId || "", fit, product?.fitName || "ทรง Boxy", product?.prices.short ?? "", product?.prices.long ?? "", product?.sizes.join(", ") || "", product?.description || "", product?.themeId || defaultProductTheme(product?.slug)];
  fields.forEach((id, i) => { $(id).value = values[i]; }); $("productSlug").readOnly = !!product;
  $("editorHeading").textContent = product ? product.name : "ฉบับร่างใหม่";
  $("editState").textContent = product && !product.editable ? "ดูข้อมูลได้อย่างเดียว เพื่อรักษาสินค้าที่เปิดขายและข้อมูลออเดอร์เดิม" : "บันทึกเป็นฉบับร่างเท่านั้น ยังไม่แสดงให้ลูกค้าสั่งซื้อ";
  $("previewContext").textContent = productFixtures[product?.slug] ? "พรีวิวรุ่นเดิม: รูปและตารางไซส์อ้างอิงหน้าเว็บปัจจุบัน · ข้อมูลขายอิงแคตตาล็อกที่เปิดดู · ไม่รับออเดอร์" : "ฉบับร่างส่วนตัว · ยังไม่เผยแพร่ · ปุ่มสั่งซื้อใช้ไม่ได้ · ยังไม่มีตารางวัดไซส์และวันเปิดขาย";
  $("closeStorePreview").textContent = product && !product.editable ? "กลับไปดูข้อมูล" : "กลับไปบันทึก";
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
  const result = await api("/api/admin/products"); products = result.products; collections = result.collections; mediaReady = result.mediaReady;
  $("mediaState").textContent = mediaReady ? "รูปปกเก็บเป็นส่วนตัวพร้อมฉบับร่าง ยังไม่แสดงบนเว็บลูกค้า" : "ยังไม่ได้เชื่อมพื้นที่เก็บรูปสินค้า · เตรียมข้อมูลและพรีวิวแบบไม่มีรูปได้";
  $("productCollection").replaceChildren(...[["", "ไม่ระบุ Collection"], ...collections.map(c => [String(c.id), c.name + (c.status === "archived" ? " (เก็บไว้)" : "")])].map(([value, label]) => { const o = el("option", "", label); o.value = value; return o; }));
  ready = true; selectProduct(products.find(p => p.id === selectId) || null);
}
$("productForm").addEventListener("input", () => { reviewed = ""; dirty = true; controls(); $("editState").textContent = "มีการแก้ไขที่ยังไม่บันทึก"; preview(); });
$("productFit").addEventListener("change", () => { $("productFitName").value = $("productFit").value === "regular" ? "ทรงปกติ" : "ทรง Boxy"; dirty = true; reviewed = ""; controls(); preview(); });
$("productForm").onsubmit = async event => {
  event.preventDefault(); if (busy || !ready || (current && !current.editable)) return;
  if (!$("productForm").reportValidity()) return;
  if (reviewed !== fingerprint()) { notice($("productError"), "ดูพรีวิวข้อมูลล่าสุดก่อนบันทึก", true); return; }
  const body = input(); if (coverRemoved) body.coverRemove = true; if (!Object.keys(body.prices).length) { notice($("productError"), "ใส่ราคาแขนสั้นหรือแขนยาวอย่างน้อยหนึ่งแบบ", true); return; }
  if (current) body.expectedRevision = current.revision;
  busy = true; controls(); renderList(); notice($("productError"), ""); notice($("notice"), "");
  try {
    const path = "/api/admin/products" + (current ? "/" + current.id : ""), method = current ? "PUT" : "POST";
    let result;
    if (coverFile) {
      const form = new FormData(); form.set("data", JSON.stringify(body)); form.set("cover", coverFile);
      const response = await fetch(path, { method, body: form, credentials: "same-origin" }); result = await response.json();
      if (!response.ok || result.ok === false) { const error = new Error("UPLOAD_FAILED"); error.userMessage = result.message || "อัปโหลดไม่ได้ กรุณาลองใหม่ รูปที่เลือกยังอยู่"; throw error; }
    } else result = await api(path, { method, body });
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
function showCover() { $("coverThumb").hidden = !coverUrl; $("removeCover").hidden = !coverUrl; if (coverUrl) $("coverThumb").src = coverUrl; else $("coverThumb").removeAttribute("src"); }
$("productCover").onchange = async () => {
  const file = $("productCover").files[0], version = ++imageVersion; if (!file) return;
  reviewed = ""; imageBusy = true; controls(); notice($("productError"), "");
  let url = "";
  try {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > 4194304) throw Error("ใช้ JPG, PNG หรือ WebP ขนาดไม่เกิน 4 MB");
    url = URL.createObjectURL(file); const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40000000) throw Error("รูปมีขนาดพิกเซลใหญ่เกินไป กรุณาย่อรูปก่อน");
    if (version !== imageVersion) { URL.revokeObjectURL(url); return; }
    if (coverUrl.startsWith("blob:")) URL.revokeObjectURL(coverUrl);
    coverFile = file; coverUrl = url; coverRemoved = false; dirty = true; showCover();
    $("editState").textContent = "เลือกรูปแล้ว · ดูพรีวิวก่อนบันทึก รูปยังไม่อัปโหลด";
  } catch (error) { if (url) URL.revokeObjectURL(url); if (version === imageVersion) { $("productCover").value = ""; notice($("productError"), error.message === "The source image cannot be decoded." ? "เปิดรูปไม่ได้ กรุณาเลือกรูปใหม่" : error.message, true); } }
  finally { if (version === imageVersion) { imageBusy = false; controls(); } }
};
$("removeCover").onclick = () => { ++imageVersion; imageBusy = false; if (coverUrl.startsWith("blob:")) URL.revokeObjectURL(coverUrl); coverFile = null; coverUrl = ""; coverRemoved = true; reviewed = ""; dirty = true; $("productCover").value = ""; showCover(); controls(); };
const viewport = mode => { $("storeFrame").parentElement.classList.toggle("desktop", mode === "desktop"); $("previewPhone").setAttribute("aria-pressed", String(mode === "phone")); $("previewDesktop").setAttribute("aria-pressed", String(mode === "desktop")); };
$("previewPhone").onclick = () => viewport("phone"); $("previewDesktop").onclick = () => viewport("desktop");
$("closeStorePreview").onclick = () => $("storePreview").close();
$("showProductPreview").onclick = () => {
  if (busy || imageBusy || !$("productForm").reportValidity()) return;
  if (!Object.keys(input().prices).length) { notice($("productError"), "ใส่ราคาอย่างน้อยหนึ่งแบบก่อนดูพรีวิว", true); return; }
  reviewed = ""; controls(); const snapshot = fingerprint();
  $("storeFrame").onload = () => { if (snapshot === fingerprint()) { reviewed = snapshot; controls(); } };
  $("storeFrame").srcdoc = productTemplate(input(), coverUrl, current ? productFixtures[current.slug] : null); viewport("phone"); $("storePreview").showModal();
};
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
$("productTheme").replaceChildren(...PRODUCT_THEMES.map(theme => { const option = el("option", "", theme.name); option.value = theme.id; return option; }));
controls();
try { await load(); } catch (error) { notice($("notice"), message(error) + " · รีเฟรชหน้านี้เพื่อลองใหม่", true); }
