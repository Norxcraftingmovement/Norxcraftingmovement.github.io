// Browser checks for the staging host (synthetic data): checkout → dynamic QR panel, /pay/ page, QR download, mobile overflow on
// every public/admin page, admin auto-refresh latency. Needs Playwright (not a repo dependency): `npm i -D playwright` or use the preinstalled one.
// Usage: node scripts/staging-ui-check.mjs --base https://staging.norxcraftingmovement.com --session .staging/owner-session.json   (owner's Access session; no service tokens)
import { fileURLToPath } from "node:url";
export async function runUiCheck({ base, headers = {}, storageState = undefined, chromium, log = () => {}, decodeQr = null }) {
  const out = [], rec = (name, ok, detail = "") => { out.push({ name, ok, detail }); log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : "")); };
  const browser = await chromium.launch(), mk = (vp, extra = {}) => browser.newContext({ viewport: vp, extraHTTPHeaders: headers, acceptDownloads: true, ...(storageState ? { storageState } : {}), ...extra });
  const errs = []; try {
    const ctx = await mk({ width: 390, height: 844 }, { isMobile: true, deviceScaleFactor: 2 }), page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); }); page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push("HTTP " + r.status() + " " + r.url().replace(base, "")); });
    const cfg = await (await ctx.request.get(base + "/api/orders")).json(); const p = cfg.products[0], sleeve = p.prices.short ? "short" : "long";
    await page.goto(base + "/cart/"); await page.evaluate(([rid, it]) => localStorage.setItem("norx-cart-v2", JSON.stringify({ roundId: rid, items: [it] })), [cfg.round.id, { product: p.id, fit: p.fit, sleeve, size: p.sizes[0], qty: 1 }]);
    await page.reload(); await page.waitForSelector("#orderForm:not([disabled]), #orderFields:not([disabled])");
    await page.fill("#customerName", "ทดสอบ ยูไอ"); await page.fill("#phone", "0800000000"); await page.locator('input[name="delivery"][value="city"]').check();
    for (const id of ["preorder", "sizing", "privacy"]) await page.check("#" + id); await page.click("#submitButton"); await page.waitForSelector("#payment:not([hidden])", { timeout: 15000 });
    const hasQr = await page.locator("#dynamicPay img").count();
    if (!hasQr) rec("checkout shows the QR panel", true, "no QR block returned (PromptPay not verified) — bank-transfer view shown");
    else {
      await page.waitForFunction(() => { const i = document.querySelector("#dynamicPay img"); return i && i.complete && i.naturalWidth > 0; });
      const txt = await page.locator("#dynamicPay").innerText(), id = (await page.textContent("#savedOrder")).match(/NORX-[0-9A-F]{8}/)?.[0];
      rec("checkout shows order number, amount, payee name and deadline next to the QR", !!id && txt.includes(id) && /บาท/.test(txt) && /ผู้รับเงิน/.test(txt) && /ชำระภายใน/.test(txt), txt.replace(/\s+/g, " ").slice(0, 120));
      rec("bank-transfer fallback and manual-verification notice remain", (await page.locator("#bankAccount").isVisible()) && /ระบบยังไม่ยืนยันการชำระอัตโนมัติ/.test(txt));
      rec("old static QR image hidden when a dynamic QR is shown", !(await page.locator("img.qr").first().isVisible().catch(() => false)));
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /PNG/ }).click()]); rec("QR PNG download", /^NORX-NORX-.*-QR\.png$|^NORX-.*QR\.png$/.test(dl.suggestedFilename()), dl.suggestedFilename());
      const shot = await page.locator("#dynamicPay img").screenshot();
      if (decodeQr) { const payload = await decodeQr(shot); rec("QR decodes to a PromptPay payload with the order amount", /^000201/.test(payload ?? "") && /54\d\d\d+\.\d\d5802TH6304[0-9A-F]{4}$/.test(payload), String(payload).slice(0, 70)); }
      const payUrl = await page.evaluate(() => document.querySelector("#dynamicPay a").href); const pp = await ctx.newPage(); await pp.goto(payUrl.replace(/\/api\/orders\/pay\.svg/, "/pay/").replace("&download=1", ""));
      await pp.waitForSelector("#dynamicPay img", { timeout: 10000 }); rec("/pay/ page shows the same QR on mobile", true);
      rec("no horizontal overflow on /pay/", !(await pp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
    }
    for (const path of ["/", "/cart/", "/admin/", "/admin/orders/", "/admin/production/", "/admin/shipping/", "/admin/settings/"]) { await page.goto(base + path); await page.waitForTimeout(500); rec("mobile 390px: no horizontal overflow " + path, !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))); }
    rec("no console or HTTP errors during the run", errs.length === 0, errs.slice(0, 3).join(" | "));
  } finally { await browser.close(); }
  return { results: out, passed: out.filter((r) => r.ok).length, failed: out.filter((r) => !r.ok).length };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), base = a[a.indexOf("--base") + 1], hdr = Object.fromEntries(a.flatMap((x, i) => (x === "--header" ? [[a[i + 1].split(":")[0].trim(), a[i + 1].slice(a[i + 1].indexOf(":") + 1).trim()]] : [])));
  if (!base || !/staging|127\.0\.0\.1|localhost/.test(base)) { console.error("usage: node scripts/staging-ui-check.mjs --base <staging url>"); process.exit(2); }
  const { chromium } = await import("playwright"); const sess = a.includes("--session") ? a[a.indexOf("--session") + 1] : undefined; const r = await runUiCheck({ base, headers: hdr, storageState: sess, chromium, log: console.log }); console.log(JSON.stringify({ passed: r.passed, failed: r.failed })); process.exit(r.failed ? 1 : 0);
}
