// Local synthetic rehearsal only; never run against staging/production or real orders.
async function checkStaleSelection(page, base) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw Error("Local synthetic host only");
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pattern = "**/api/admin/labels/data";
  await page.goto(base + "/admin/shipping/");
  await page.route(pattern, async route => { await gate; await route.continue(); });
  try {
    const requested = page.waitForRequest(r => r.url().endsWith("/labels/data"));
    await page.locator("#list input").first().check(); await requested;
    await page.locator("#none").click();
    const response = page.waitForResponse(r => r.url().endsWith("/labels/data")); release(); await response;
    await page.waitForLoadState("networkidle");
    for (const id of ["print", "png", "pdf", "edit", "ship", "shipBatch"]) if (!(await page.locator("#" + id).isDisabled())) throw Error("Stale selection re-enabled " + id);
    return true;
  } finally { release(); await page.unroute(pattern); }
}
export async function runShippingUiCheck({ page, base, capture }) {
  const url = new URL(base);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.pathname !== "/") throw Error("Local synthetic host only");
  base = url.origin;
  const results = [], errors = [], must = (v, message) => { if (!v) throw Error(message); }, pass = name => results.push(name);
  const get = async path => { const r = await page.request.get(base + path); must(r.ok(), "GET failed"); return r.json(); };
  const list = async () => (await get("/api/admin/orders")).orders;
  const states = async () => (await list()).map(o => [o.id, o.paymentStatus, o.fulfillmentStatus]);
  const confirm = () => page.locator("#dlg button[type=submit]").click();
  const changed = () => page.waitForFunction(() => !document.getElementById("print").disabled);
  const onError = error => errors.push(String(error)); page.on("pageerror", onError);
  try {
    must(Array.isArray(await get("/__dev/sent")) && (await list()).length === 0, "Use a fresh local synthetic fixture");
    const cfg = await get("/api/orders"), p = cfg.products[0];
    await page.setViewportSize({ width: 390, height: 844 });
    for (const name of ["ทดสอบ จัดส่งหนึ่ง", "ทดสอบ จัดส่งสอง"]) {
      await page.goto(base + "/cart/");
      await page.evaluate(([roundId, item]) => { localStorage.clear(); localStorage.setItem("norx-cart-v2", JSON.stringify({ roundId, items: [item] })); }, [cfg.round.id, { product: p.id, fit: p.fit, sleeve: "short", size: p.sizes[0], qty: 1 }]);
      await page.reload(); await page.locator("#customerName").fill(name); await page.locator("#phone").fill("0800000000");
      await page.locator('input[name="delivery"][value="ship"]').check(); await page.locator("#address").fill("99 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 10000");
      for (const id of ["preorder", "sizing", "privacy"]) await page.locator("#" + id).check();
      await page.locator("#submitButton").click(); await page.locator("#payment:not([hidden])").waitFor();
    }
    must((await list()).length === 2, "Two shipping orders expected");
    await page.goto(base + "/admin/shipping/"); await page.locator("#list input").first().check(); await changed();
    must(await page.locator("#shipBatch").isDisabled(), "Unpaid orders must not be marked shipped");
    must((await page.locator("#selectionHint").innerText()).includes("ยังบันทึกส่งไม่ได้"), "Missing ineligible explanation"); pass("unpaid label can be prepared, shipment blocked with explanation");
    await page.goto(base + "/admin/orders/");
    for (const order of await list()) {
      await page.locator("#orders li").filter({ hasText: order.id }).getByRole("button", { name: "ยืนยันรับเงิน", exact: true }).click();
      await page.locator("#dlgInput").fill(String(order.total)); const saved = page.waitForResponse(r => r.url().endsWith("/status") && r.request().method() === "POST"); await confirm(); must((await saved).ok(), "Payment not confirmed");
      await page.waitForLoadState("networkidle");
    }
    await page.locator("#roundDetails>summary").click();
    await page.getByRole("button", { name: "ปิดรับตอนนี้", exact: true }).click(); await confirm();
    await page.getByRole("button", { name: /ตัดยอดส่งร้าน/ }).click(); await confirm();
    await page.goto(base + "/admin/production/"); await page.locator("#round").selectOption(cfg.round.id);
    await page.getByRole("button", { name: /ผลิตเสร็จทั้งล็อต/ }).click(); await confirm();
    await page.getByRole("button", { name: "รับของจากโรงงานทั้งล็อต", exact: true }).click(); await confirm();
    must((await list()).every(o => o.fulfillmentStatus === "ready_ship"), "Orders not ready to ship"); pass("two paid orders become ready only after production receipt");
    await page.goto(base + "/admin/shipping/?queue=ready&includeTest=1"); await page.locator("#list input").first().check(); await changed();
    const before = JSON.stringify(await states());
    await page.locator(".shipping-downloads>summary").click();
    const png = page.waitForEvent("download"); await page.locator("#png").click(); must((await png).suggestedFilename().endsWith(".png"), "PNG export failed");
    const pdf = page.waitForEvent("download"); await page.locator("#pdf").click(); must((await pdf).suggestedFilename().endsWith(".pdf"), "PDF export failed");
    const a6 = await page.locator("#preview").getAttribute("width");
    await page.locator('input[name="fmt"][value="A4"]').check(); await page.locator("#slotRow").waitFor(); await page.locator("#slot").selectOption("1");
    await page.waitForFunction(w => Number(document.getElementById("preview").width) > Number(w), a6);
    await page.locator('input[name="fmt"][value="A6"]').check(); await page.locator("#slotRow").waitFor({ state: "hidden" });
    must(before === JSON.stringify(await states()), "Export/layout changed order state"); pass("PNG/PDF and A4/A6 layout keep payment/fulfillment unchanged");
    await page.locator("#edit").click(); await page.locator("#aCancel").click();
    await page.locator("#ship").click(); await page.locator("#sProv").fill("Flash Express"); await page.locator("#sTrack").fill("TH0123456789AA");
    await page.locator("#shipForm button[type=submit]").click(); await page.locator("#shipDlg").waitFor({ state: "hidden" });
    must(before === JSON.stringify(await states()), "Tracking metadata marked order shipped"); pass("single tracking save does not mark shipment complete");
    await page.locator("#all").click(); await page.waitForFunction(() => !document.getElementById("shipBatch").disabled);
    must(await page.locator("#ship").isDisabled() && await page.locator("#edit").isDisabled(), "Single-order actions enabled for multiple orders");
    if (capture) await capture(page);
    await page.locator("#shipBatch").click(); await page.locator("#batchCarrier").fill("Flash Express");
    const orders = await list(), paste = numbers => orders.map((o, i) => o.id + "\t" + numbers[i]).join("\n");
    await page.locator("#batchPaste").fill(paste(["TH0123456789BB", "TH0123456789BB"])); await page.locator("#applyTracking").click();
    const denied = page.waitForResponse(r => r.url().endsWith("/shipments/batch")); await page.locator("#batchSave").click(); must((await denied).status() === 400, "Duplicate tracking accepted");
    await page.locator("#batchError").getByText(/เลขพัสดุซ้ำ/).waitFor(); must(before === JSON.stringify(await states()), "Rejected batch changed orders"); pass("duplicate tracking refuses the whole batch without changing orders");
    await page.locator("#batchPaste").fill(paste(["TH0123456789BB", "TH0123456789CC"])); await page.locator("#applyTracking").click();
    await page.locator("#batchSave").click(); await page.locator("#batchDialog").waitFor({ state: "hidden" });
    await page.locator("#notice").getByText("บันทึกจัดส่งแล้ว 2 รายการ", { exact: true }).waitFor();
    must((await list()).every(o => o.fulfillmentStatus === "shipped"), "Batch did not mark exactly two orders shipped");
    must((await get("/api/admin/integrity")).violations.length === 0, "Integrity violations");
    pass("valid two-order batch records shipment and leaves integrity clean");
    await checkStaleSelection(page, base); pass("late label response cannot re-enable cleared selection");
    must(errors.length === 0, "Browser JavaScript error"); pass("no browser JavaScript exceptions");
    return { environment: "local synthetic only", passed: results.length, failed: 0, results };
  } finally { page.off("pageerror", onError); }
}
