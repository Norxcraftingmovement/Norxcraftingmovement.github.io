// Orders V2 data layer over D1. Every multi-row change is ONE db.batch() (a transaction), and every
// conditional write re-checks its preconditions inside SQL, so concurrent requests cannot corrupt state.
import * as core from "./orders-core.mjs";
const { UserError, STATUS } = core;
const iso = (ms) => new Date(ms).toISOString();
const J = JSON.stringify;
const rowsOf = async (st) => (await st.all()).results;
const sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const GENERIC = "ไม่สามารถบันทึกคำขอได้ กรุณาลองใหม่อีกครั้ง หรือทักเพจ NORX";

// ---------- settings ----------
export async function getSetting(env, key) {
  const r = await env.ORDERS_DB.prepare("SELECT value FROM settings WHERE key=?1").bind(key).first();
  return r ? JSON.parse(r.value) : null;
}
export const putSetting = (env, key, value) => env.ORDERS_DB.prepare("INSERT INTO settings(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, J(value)).run();

// ---------- catalog / rounds -> core shapes ----------
const roundOut = (r) => ({
  id: r.code, dbId: r.id, name: r.name, opensAt: r.opens_at, closesAt: r.closes_at, paymentDue: r.payment_due_at, state: r.status,
  shipping: r.shipping_baht, supplierShipping: r.supplier_shipping_baht, deliveries: JSON.parse(r.deliveries).filter((d) => core.DELIVERY[d]), readyText: r.ready_text, sentAt: r.sent_at,
});
export async function loadConfig(env) {
  const db = env.ORDERS_DB;
  const [prods, vars, sizes, rounds] = await Promise.all([
    rowsOf(db.prepare("SELECT id,slug,name,short_name,fit,fit_name FROM products WHERE status='active' ORDER BY sort,id")),
    rowsOf(db.prepare("SELECT product_id,sleeve,price_baht FROM product_variants WHERE active=1")),
    rowsOf(db.prepare("SELECT product_id,size FROM product_sizes WHERE active=1 ORDER BY sort,id")),
    rowsOf(db.prepare("SELECT * FROM rounds ORDER BY id")),
  ]);
  const products = prods.map((p) => {
    const prices = {};
    for (const sl of ["short", "long"]) { const v = vars.find((x) => x.product_id === p.id && x.sleeve === sl); if (v && Number.isSafeInteger(v.price_baht) && v.price_baht > 0) prices[sl] = v.price_baht; }
    return { id: p.slug, name: p.name, short: p.short_name, fit: p.fit, fitName: p.fit_name, sizes: sizes.filter((x) => x.product_id === p.id).map((x) => x.size), prices };
  }).filter((p) => p.prices.short || p.prices.long);
  if (!products.length) throw new UserError("ยังไม่มีราคาที่เปิดขายในระบบ");
  return { products, rounds: rounds.map(roundOut) };
}

// Weekly rolling rounds (V1 ROLLING_WEEKLY). successor_of is UNIQUE, so concurrent requests create at most one round.
export async function loadConfigRolling(env, now, store) {
  let config = await loadConfig(env);
  const src = store?.rolling ? core.rollingSource(config, now) : null;
  if (!src) return config;
  const n = core.weeklySuccessor(src), at = (x) => iso(Date.parse(x));
  await env.ORDERS_DB.prepare(
    `INSERT OR IGNORE INTO rounds(code,name,opens_at,closes_at,payment_due_at,shipping_baht,supplier_shipping_baht,deliveries,ready_text,status,successor_of)
     VALUES ('ROUND-'||printf('%03d',(SELECT COALESCE(MAX(CAST(SUBSTR(code,7) AS INTEGER)),0)+1 FROM rounds)),?1,?2,?3,?4,?5,?6,?7,?8,'open',?9)`)
    .bind(n.name, at(n.opensAt), at(n.closesAt), at(n.paymentDue), n.shipping, n.supplierShipping, J(n.deliveries), n.readyText, src.dbId).run();
  config = await loadConfig(env);
  return config;
}

export async function publicConfig(env, now) {
  const store = await getSetting(env, "storefront");
  if (!store?.bank) return { ok: false, error: "ระบบสั่งซื้อยังไม่พร้อม กรุณาทักเพจ NORX" };
  const c = await loadConfigRolling(env, now, store);
  const pub = (r) => (r ? { id: r.id, name: r.name, opensAt: r.opensAt, closesAt: r.closesAt, paymentDue: r.paymentDue, shipping: r.shipping, deliveries: r.deliveries, readyText: r.readyText } : null);
  return { ok: true, testOnly: store.liveEnabled !== true, rolling: store.rolling === true, serverNow: now, bank: store.bank, chatUrl: store.chatUrl, pageUrl: store.pageUrl, eventName: store.eventName,
    products: c.products, round: pub(core.currentRound(c, now)), nextRound: pub(core.nextRound(c, now)) };
}

// ---------- orders ----------
const ORDER_SELECT = `SELECT o.*, r.code AS round_code FROM orders o JOIN rounds r ON r.id=o.round_id`;
async function itemsOf(env, orderId) {
  return rowsOf(env.ORDERS_DB.prepare("SELECT i.*, p.slug FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=?1 ORDER BY i.id").bind(orderId));
}
export async function receiptFromRow(env, o) {
  const items = (await itemsOf(env, o.id)).map((i) => ({ product: i.slug, fit: i.fit, sleeve: i.sleeve, size: i.size, qty: i.qty, name: i.product_name, fitName: i.fit_name, unitPrice: i.unit_price_baht, lineTotal: i.line_total_baht }));
  return core.receipt({ id: o.order_no, name: o.customer_name, roundId: o.round_code, items, subtotal: o.subtotal_baht, shipping: o.shipping_baht, total: o.total_baht, round: JSON.parse(o.round_snapshot), status: core.toLegacy(o.payment_status, o.fulfillment_status) });
}
const alertStmt = (env, orderNo, name, phone, q, total, at) => env.ORDERS_DB.prepare(
  `INSERT OR IGNORE INTO notification_queue(order_id,channel,template,payload,next_attempt_at,created_at) SELECT id,'email','order_alert',?2,?3,?3 FROM orders WHERE order_no=?1`)
  .bind(orderNo, J({ orderNo, name, phone, total, items: q.items.map((i) => ({ name: i.name, sleeve: i.sleeve, size: i.size, qty: i.qty })) }), at);

/**
 * Create an order. Never waits for email: the notification is only an outbox row in the same transaction.
 * @returns V1-compatible receipt {ok:true,...} (throws UserError for user-facing problems)
 */
export async function submitOrder(env, raw, { now = Date.now(), ctx } = {}) {
  const t0 = Date.now(), db = env.ORDERS_DB, store = await getSetting(env, "storefront");
  if (!store) throw new UserError("ระบบสั่งซื้อยังไม่พร้อม กรุณาทักเพจ NORX");
  const config = await loadConfigRolling(env, now, store), n = core.normalize(raw, config), fp = await core.fingerprint(n);
  const existing = async () => {
    const o = await db.prepare(ORDER_SELECT + " WHERE o.request_key=?1").bind(n.requestId).first();
    if (!o) return null;
    if (o.fingerprint !== fp) throw new UserError("รหัสคำขอซ้ำกับข้อมูลที่ต่างกัน");
    return o;
  };
  const dupe = await existing();
  if (dupe) { // idempotent replay: same receipt, and make sure the alert exists
    const items = await itemsOf(env, dupe.id);
    await alertStmt(env, dupe.order_no, dupe.customer_name, dupe.customer_phone, { items: items.map((i) => ({ name: i.product_name, sleeve: i.sleeve, size: i.size, qty: i.qty })) }, dupe.total_baht, iso(now)).run();
    return receiptFromRow(env, dupe);
  }
  let isTest = 0;
  if (store.liveEnabled !== true) {
    if (!store.testKeyHash || !raw.testKey || (await sha(String(raw.testKey))) !== store.testKeyHash) throw new UserError("ระบบยังอยู่ในโหมดทดสอบ ยังไม่เปิดรับออเดอร์จริง");
    isTest = 1;
  }
  const q = core.quote(n, config, now);
  if (raw.expectedTotal !== q.total) throw new UserError("ยอดเงินเปลี่ยน กรุณาโหลดหน้าใหม่แล้วตรวจราคาก่อนสั่ง");
  const round = core.currentRound(config, now), at = iso(now), pairs = [...new Set(q.items.map((i) => i.product + "|" + i.sleeve))];

  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNo = "NORX-" + crypto.randomUUID().slice(0, 8).toUpperCase();
    let k = 0; const a = []; const p = (v) => { a.push(v); return "?" + ++k; };
    const priceSql = pairs.map((pr) => { const [slug, sleeve] = pr.split("|"), price = q.items.find((i) => i.product === slug && i.sleeve === sleeve).unitPrice; return `(p.slug=${p(slug)} AND v.sleeve=${p(sleeve)} AND v.price_baht=${p(price)})`; }).join(" OR ");
    // The order row is inserted only if the round is STILL open, shipping and every price are unchanged since quoting.
    const col = [orderNo, n.requestId, fp, n.name, n.phone, n.delivery, q.subtotal, q.shipping, q.total, round.paymentDue ? iso(Date.parse(round.paymentDue)) : at, J(q.round), isTest, isTest ? "ทดสอบ" : ""].map(p), atP = p(at);
    const orderSql = `INSERT INTO orders(order_no,request_key,fingerprint,customer_name,customer_phone,delivery,subtotal_baht,shipping_baht,total_baht,payment_due_at,round_snapshot,is_test,note,created_at,updated_at,source,payment_status,fulfillment_status,round_id)
      SELECT ${col.join(",")},${atP},${atP},'web','pending','received',r.id FROM rounds r
      WHERE r.code=${p(round.id)} AND r.status='open' AND r.opens_at<=${atP} AND r.closes_at>=${atP} AND r.shipping_baht=${p(round.shipping)}
        AND EXISTS (SELECT 1 FROM json_each(r.deliveries) WHERE value=${p(n.delivery)})
        AND (SELECT COUNT(DISTINCT p.slug||'|'||v.sleeve) FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.active=1 AND p.status='active' AND (${priceSql}))=${p(pairs.length)}`;
    const stmts = [db.prepare(orderSql).bind(...a)];
    for (const i of q.items) stmts.push(db.prepare(
      `INSERT INTO order_items(order_id,product_id,sleeve,size,qty,unit_price_baht,line_total_baht,product_name,fit,fit_name)
       VALUES ((SELECT id FROM orders WHERE order_no=?1),(SELECT id FROM products WHERE slug=?2),?3,?4,?5,?6,?7,?8,?9,?10)`).bind(orderNo, i.product, i.sleeve, i.size, i.qty, i.unitPrice, i.lineTotal, i.name, i.fit, i.fitName));
    if (n.delivery === "ship") stmts.push(db.prepare(
      `INSERT INTO shipping_addresses(order_id,recipient,phone,address,postal_code) VALUES ((SELECT id FROM orders WHERE order_no=?1),?2,?3,?4,?5)`)
      .bind(orderNo, n.name, n.phone, n.address, [...n.address.matchAll(/(?<!\d)\d{5}(?!\d)/g)].at(-1)?.[0] ?? null));
    stmts.push(db.prepare(`INSERT INTO order_status_history(order_id,kind,from_status,to_status,actor,at) VALUES ((SELECT id FROM orders WHERE order_no=?1),'legacy',NULL,?2,'customer',?3)`).bind(orderNo, STATUS.PENDING, at));
    stmts.push(alertStmt(env, orderNo, n.name, n.phone, q, q.total, at));
    try {
      await db.batch(stmts); // atomic: order + items + address + history + notification outbox, or nothing
    } catch (e) {
      const m = String(e?.message ?? e);
      if (/UNIQUE constraint failed: orders\.request_key/.test(m)) { const o = await existing(); if (o) return receiptFromRow(env, o); }
      if (/UNIQUE constraint failed: orders\.order_no/.test(m)) continue; // astronomically rare id collision: retry with a new id
      if (/NOT NULL constraint failed: order_items\.order_id/.test(m)) throw new UserError("ราคาหรือรอบสั่งซื้อเปลี่ยน กรุณาโหลดหน้าใหม่แล้วตรวจราคาก่อนสั่ง");
      throw e;
    }
    const ms = Date.now() - t0, log = db.prepare("INSERT INTO latency_log(kind,ref,ms,at) VALUES ('order_creation',?1,?2,?3)").bind(orderNo, ms, iso(Date.now())).run().catch(() => {});
    ctx?.waitUntil ? ctx.waitUntil(log) : await log; // measured separately from notification latency
    return core.receipt({ id: orderNo, name: n.name, roundId: n.roundId, items: q.items, subtotal: q.subtotal, shipping: q.shipping, total: q.total, round: q.round, status: STATUS.PENDING });
  }
  throw new UserError(GENERIC);
}

// ---------- admin: reading ----------
export function legacyOrder(o, items) {
  return { id: o.order_no, roundId: o.round_code, status: core.toLegacy(o.payment_status, o.fulfillment_status), total: o.total_baht,
    items: items.map((i) => ({ product: i.slug, fit: i.fit, sleeve: i.sleeve, size: i.size, qty: i.qty })) };
}
export async function listOrders(env, { round, status, q, limit = 200 } = {}) {
  const where = [], args = [];
  if (round) { where.push("r.code=?"); args.push(round); }
  if (q) { where.push("(o.order_no LIKE ? ESCAPE '\\' OR o.customer_name LIKE ? ESCAPE '\\' OR o.customer_phone LIKE ? ESCAPE '\\')"); const l = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%"; args.push(l, l, l); }
  const rows = await rowsOf(env.ORDERS_DB.prepare(`${ORDER_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY o.created_at DESC, o.id DESC LIMIT ${Math.min(Math.max(+limit | 0, 1), 500)}`).bind(...args));
  const items = await rowsOf(env.ORDERS_DB.prepare("SELECT i.*, p.slug FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id IN (SELECT id FROM orders ORDER BY created_at DESC, id DESC LIMIT 500)"));
  const out = rows.map((o) => ({
    id: o.order_no, roundId: o.round_code, createdAt: o.created_at, name: o.customer_name, phone: o.customer_phone, delivery: o.delivery, subtotal: o.subtotal_baht, shipping: o.shipping_baht, total: o.total_baht,
    status: core.toLegacy(o.payment_status, o.fulfillment_status), moves: core.MOVES[core.toLegacy(o.payment_status, o.fulfillment_status)] ?? [], paymentStatus: o.payment_status, fulfillmentStatus: o.fulfillment_status, isTest: o.is_test === 1, updatedAt: o.updated_at, updatedBy: o.status_updated_by ?? "", note: o.note,
    items: items.filter((i) => i.order_id === o.id).map((i) => ({ product: i.slug, name: i.product_name, fit: i.fit, sleeve: i.sleeve, size: i.size, qty: i.qty })),
  }));
  return status ? out.filter((o) => o.status === status) : out;
}
export async function roundsWithSummary(env, now) {
  const config = await loadConfig(env);
  const orders = await rowsOf(env.ORDERS_DB.prepare(ORDER_SELECT + " ")), items = await rowsOf(env.ORDERS_DB.prepare("SELECT i.*, p.slug FROM order_items i JOIN products p ON p.id=i.product_id"));
  const legacy = orders.map((o) => legacyOrder(o, items.filter((i) => i.order_id === o.id)));
  return { now, config, rounds: config.rounds.map((r) => { const s = core.summary(legacy, r, config); return { ...r, phase: core.phase(r, now), summary: s, shopText: core.shopText(s, r, config) }; }) };
}
// Cheap change token for admin auto-refresh: changes whenever an order, round or notification changes.
export async function pulse(env) {
  const one = (sql) => env.ORDERS_DB.prepare(sql).first();
  const [o, r, n] = await Promise.all([
    one("SELECT COUNT(*) c, COALESCE(MAX(updated_at),'') m FROM orders"),
    one("SELECT COUNT(*) c, COALESCE(MAX(sent_at),'') m, COALESCE(GROUP_CONCAT(status),'') s FROM rounds"),
    one("SELECT SUM(status='queued') q, SUM(status='failed') f, SUM(status='dead') d, SUM(status='sending') s, COALESCE(MAX(sent_at),'') m FROM notification_queue"),
  ]);
  const body = { orders: o.c, notifications: { queued: n.q ?? 0, failed: n.f ?? 0, dead: n.d ?? 0 } };
  return { ...body, token: await sha(J([o, r, n])) };
}

// ---------- admin: status change (V1 setOrderStatus, atomic) ----------
export async function changeStatus(env, actor, { orderNo, from, to, amount, now = Date.now() }) {
  const db = env.ORDERS_DB, o = await db.prepare(ORDER_SELECT + " WHERE o.order_no=?1").bind(String(orderNo)).first();
  if (!o) throw new UserError("ไม่พบออเดอร์ " + orderNo);
  const cur = core.toLegacy(o.payment_status, o.fulfillment_status);
  if (cur === to) return { changed: false }; // V1: same status is a no-op
  const round = (await loadConfig(env)).rounds.find((r) => r.id === o.round_code);
  core.checkTransition({ order: { id: o.order_no, status: cur, total: o.total_baht }, round, from, to, amount });
  const m = core.FROM_LEGACY[to], at = iso(now), paidNow = core.PAID_LIKE.includes(to) && !core.PAID_LIKE.includes(cur);
  const guard = "id=?1 AND payment_status=?2 AND fulfillment_status=?3 AND updated_at=?4"; // optimistic concurrency on the exact row version
  const g = [o.id, o.payment_status, o.fulfillment_status, o.updated_at];
  const stmts = [
    db.prepare(`INSERT INTO order_status_history(order_id,kind,from_status,to_status,actor,at) SELECT id,'legacy',?5,?6,?7,?8 FROM orders WHERE ${guard}`).bind(...g, cur, to, actor, at),
    db.prepare(`INSERT INTO audit_log(actor_hash,action,entity,entity_id,before,after) SELECT ?5,'order.status','orders',?6,?7,?8 FROM orders WHERE ${guard}`).bind(...g, actor, o.order_no, J({ status: cur }), J({ status: to, amount: amount ?? null })),
  ];
  if (paidNow) stmts.push(db.prepare(`INSERT INTO payments(order_id,amount_baht,method,status,recorded_by,created_at) SELECT id,total_baht,?5,'confirmed',?6,?7 FROM orders WHERE ${guard}`).bind(...g, cur === STATUS.LATER ? "on_site" : "bank_transfer", actor, at));
  stmts.push(db.prepare(`UPDATE orders SET payment_status=?5, fulfillment_status=?6, status_updated_at=?7, status_updated_by=?8, updated_at=?9,
      paid_at=CASE WHEN ?10=1 THEN ?7 ELSE paid_at END, received_at=CASE WHEN ?6='completed' THEN ?7 ELSE received_at END WHERE ${guard}`).bind(...g, m.payment, m.fulfillment, at, actor, at > o.updated_at ? at : iso(Date.parse(o.updated_at) + 1), paidNow ? 1 : 0));
  const res = await db.batch(stmts);
  if (res[res.length - 1].meta.changes !== 1) throw new UserError("ออเดอร์ " + orderNo + " ถูกแก้ไขโดยคนอื่นแล้ว กรุณาโหลดใหม่");
  return { changed: true, status: to };
}

// ---------- admin: rounds (V1 save/open/close/cancelUnpaid/sendToShop) ----------
const toIsoInput = (v) => {
  if (!v) return null; const s = String(v);
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(s)) return iso(Date.parse(s + ":00+07:00")); // admin enters Bangkok time
  if (isNaN(Date.parse(s))) throw new UserError("รูปแบบวันเวลาไม่ถูกต้อง");
  return iso(Date.parse(s));
};
function checkOverlap(r, others) {
  for (const o of others) if (o.state === "open" && Date.parse(r.opensAt) <= Date.parse(o.closesAt) && Date.parse(o.opensAt) <= Date.parse(r.closesAt)) throw new UserError("ช่วงเวลาซ้อนกับ " + o.name + " ที่เปิดรับอยู่ กรุณาเลื่อนวัน");
}
export async function saveRound(env, actor, b) {
  const config = await loadConfig(env), name = String(b.name || "").trim();
  if (name.length < 2 || name.length > 60) throw new UserError("กรุณาตั้งชื่อรอบ");
  const o = toIsoInput(b.opensAt), c = toIsoInput(b.closesAt), d = toIsoInput(b.paymentDue);
  if (!o || !c || !d) throw new UserError("กรุณากรอกวันเปิด ปิด และกำหนดโอนให้ครบ");
  if (!(Date.parse(o) < Date.parse(c))) throw new UserError("วันปิดรับต้องหลังวันเปิดรับ");
  if (Date.parse(d) < Date.parse(c)) throw new UserError("กำหนดโอนต้องไม่ก่อนวันปิดรับ");
  const dl = (Array.isArray(b.deliveries) ? b.deliveries : []).filter((x) => core.DELIVERY[x]);
  if (!dl.length) throw new UserError("เลือกวิธีรับสินค้าอย่างน้อย 1 แบบ");
  const ship = Number(b.shipping), sup = Number(b.supplierShipping);
  if (!Number.isSafeInteger(ship) || ship < 0 || ship > 1000 || !Number.isSafeInteger(sup) || sup < 0 || sup > 5000) throw new UserError("ค่าส่งไม่ถูกต้อง");
  const ready = String(b.readyText || "").trim().slice(0, 120);
  if (b.id) {
    const cur = config.rounds.find((r) => r.id === b.id);
    if (!cur) throw new UserError("ไม่พบรอบ");
    if (cur.state === "sent") throw new UserError("รอบที่ส่งร้านแล้วแก้ไม่ได้");
    if (cur.state === "open") checkOverlap({ opensAt: o, closesAt: c }, config.rounds.filter((r) => r.id !== b.id));
    await env.ORDERS_DB.prepare("UPDATE rounds SET name=?2,opens_at=?3,closes_at=?4,payment_due_at=?5,shipping_baht=?6,supplier_shipping_baht=?7,deliveries=?8,ready_text=?9 WHERE code=?1 AND status!='sent'").bind(b.id, name, o, c, d, ship, sup, J(dl), ready).run();
    await audit(env, actor, "round.update", b.id, cur, { name, o, c, d, ship, sup, dl });
    return { id: b.id };
  }
  const r = await env.ORDERS_DB.prepare(`INSERT INTO rounds(code,name,opens_at,closes_at,payment_due_at,shipping_baht,supplier_shipping_baht,deliveries,ready_text,status)
    VALUES ('ROUND-'||printf('%03d',(SELECT COALESCE(MAX(CAST(SUBSTR(code,7) AS INTEGER)),0)+1 FROM rounds)),?1,?2,?3,?4,?5,?6,?7,?8,'draft') RETURNING code`).bind(name, o, c, d, ship, sup, J(dl), ready).first();
  await audit(env, actor, "round.create", r.code, null, { name });
  return { id: r.code };
}
const audit = (env, actor, action, id, before, after) => env.ORDERS_DB.prepare("INSERT INTO audit_log(actor_hash,action,entity,entity_id,before,after) VALUES (?1,?2,'rounds',?3,?4,?5)").bind(actor, action, id, before == null ? null : J(before), after == null ? null : J(after)).run();
const roundOf = (config, code) => config.rounds.find((r) => r.id === code) ?? (() => { throw new UserError("ไม่พบรอบ " + code); })();

export async function openRound(env, actor, code, now = Date.now()) {
  const config = await loadConfig(env), r = roundOf(config, code);
  if (r.state !== "draft" && r.state !== "closed") throw new UserError("รอบนี้เปิดไม่ได้");
  if (Date.parse(r.closesAt) <= now) throw new UserError("วันปิดรับผ่านไปแล้ว กรุณาแก้วันก่อนเปิด");
  checkOverlap(r, config.rounds.filter((x) => x.id !== code));
  const res = await env.ORDERS_DB.prepare("UPDATE rounds SET status='open' WHERE code=?1 AND status IN ('draft','closed')").bind(code).run();
  if (res.meta.changes !== 1) throw new UserError("รอบนี้เปิดไม่ได้");
  await audit(env, actor, "round.open", code, { state: r.state }, { state: "open" });
}
export async function closeRound(env, actor, code) {
  const res = await env.ORDERS_DB.prepare("UPDATE rounds SET status='closed' WHERE code=?1 AND status='open'").bind(code).run();
  if (res.meta.changes !== 1) throw new UserError("รอบนี้ไม่ได้เปิดรับอยู่");
  await audit(env, actor, "round.close", code, { state: "open" }, { state: "closed" });
}
const PENDING_SQL = "payment_status IN ('pending','slip_received') AND fulfillment_status='received'";
export async function cancelUnpaid(env, actor, code, expected, now = Date.now()) {
  const db = env.ORDERS_DB, r = roundOf(await loadConfig(env), code), at = iso(now);
  if (core.phase(r, now) !== "closed") throw new UserError("ต้องปิดรับรอบนี้ก่อน");
  const guard = `round_id=?1 AND ${PENDING_SQL} AND (SELECT COUNT(*) FROM orders WHERE round_id=?1 AND ${PENDING_SQL})=?2`;
  const res = await db.batch([
    db.prepare(`INSERT INTO order_status_history(order_id,kind,from_status,to_status,actor,at,note) SELECT id,'legacy',?3,?4,?5,?6,'ยกเลิก (ไม่โอน)' FROM orders WHERE ${guard}`).bind(r.dbId, Number(expected), STATUS.PENDING, STATUS.CANCEL, actor, at),
    db.prepare(`UPDATE orders SET payment_status='cancelled',fulfillment_status='cancelled',status_updated_at=?3,status_updated_by=?4,updated_at=?3 WHERE ${guard}`).bind(r.dbId, Number(expected), at, actor),
  ]);
  if (res[1].meta.changes !== Number(expected) || !Number(expected)) throw new UserError("จำนวนออเดอร์รอโอนเปลี่ยนไป กรุณาโหลดใหม่");
  await audit(env, actor, "round.cancel_unpaid", code, null, { cancelled: res[1].meta.changes });
  return { cancelled: res[1].meta.changes };
}
// Cut-off: round -> sent; paid orders -> "ส่งร้านแล้ว" (in_production). All-or-nothing; preconditions re-checked in SQL.
export async function sendToShop(env, actor, code, expectedPieces, now = Date.now()) {
  const db = env.ORDERS_DB, config = await loadConfig(env), r = roundOf(config, code), at = iso(now);
  if (core.phase(r, now) !== "closed") throw new UserError("ต้องปิดรับรอบนี้ก่อนตัดยอด");
  const all = await roundsWithSummary(env, now), s = all.rounds.find((x) => x.id === code).summary;
  if (s.pendingOrders) throw new UserError("ยังมีออเดอร์รอโอน " + s.pendingOrders + " รายการ ให้ยืนยันเงินหรือยกเลิกก่อน");
  if (!s.pieces) throw new UserError("รอบนี้ยังไม่มีเสื้อที่ชำระแล้ว");
  if (s.pieces !== Number(expectedPieces)) throw new UserError("ยอดตัวเปลี่ยนไป กรุณาโหลดใหม่");
  const piecesSql = `(SELECT COALESCE(SUM(i.qty),0) FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.round_id=?1 AND (o.payment_status='confirmed' OR o.payment_status='deferred_on_site') AND o.fulfillment_status!='cancelled')`;
  const res = await db.batch([
    db.prepare(`UPDATE rounds SET status='sent', sent_at=?3 WHERE id=?1 AND status IN ('open','closed') AND closes_at<=?3
       AND (SELECT COUNT(*) FROM orders WHERE round_id=?1 AND ${PENDING_SQL})=0 AND ${piecesSql}=?2`).bind(r.dbId, Number(expectedPieces), at),
    db.prepare(`INSERT INTO order_status_history(order_id,kind,from_status,to_status,actor,at) SELECT o.id,'legacy',?3,?4,?5,?6 FROM orders o JOIN rounds r ON r.id=o.round_id WHERE o.round_id=?1 AND r.status='sent' AND r.sent_at=?6 AND o.payment_status='confirmed' AND o.fulfillment_status='received'`).bind(r.dbId, null, STATUS.PAID, STATUS.SENT, actor, at),
    db.prepare(`UPDATE order_items SET production_status='batched' WHERE order_id IN (SELECT o.id FROM orders o JOIN rounds r ON r.id=o.round_id WHERE o.round_id=?1 AND r.status='sent' AND r.sent_at=?2 AND o.payment_status IN ('confirmed','deferred_on_site') AND o.fulfillment_status!='cancelled')`).bind(r.dbId, at),
    db.prepare(`UPDATE orders SET fulfillment_status='in_production', status_updated_at=?2, status_updated_by=?3, updated_at=?2 WHERE round_id=?1 AND payment_status='confirmed' AND fulfillment_status='received' AND (SELECT status FROM rounds WHERE id=?1)='sent'`).bind(r.dbId, at, actor),
  ]);
  if (res[0].meta.changes !== 1) throw new UserError("ยอดตัวหรือสถานะรอบเปลี่ยนไป กรุณาโหลดใหม่");
  await audit(env, actor, "round.send_to_shop", code, { state: r.state }, { state: "sent", pieces: s.pieces });
  return { sent: res[3].meta.changes, pieces: s.pieces };
}
