// Draft-only workflow rehearsal against an isolated local synthetic server.
export async function runProductsUiCheck({ page, base, capture }) {
  const url = new URL(base);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.username || url.password || url.pathname !== "/") throw Error("Local synthetic host only");
  base = url.origin;
  const get = async path => { const r = await page.request.get(base + path); if (!r.ok()) throw Error("GET failed"); return r.json(); };
  const must = (value, message) => { if (!value) throw Error(message); }, results = [], errors = [];
  const pass = name => results.push(name), onError = error => errors.push(String(error)); page.on("pageerror", onError);
  const catalog = async () => (await get("/api/admin/products")).products;
  try {
    must(Array.isArray(await get("/__dev/sent")), "Synthetic marker missing");
    const initial = await catalog(), publicBefore = JSON.stringify((await get("/api/orders")).products);
    must(!initial.some(p => p.slug === "drop04-ui-test"), "Use a fresh draft fixture");
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(base + "/admin/products/");
    await page.locator("#productList button").first().waitFor();
    await page.locator("#productName").fill("Unsaved test");
    await page.locator("#productList button").first().click(); await page.locator("#discardKeep").click();
    must(await page.locator("#productName").inputValue() === "Unsaved test", "Discard cancellation lost form data"); pass("unsaved form stays intact when discard is cancelled");
    await page.locator("#productName").fill("DROP 04 · UI TEST"); await page.locator("#productShort").fill("DROP 04"); await page.locator("#productSlug").fill("drop04-ui-test");
    await page.locator("#priceShort").fill("490"); await page.locator("#priceLong").fill("590"); await page.locator("#productSizes").fill("S, M, L, XL");
    const literal = "<img src=x onerror=alert(1)> ข้อความตัวอย่าง"; await page.locator("#productDescription").fill(literal);
    await page.locator("#saveDraft").click(); await page.locator("#notice").getByText("บันทึกฉบับร่างแล้ว ยังไม่เปิดขาย", { exact: true }).waitFor();
    let product = (await catalog()).find(p => p.slug === "drop04-ui-test"); must(product?.status === "draft", "Draft not created");
    must((await catalog()).length === initial.length + 1 && JSON.stringify((await get("/api/orders")).products) === publicBefore, "Draft changed public catalog");
    must(await page.locator("#productSlug").getAttribute("readonly") !== null, "Saved slug should be immutable"); pass("mobile draft creation persists without changing public products");
    await page.locator("#showProductPreview").click(); must(await page.locator("#previewDescription").innerText() === literal, "Preview altered text");
    must(await page.locator("#previewDescription img").count() === 0, "Preview rendered markup"); pass("preview displays user text literally without executing markup");
    await page.locator("#productName").fill("DROP 04 · EDITED"); await page.locator("#priceShort").fill("520"); await page.locator("#productSizes").fill("XS, M, XL");
    const saved = page.waitForResponse(r => r.request().method() === "PUT" && r.url().endsWith("/products/" + product.id)); await page.locator("#saveDraft").click(); must((await saved).ok(), "Update failed");
    await page.waitForLoadState("networkidle"); product = (await catalog()).find(p => p.id === product.id); must(product.prices.short === 520 && product.sizes.join(",") === "XS,M,XL", "Draft fields not updated"); pass("draft update retains identity and canonical prices/sizes");
    await page.locator("#productStatus").selectOption(""); await page.locator("#productList button").filter({ hasText: initial.find(p => p.status === "active").name }).click();
    must(await page.locator("#saveDraft").isDisabled() && await page.locator("#productName").isDisabled(), "Live catalog editable"); pass("active product is read-only in the UI");
    await page.locator("#productList button").filter({ hasText: "DROP 04 · EDITED" }).click();
    const body = Object.fromEntries(["slug", "name", "shortName", "fit", "fitName", "description", "collectionId", "prices", "sizes"].map(key => [key, product[key]]));
    body.expectedRevision = product.revision; body.name = "DROP 04 · UPDATED ELSEWHERE"; body.prices = { ...product.prices, short: 530 };
    const other = await page.request.put(base + "/api/admin/products/" + product.id, { headers: { Origin: base }, data: body }); must(other.ok(), "Concurrent fixture failed");
    await page.locator("#priceShort").fill("540"); await page.locator("#saveDraft").click(); await page.locator("#productError").getByText(/ข้อมูลเปลี่ยนแล้ว/).waitFor();
    must((await catalog()).find(p => p.id === product.id).prices.short === 530, "Stale editor overwrote newer price");
    await page.locator("#reloadProducts").click(); await page.locator("#discardConfirm").click(); await page.waitForFunction(() => document.getElementById("priceShort").value === "530"); pass("stale edit is rejected and reload recovers the current revision");
    await page.locator("#productSizes").fill("M, m"); await page.locator("#saveDraft").click(); await page.locator("#productError").getByText(/ไซส์ให้ไม่ซ้ำ/).waitFor();
    must((await catalog()).find(p => p.id === product.id).sizes.join(",") === "XS,M,XL", "Invalid sizes changed draft");
    await page.locator("#reloadProducts").click(); await page.locator("#discardConfirm").click(); await page.waitForFunction(() => document.getElementById("productSizes").value === "XS, M, XL"); pass("invalid duplicate sizes leave the saved draft unchanged");
    await page.locator("#productName").fill("DROP 04 · LOCAL DRAFT"); await page.locator("#productDescription").fill("ข้อมูลสินค้าสมมติสำหรับตรวจหน้าจอ ยังไม่เปิดขาย"); await page.locator("#saveDraft").click();
    await page.waitForLoadState("networkidle"); await page.locator("#showProductPreview").click();
    must(JSON.stringify((await get("/api/orders")).products) === publicBefore, "Public catalog changed");
    if (capture) await capture(page);
    must(errors.length === 0, "Browser JavaScript error"); pass("no JavaScript errors and public catalog remains unchanged throughout");
    return { environment: "local synthetic only", passed: results.length, failed: 0, results };
  } finally { page.off("pageerror", onError); }
}
