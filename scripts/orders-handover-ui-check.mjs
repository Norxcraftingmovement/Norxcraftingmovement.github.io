// Local synthetic rehearsal only. Supply an existing Playwright page; no package install required.
// Start a FRESH scripts/dev-staging-local.mjs instance and build the staging storefront first.
// This does NOT satisfy the go-live check on the deployed staging build or real bank/print checks.
export async function runHandoverUiCheck({ page, base }) {
  const url = new URL(base);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.pathname !== "/") throw new Error("Local synthetic host only");
  base = url.origin;
  const results = [], errors = [], onError = error => errors.push(String(error));
  const must = (condition, message) => { if (!condition) throw new Error(message); };
  const pass = name => results.push({ name, ok: true });
  const get = async path => {
    const r = await page.request.get(base + path); must(r.ok(), "GET failed: " + path); return r.json();
  };
  const confirm = async () => page.locator("#dlg").getByRole("button", { name: "ยืนยัน", exact: true }).click();
  const orderList = () => get("/api/admin/orders");
  page.on("pageerror", onError);
  try {
    must(Array.isArray(await get("/__dev/sent")), "Synthetic fixture marker missing");
    must((await orderList()).orders.length === 0, "Use a fresh synthetic fixture");
    const cfg = await get("/api/orders"), product = cfg.products[0];
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "/cart/");
    await page.evaluate(([roundId, item]) => {
      localStorage.clear(); localStorage.setItem("norx-cart-v2", JSON.stringify({ roundId, items: [item] }));
    }, [cfg.round.id, { product: product.id, fit: product.fit, sleeve: "short", size: product.sizes[0], qty: 2 }]);
    await page.reload();
    await page.locator("#customerName").fill("ทดสอบ รับของบางส่วน");
    await page.locator("#phone").fill("0800000000");
    await page.locator('input[name="delivery"][value="city"]').check();
    for (const id of ["preorder", "sizing", "privacy"]) await page.locator("#" + id).check();
    await page.locator("#submitButton").click();
    await page.locator("#payment:not([hidden])").waitFor();
    must(await page.locator("#dynamicPay img").count() === 1, "Dynamic QR missing");
    const order = (await orderList()).orders[0], amount = product.prices.short * 2;
    must(order.total === amount && order.status === "รอโอน", "Wrong checkout total/status");
    pass("mobile checkout creates two-piece order and QR");

    await page.goto(base + "/admin/orders/");
    await page.getByRole("button", { name: "จ่ายหน้างาน", exact: true }).click(); await confirm();
    await page.locator("#roundDetails > summary").click();
    await page.getByRole("button", { name: "ปิดรับตอนนี้", exact: true }).click(); await confirm();
    await page.getByRole("button", { name: /ตัดยอดส่งร้าน/ }).click(); await confirm();
    must((await orderList()).orders[0].status === "จ่ายหน้างาน", "Deferred status lost");
    pass("deferred order enters the production round");

    await page.goto(base + "/admin/production/");
    await page.locator("#round").selectOption(cfg.round.id);
    await page.getByRole("button", { name: /ผลิตเสร็จทั้งล็อต/ }).click(); await confirm();
    await page.getByRole("button", { name: "รับของไม่ครบ", exact: true }).click();
    await page.locator("#receiptRows input").first().fill("1");
    await page.getByRole("button", { name: "บันทึกรับของ", exact: true }).click();
    await page.locator("#receiptDialog").waitFor({ state: "hidden" });
    const partial = await get("/api/admin/production/receipts?round=" + cfg.round.id);
    must(partial.lines[0].received === 1 && partial.lines[0].qty === 2, "Partial receipt count incorrect");
    const pickupPath = "/admin/orders/?queue=pickup&round=" + cfg.round.id;
    await page.goto(base + pickupPath);
    await page.locator("#orders").getByText("ไม่พบออเดอร์").waitFor();
    pass("one of two pieces received stays out of pickup queue");

    await page.goto(base + "/admin/orders/?round=" + cfg.round.id);
    await page.getByRole("button", { name: "รับเงินและส่งมอบ", exact: true }).click();
    await page.locator("#dlgInput").fill(String(amount));
    const denied = page.waitForResponse(r => r.url().endsWith("/status") && r.request().method() === "POST");
    await confirm(); const response = await denied;
    must(response.status() === 400, "Incomplete order handover was accepted");
    await page.waitForLoadState("networkidle");
    await page.locator("#notice").getByText("ออเดอร์นี้รับเสื้อยังไม่ครบ", { exact: true }).waitFor();
    must((await orderList()).orders[0].status === "จ่ายหน้างาน", "Rejected handover changed status");
    pass("rejected handover keeps its Thai explanation after quiet reload");

    await page.goto(base + "/admin/production/");
    await page.locator("#round").selectOption(cfg.round.id);
    await page.getByRole("button", { name: "รับของไม่ครบ", exact: true }).click();
    await page.locator("#receiptRows input").first().fill("1");
    await page.getByRole("button", { name: "บันทึกรับของ", exact: true }).click();
    await page.locator("#receiptDialog").waitFor({ state: "hidden" });
    await page.goto(base + pickupPath);
    await page.getByRole("button", { name: "รับเงินและส่งมอบ", exact: true }).waitFor();
    pass("receiving the remaining piece unlocks pickup");

    await page.getByRole("button", { name: "รับเงินและส่งมอบ", exact: true }).click();
    await page.locator("#dlgInput").fill("1"); await confirm();
    must(await page.locator("#dlgErr").isVisible(), "Wrong amount was not explained");
    must((await orderList()).orders[0].status === "จ่ายหน้างาน", "Wrong amount changed status");
    await page.locator("#dlgNo").click();
    must((await orderList()).orders[0].status === "จ่ายหน้างาน", "Cancel changed status");
    pass("wrong cash amount and cancellation leave the order unchanged");

    await page.getByRole("button", { name: "รับเงินและส่งมอบ", exact: true }).click();
    await page.locator("#dlgInput").fill(String(amount)); await confirm();
    await page.locator("#orders").getByText("ไม่พบออเดอร์").waitFor();
    must((await orderList()).orders[0].status === "ส่งมอบแล้ว", "Cash handover did not complete");
    const rounds = await get("/api/admin/rounds");
    must(rounds.rounds[0].summary.revenue === amount, "Revenue must equal exactly one payment");
    must((await get("/api/admin/integrity")).violations.length === 0, "Integrity violations");
    pass("correct cash handover records one payment and removes pickup item");
    must(errors.length === 0, "Browser script errors: " + errors.join(" | "));
    pass("no browser JavaScript exceptions during the flow");
    return { environment: "local synthetic only", passed: results.length, failed: 0, results };
  } finally { page.off("pageerror", onError); }
}
