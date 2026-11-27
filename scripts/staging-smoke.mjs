// Staging integration smoke test over HTTP (synthetic data only). Works against the real staging host (send Access service-token
// headers) or the local rehearsal server (scripts/dev-staging-local.mjs). It CREATES test orders — never point it at production.
// Usage: node scripts/staging-smoke.mjs --base https://staging.norxcraftingmovement.com --header "CF-Access-Client-Id: …" --header "CF-Access-Client-Secret: …"
//        [--anon-header "x-dev-anon: 1"] [--orders 20] [--cron-path /__dev/cron] [--with-cutoff] [--json]
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BOM = "﻿";

export async function runSmoke({ base, headers = {}, anonHeaders = {}, orders = 12, cronPath = null, withCutoff = false, fetchImpl = fetch, log = () => {} }) {
  const results = [], latency = {}, run = Math.random().toString(16).slice(2, 8), stamp = Date.now();
  const call = async (method, path, { body, h = {}, auth = true, text = false, raw = false } = {}) => {
    const t0 = performance.now();
    const r = await fetchImpl(base + path, { method, redirect: "manual", headers: { ...(auth ? headers : anonHeaders), ...(body !== undefined && !text ? { "Content-Type": "application/json", Origin: base } : {}), ...h }, body: body === undefined ? undefined : text ? body : JSON.stringify(body) });
    const ms = performance.now() - t0, buf = raw ? Buffer.from(await r.arrayBuffer()) : null, t = raw ? null : await r.text();
    let json = null; if (!raw) { try { json = JSON.parse(t); } catch {} }
    return { status: r.status, headers: r.headers, json, text: t, buf, ms };
  };
  const check = async (name, fn) => { const t0 = performance.now(); try { const detail = await fn(); results.push({ name, ok: true, ms: Math.round(performance.now() - t0), detail: detail ?? "" }); log("PASS " + name); } catch (e) { results.push({ name, ok: false, ms: Math.round(performance.now() - t0), detail: e.message }); log("FAIL " + name + " — " + e.message); } };
  const must = (c, m) => { if (!c) throw new Error(m); };
  const same = (a, b, m) => must(JSON.stringify(a) === JSON.stringify(b), m + ": expected " + JSON.stringify(b) + " got " + JSON.stringify(a));
  let config, seq = 0;
  const orderBody = (over = {}) => { const p = config.products[0], size = p.sizes[0], sleeve = p.prices.short ? "short" : "long", price = p.prices[sleeve];
    const o = { requestId: `smoke-${run}-${++seq}-` + Math.random().toString(16).slice(2, 14), roundId: config.round.id, name: "ทดสอบ สโมค " + seq, phone: "0800000000", delivery: "city", address: "", items: [{ product: p.id, fit: p.fit, sleeve, size, qty: 1 }], preorder: true, sizing: true, privacy: true, website: "", expectedTotal: price, ...over };
    o._price = price; return o; };
  const submit = async (o) => { const { _price, ...order } = o; return call("POST", "/api/orders", { body: JSON.stringify({ action: "submit", order }), text: true, h: { Origin: base } }); };
  const created = [];

  // ---- access ----
  await check("unauthorised callers are rejected on every path (Access / Worker)", async () => {
    for (const p of ["/", "/api/orders", "/pay/", "/admin/", "/api/admin/dashboard", "/api/admin/orders/export.csv", "/admin/assets/style.css"]) { const r = await call("GET", p, { auth: false }); must(r.status !== 200 && !/NORX|"ok":true/.test(r.text.slice(0, 4000)), `${p} → ${r.status} (expected a redirect to Access or 401/403)`); }
    const w = await call("POST", "/api/admin/orders/NORX-AAAAAAAA/status", { auth: false, body: { from: "รอโอน", to: "ชำระแล้ว", amount: 1 } }); must(w.status !== 200, "unauthenticated admin write accepted");
  });
  // ---- storefront contract ----
  await check("GET /api/orders returns the V1 config shape with an open round", async () => {
    const r = await call("GET", "/api/orders"); must(r.status === 200 && r.json?.ok === true, "config not ok: " + r.text.slice(0, 120)); config = r.json;
    for (const k of ["serverNow", "bank", "products", "round"]) must(k in config, "missing " + k); must(config.round, "no open round — open one in Admin first"); must(!JSON.stringify(config).includes("testKeyHash"), "secret leaked");
    return `round ${config.round.id}, ${config.products.length} products`;
  });
  if (!config) return finish();
  await check("order creation: V1 receipt, server-side total, ID format, QR payment block when PromptPay is verified", async () => {
    const o = orderBody(), r = await submit(o); must(r.json?.ok === true, "submit failed: " + r.text.slice(0, 160)); created.push({ id: r.json.id, receipt: r.json, order: o });
    must(/^NORX-[0-9A-F]{8}$/.test(r.json.id), "bad id " + r.json.id); same(r.json.total, o._price, "total"); same(r.json.status, "รอโอน", "status");
    return r.json.payment ? "QR block present" : "no QR block (PromptPay not verified)";
  });
  await check("idempotency: replay returns the same order; changed payload with the same requestId is refused; 8 parallel replays create one order", async () => {
    const o = orderBody(), a = await submit(o), b = await submit(o); must(a.json.ok && b.json.id === a.json.id, "replay differs"); created.push({ id: a.json.id, order: o });
    const c = await submit({ ...o, name: "คนอื่น ทดสอบ" }); must(c.json?.ok === false && /ซ้ำ/.test(c.json.error), "changed payload accepted: " + c.text.slice(0, 100));
    const o2 = orderBody(), rs = await Promise.all(Array.from({ length: 8 }, () => submit(o2))); same(new Set(rs.map((x) => x.json.id)).size, 1, "parallel replays → distinct ids"); created.push({ id: rs[0].json.id, order: o2 });
  });
  await check("server-side price/shipping/round validation", async () => {
    const bad = await submit(orderBody({ expectedTotal: 1 })); must(bad.json.ok === false && /ยอดเงิน/.test(bad.json.error), "wrong total accepted");
    const unk = await submit(orderBody({ items: [{ product: "nope", fit: "boxy", sleeve: "short", size: "M", qty: 1 }] })); must(unk.json.ok === false, "unknown product accepted");
    const rd = await submit(orderBody({ roundId: "ROUND-999" })); must(rd.json.ok === false && /รอบ/.test(rd.json.error), "wrong round accepted");
    const hp = await submit(orderBody({ website: "bot" })); must(hp.json.ok === false, "honeypot ignored");
    const ship = orderBody({ delivery: "ship", address: "99/9 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 50000" }); ship.expectedTotal = ship._price + config.round.shipping; const s = await submit(ship); must(s.json.ok === true && s.json.shipping === config.round.shipping, "shipping not charged once: " + s.text.slice(0, 120)); created.push({ id: s.json.id, order: ship, ship: true });
    const pick = orderBody({ expectedTotal: ship._price }); const p = await submit(pick); must(p.json.ok && p.json.shipping === 0, "pickup charged shipping"); created.push({ id: p.json.id, order: pick });
  });
  await check("payment page: token-protected JSON + QR image; wrong token and unknown order look the same; viewing never changes the order", async () => {
    const withQr = created.find((c) => c.receipt?.payment); if (!withQr) return "skipped (no QR configured)";
    const pay = withQr.receipt.payment, ok = await call("GET", pay.apiUrl); must(ok.status === 200 && ok.json.payment.state === "awaiting" && ok.json.payment.amount === withQr.receipt.total, "pay view wrong: " + ok.text.slice(0, 120));
    const svg = await call("GET", pay.qrUrl, { raw: true }); must(svg.status === 200 && /svg/.test(svg.headers.get("content-type")), "svg missing");
    const bad = await call("GET", pay.apiUrl.replace(/t=[^&]+/, "t=" + "A".repeat(22))), unk = await call("GET", pay.apiUrl.replace(/o=[^&]+/, "o=NORX-00000000")); must(bad.status === 404 && unk.status === 404 && bad.text === unk.text, "token/order not indistinguishable");
    const list = await call("GET", "/api/admin/orders?q=" + withQr.id); same(list.json.orders[0].status, "รอโอน", "status after QR views");
    return "QR view did not change status";
  });
  // ---- admin ----
  await check("admin: orders listed, payment confirm → undo → re-confirm leaves exactly one confirmed payment; integrity clean", async () => {
    const id = created[0].id, total = created[0].receipt.total, post = (from, to, amount, extra = {}) => call("POST", `/api/admin/orders/${id}/status`, { body: { from, to, amount, ...extra } });
    must((await post("รอโอน", "ชำระแล้ว", total, { bankTxnRef: "SMOKE-" + run + "-A" })).json?.ok, "confirm failed"); must((await post("ชำระแล้ว", "รอโอน")).json?.ok, "undo failed");
    const again = await post("รอโอน", "ชำระแล้ว", total, { bankTxnRef: "SMOKE-" + run + "-A" }); must(again.json?.ok, "re-confirm failed: " + again.text.slice(0, 120));
    const other = created[1].id, dup = await call("POST", `/api/admin/orders/${other}/status`, { body: { from: "รอโอน", to: "ชำระแล้ว", amount: created[1].order._price, bankTxnRef: "SMOKE-" + run + "-A" } }); must(dup.status === 400 && /ใช้ยืนยันออเดอร์อื่น/.test(dup.json.message), "duplicate bank reference accepted");
    const integ = await call("GET", "/api/admin/integrity"); same(integ.json.violations, [], "integrity violations");
  });
  await check("production summary, CSV exports (BOM), dashboard and shipping label data", async () => {
    const id = created[0].id, tot = created[0].receipt.total;
    const sum = await call("GET", "/api/admin/production/summary?round=" + config.round.id + "&includeTest=1"); must(sum.json.totals.production >= 1 && sum.json.totals.pending >= 1, "summary totals look wrong");
    for (const p of ["/api/admin/production/summary.csv?includeTest=1", "/api/admin/orders/export.csv"]) { const c = await call("GET", p, { raw: true }); must(c.status === 200 && c.buf[0] === 0xef && c.buf[1] === 0xbb && c.buf[2] === 0xbf && /attachment/.test(c.headers.get("content-disposition") ?? ""), p + " not a BOM-prefixed attachment"); }
    const d = await call("GET", "/api/admin/dashboard?includeTest=1"); must(d.json.awaitingPayment.count >= 1, "dashboard missing awaiting payments");
    const ship = created.find((c) => c.ship); if (ship) { const li = await call("GET", "/api/admin/labels/orders?q=" + ship.id); const row = li.json.orders?.[0]; must(row, "ship order not in label list"); const ld = await call("POST", "/api/admin/labels/data", { body: { ids: [row.id] } }); must(ld.json.ok && ld.json.labels.length === 1 && ld.json.sender, "label data/sender missing (configure Sender Settings)"); }
    return `${tot} baht order confirmed; production=${sum.json.totals.production}`;
  });
  // ---- latency ----
  const clientMs = [], dash = [];
  await check(`latency: ${orders} sequential orders (client-observed) and dashboard data update after each`, async () => {
    for (let i = 0; i < orders; i++) {
      const before = (await call("GET", "/api/admin/pulse")).json.token, o = orderBody(), r = await submit(o); must(r.json?.ok, "order " + i + " failed"); clientMs.push(r.ms); created.push({ id: r.json.id, order: o });
      const t0 = performance.now(); let seen = false; for (let k = 0; k < 100 && !seen; k++) { const p = await call("GET", "/api/admin/pulse"); if (p.json.token !== before) { seen = true; dash.push(performance.now() - t0); } else await sleep(100); } must(seen, "dashboard pulse never changed");
    }
    latency.orderCreation = { client: { n: clientMs.length, p50: pct(clientMs, 0.5), p95: pct(clientMs, 0.95), max: Math.round(Math.max(...clientMs)) } };
    latency.dashboardDataUpdate = { n: dash.length, p50: pct(dash, 0.5), p95: pct(dash, 0.95), max: Math.round(Math.max(...dash)), note: "time from order response to the first pulse that reports the change; the admin UI then reloads within its 15 s polling interval" };
    const m = await call("GET", "/api/admin/metrics/latency"); latency.serverSide = m.json.latency; return `p50 ${latency.orderCreation.client.p50} ms client-observed`;
  });
  await check("notifications: cron delivers queued alerts; acceptance latency recorded separately from order creation", async () => {
    let q; for (let i = 0; i < (cronPath ? 6 : 160); i++) {
      if (cronPath) must((await call("POST", cronPath, { auth: true, body: "{}", text: true })).status === 200, "cron trigger failed"); // real staging: the Cloudflare cron runs every minute by itself
      q = (await call("GET", "/api/admin/notifications")).json; if (!q.notifications.some((n) => ["queued", "sending", "failed"].includes(n.status))) break; await sleep(cronPath ? 50 : 1000); }
    latency.notification = (await call("GET", "/api/admin/metrics/latency")).json.latency.notification;
    const pending = q.notifications.filter((n) => ["queued", "sending", "failed"].includes(n.status)).length;
    if (q.readiness.mode === "none") return "channel not configured: " + q.readiness.missing.join(", ");
    must(pending === 0, pending + " notifications still pending (readiness " + JSON.stringify(q.readiness) + ")"); must(latency.notification.count > 0, "no notification latency recorded"); return `accepted by provider, p50 ${latency.notification.p50} ms (enqueue → accepted)`;
  });
  // ---- cut-off (optional: closes the current round!) ----
  if (withCutoff) await check("cut-off flow: close → cancel unpaid → send to shop → batch production status → CSV", async () => {
    const rid = config.round.id; must((await call("POST", `/api/admin/rounds/${rid}/close`, { body: {} })).json.ok, "close failed");
    let rs = (await call("GET", "/api/admin/rounds")).json.rounds.find((r) => r.id === rid), un = rs.summary.pendingOrders; if (un) must((await call("POST", `/api/admin/rounds/${rid}/cancel-unpaid`, { body: { expected: un } })).json.ok, "cancel-unpaid failed");
    rs = (await call("GET", "/api/admin/rounds")).json.rounds.find((r) => r.id === rid); must(rs.summary.pieces > 0, "nothing to send"); must((await call("POST", `/api/admin/rounds/${rid}/send-to-shop`, { body: { expectedPieces: rs.summary.pieces } })).json.ok, "send-to-shop failed");
    const mv = async (from, to) => { const s = (await call("GET", `/api/admin/production/summary?round=${rid}&includeTest=1`)).json.totals.status[from]; must(s > 0, "no pieces in " + from); must((await call("POST", "/api/admin/production/items-status", { body: { round: rid, from, to, expected: s } })).json.ok, from + "→" + to + " failed"); };
    await mv("batched", "produced"); await mv("produced", "received"); same((await call("GET", "/api/admin/integrity")).json.violations, [], "integrity after cut-off");
  });
  return finish();
  function finish() { const failed = results.filter((r) => !r.ok); return { base, run, at: new Date(stamp).toISOString(), summary: { passed: results.length - failed.length, failed: failed.length }, results, latency, createdOrders: created.length }; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), all = (k) => a.flatMap((x, i) => (x === k ? [a[i + 1]] : [])), one = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const hdr = (list) => Object.fromEntries(list.map((s) => { const i = s.indexOf(":"); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; }));
  const base = one("--base"); if (!base) { console.error("usage: node scripts/staging-smoke.mjs --base <url> [--header 'K: V']… [--anon-header 'K: V'] [--orders N] [--cron-path /__dev/cron] [--with-cutoff]"); process.exit(2); }
  if (/^https?:\/\/(www\.)?norxcraftingmovement\.com\/?$/.test(base) || !/staging|127\.0\.0\.1|localhost/.test(base)) { console.error("refusing to run: base URL is not a staging/local host"); process.exit(2); }
  const rep = await runSmoke({ base: base.replace(/\/$/, ""), headers: hdr(all("--header")), anonHeaders: hdr(all("--anon-header")), orders: +one("--orders", 12), cronPath: one("--cron-path", null), withCutoff: a.includes("--with-cutoff"), log: (m) => !a.includes("--json") && console.log(m) });
  console.log(a.includes("--json") ? JSON.stringify(rep, null, 2) : "\n" + JSON.stringify({ summary: rep.summary, latency: rep.latency }, null, 2)); process.exit(rep.summary.failed ? 1 : 0);
}
