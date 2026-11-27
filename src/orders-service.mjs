// Orders V2 data layer over D1. Every multi-row change is ONE db.batch() (a transaction), and every
// conditional write re-checks its preconditions inside SQL, so concurrent requests cannot corrupt state.
import * as core from "./orders-core.mjs";
import { toCsv } from "./csv.mjs";
import { newPayToken, hashToken, paymentForReceipt } from "./payments.mjs";
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
    const rotated = await newPayToken(); // the original token cannot be recovered (stored hashed): issue a fresh one to the retrying client
    await db.prepare("UPDATE orders SET tracking_token_hash=?2 WHERE order_no=?1").bind(dupe.order_no, rotated.hash).run();
    const base = await receiptFromRow(env, dupe), pay = await paymentForReceipt(env, dupe.order_no, rotated.token, now);
    return pay ? { ...base, payment: pay } : base;
  }
  let isTest = 0;
  if (store.liveEnabled !== true) {
    if (!store.testKeyHash || !raw.testKey || (await sha(String(raw.testKey))) !== store.testKeyHash) throw new UserError("ระบบยังอยู่ในโหมดทดสอบ ยังไม่เปิดรับออเดอร์จริง");
    isTest = 1;
  }
  const q = core.quote(n, config, now);
  if (raw.expectedTotal !== q.total) throw new UserError("ยอดเงินเปลี่ยน กรุณาโหลดหน้าใหม่แล้วตรวจราคาก่อนสั่ง");
  const pt = await newPayToken(), round = core.currentRound(config, now), at = iso(now), pairs = [...new Set(q.items.map((i) => i.product + "|" + i.sleeve))];

  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNo = "NORX-" + crypto.randomUUID().slice(0, 8).toUpperCase();
    let k = 0; const a = []; const p = (v) => { a.push(v); return "?" + ++k; };
    const priceSql = pairs.map((pr) => { const [slug, sleeve] = pr.split("|"), price = q.items.find((i) => i.product === slug && i.sleeve === sleeve).unitPrice; return `(p.slug=${p(slug)} AND v.sleeve=${p(sleeve)} AND v.price_baht=${p(price)})`; }).join(" OR ");
    // The order row is inserted only if the round is STILL open, shipping and every price are unchanged since quoting.
    const col = [orderNo, n.requestId, fp, n.name, n.phone, n.delivery, q.subtotal, q.shipping, q.total, round.paymentDue ? iso(Date.parse(round.paymentDue)) : at, J(q.round), isTest, isTest ? "ทดสอบ" : "", pt.hash].map(p), atP = p(at);
    const orderSql = `INSERT INTO orders(order_no,request_key,fingerprint,customer_name,customer_phone,delivery,subtotal_baht,shipping_baht,total_baht,payment_due_at,round_snapshot,is_test,note,tracking_token_hash,created_at,updated_at,source,payment_status,fulfillment_status,round_id)
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
    const receipt = core.receipt({ id: orderNo, name: n.name, roundId: n.roundId, items: q.items, subtotal: q.subtotal, shipping: q.shipping, total: q.total, round: q.round, status: STATUS.PENDING });
    const pay = await paymentForReceipt(env, orderNo, pt.token, now); // extra field; null unless the owner has verified a PromptPay ID
    return pay ? { ...receipt, payment: pay } : receipt;
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
export async function changeStatus(env, actor, { orderNo, from, to, amount, bankTxnRef, now = Date.now() }) {
  const db = env.ORDERS_DB, o = await db.prepare(ORDER_SELECT + " WHERE o.order_no=?1").bind(String(orderNo)).first();
  if (!o) throw new UserError("ไม่พบออเดอร์ " + orderNo);
  const cur = core.toLegacy(o.payment_status, o.fulfillment_status);
  if (cur === to) return { changed: false }; // V1: same status is a no-op
  const round = (await loadConfig(env)).rounds.find((r) => r.id === o.round_code);
  core.checkTransition({ order: { id: o.order_no, status: cur, total: o.total_baht }, round, from, to, amount });
  const txn = bankTxnRef === undefined || bankTxnRef === null || bankTxnRef === "" ? null : String(bankTxnRef).trim();
  if (txn !== null && !/^[A-Za-z0-9._-]{4,40}$/.test(txn)) throw new UserError("เลขอ้างอิงรายการโอนไม่ถูกต้อง (ใช้ A-Z 0-9 . _ - ความยาว 4–40)");
  if (txn !== null) { const used = await db.prepare("SELECT o.order_no n FROM payments y JOIN orders o ON o.id=y.order_id WHERE y.bank_txn_ref=?1 AND y.status='confirmed' AND y.order_id!=?2").bind(txn, o.id).first(); if (used) throw new UserError("รายการโอนนี้ถูกใช้ยืนยันออเดอร์อื่นแล้ว (" + used.n + ") ป้องกันการยืนยันซ้ำ"); }
  const m = core.FROM_LEGACY[to], at = iso(now), paidNow = core.PAID_LIKE.includes(to) && !core.PAID_LIKE.includes(cur), leavingPaid = core.PAID_LIKE.includes(cur) && !core.PAID_LIKE.includes(to);
  const guard = "id=?1 AND payment_status=?2 AND fulfillment_status=?3 AND updated_at=?4"; // optimistic concurrency on the exact row version
  const g = [o.id, o.payment_status, o.fulfillment_status, o.updated_at];
  const stmts = [
    db.prepare(`INSERT INTO order_status_history(order_id,kind,from_status,to_status,actor,at) SELECT id,'legacy',?5,?6,?7,?8 FROM orders WHERE ${guard}`).bind(...g, cur, to, actor, at),
    db.prepare(`INSERT INTO audit_log(actor_hash,action,entity,entity_id,before,after) SELECT ?5,'order.status','orders',?6,?7,?8 FROM orders WHERE ${guard}`).bind(...g, actor, o.order_no, J({ status: cur }), J({ status: to, amount: amount ?? null })),
  ];
  // Undo / cancel of a paid order VOIDS its confirmed payment (kept for history), so a later re-confirm records exactly one new payment.
  if (leavingPaid) stmts.push(db.prepare(`UPDATE payments SET status='void', voided_at=?5, void_reason=?6 WHERE status='confirmed' AND order_id IN (SELECT id FROM orders WHERE ${guard})`).bind(...g, at, cur + " → " + to));
  if (paidNow) stmts.push(db.prepare(`INSERT INTO payments(order_id,amount_baht,method,status,recorded_by,created_at,request_id,provider,bank_txn_ref,verified_at,verified_by) SELECT id,total_baht,?5,'confirmed',?6,?7,(SELECT id FROM payment_requests WHERE order_id=orders.id),COALESCE((SELECT provider FROM payment_requests WHERE order_id=orders.id),'manual'),?8,?7,?6 FROM orders WHERE ${guard}`).bind(...g, cur === STATUS.LATER ? "on_site" : "bank_transfer", actor, at, txn));
  const newUpdated = at > o.updated_at ? at : iso(Date.parse(o.updated_at) + 1);
  stmts.push(db.prepare(`UPDATE orders SET payment_status=?5, fulfillment_status=?6, status_updated_at=?7, status_updated_by=?8, updated_at=?9,
      paid_at=CASE WHEN ?10=1 THEN ?7 ELSE paid_at END, received_at=CASE WHEN ?6='completed' THEN ?7 ELSE received_at END WHERE ${guard}`).bind(...g, m.payment, m.fulfillment, at, actor, newUpdated, paidNow ? 1 : 0));
  const ordersUpdateIdx = stmts.length - 1;
  // Keep the payment request in step with the order. A QR / slip never causes this; only the owner's status change does.
  const reqStatus = { confirmed: "verified", pending: "awaiting", deferred_on_site: "awaiting", cancelled: "cancelled" }[m.payment] ?? "awaiting", ver = reqStatus === "verified";
  const applied = "EXISTS (SELECT 1 FROM orders WHERE id=?1 AND updated_at=?2)";
  stmts.push(db.prepare(`UPDATE payment_requests SET status=?3, verified_at=?4, verified_by=?5, bank_txn_ref=?6, updated_at=?7 WHERE order_id=?1 AND status!='expired' AND ${applied}`).bind(o.id, newUpdated, reqStatus, ver ? at : null, ver ? actor : null, ver ? txn : null, at));
  stmts.push(db.prepare(`INSERT INTO payment_events(request_id,at,event,detail) SELECT id,?3,?4,?5 FROM payment_requests WHERE order_id=?1 AND ${applied}`).bind(o.id, newUpdated, at, ver ? "verified_by_owner" : reqStatus === "cancelled" ? "cancelled" : "reopened", ver ? (txn ? "bank_txn_ref_recorded" : "no_bank_txn_ref") : cur + " → " + to));
  let res;
  try { res = await db.batch(stmts); } catch (e) {
    if (/UNIQUE constraint failed: payments\.bank_txn_ref|UNIQUE constraint failed: payment_requests\.bank_txn_ref|uq_payreq_bank_txn|uq_payment_bank_txn/.test(String(e?.message))) throw new UserError("รายการโอนนี้ถูกใช้ยืนยันออเดอร์อื่นแล้ว ป้องกันการยืนยันซ้ำ");
    if (/UNIQUE constraint failed: payments\.order_id/.test(String(e?.message))) throw new UserError("ข้อมูลการชำระเงินของออเดอร์นี้ไม่สอดคล้อง กรุณาตรวจที่หน้าความถูกต้องของข้อมูล");
    throw e;
  }
  if (res[ordersUpdateIdx].meta.changes !== 1) throw new UserError("ออเดอร์ " + orderNo + " ถูกแก้ไขโดยคนอื่นแล้ว กรุณาโหลดใหม่");
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
    db.prepare(`UPDATE payment_requests SET status='cancelled', updated_at=?2 WHERE status IN ('awaiting','slip_received') AND order_id IN (SELECT id FROM orders WHERE round_id=?1 AND payment_status='cancelled' AND status_updated_at=?2)`).bind(r.dbId, at),
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
    db.prepare(`UPDATE rounds SET status='sent', sent_at=?3 WHERE id=?1 AND (status='closed' OR (status='open' AND closes_at<=?3))
       AND (SELECT COUNT(*) FROM orders WHERE round_id=?1 AND ${PENDING_SQL})=0 AND ${piecesSql}=?2`).bind(r.dbId, Number(expectedPieces), at),
    db.prepare(`INSERT INTO order_status_history(order_id,kind,from_status,to_status,actor,at) SELECT o.id,'legacy',?3,?4,?5,?6 FROM orders o JOIN rounds r ON r.id=o.round_id WHERE o.round_id=?1 AND r.status='sent' AND r.sent_at=?6 AND o.payment_status='confirmed' AND o.fulfillment_status='received'`).bind(r.dbId, null, STATUS.PAID, STATUS.SENT, actor, at),
    db.prepare(`UPDATE order_items SET production_status='batched' WHERE order_id IN (SELECT o.id FROM orders o JOIN rounds r ON r.id=o.round_id WHERE o.round_id=?1 AND r.status='sent' AND r.sent_at=?2 AND o.payment_status IN ('confirmed','deferred_on_site') AND o.fulfillment_status!='cancelled')`).bind(r.dbId, at),
    db.prepare(`UPDATE orders SET fulfillment_status='in_production', status_updated_at=?2, status_updated_by=?3, updated_at=?2 WHERE round_id=?1 AND payment_status='confirmed' AND fulfillment_status='received' AND (SELECT status FROM rounds WHERE id=?1)='sent'`).bind(r.dbId, at, actor),
  ]);
  if (res[0].meta.changes !== 1) throw new UserError("ยอดตัวหรือสถานะรอบเปลี่ยนไป กรุณาโหลดใหม่");
  await audit(env, actor, "round.send_to_shop", code, { state: r.state }, { state: "sent", pieces: s.pieces });
  return { sent: res[3].meta.changes, pieces: s.pieces };
}

/**
 * Payment integrity audit: every paid-like order (ชำระแล้ว/ส่งร้านแล้ว/ส่งมอบแล้ว) has exactly one confirmed payment
 * equal to its total; every other order has none. Returns violations (empty = healthy).
 */
export async function paymentIntegrity(env) {
  const rows = await rowsOf(env.ORDERS_DB.prepare(
    `SELECT o.order_no, o.total_baht, o.payment_status, o.fulfillment_status,
            (SELECT COUNT(*) FROM payments p WHERE p.order_id=o.id AND p.status='confirmed') AS n,
            (SELECT COALESCE(SUM(amount_baht),0) FROM payments p WHERE p.order_id=o.id AND p.status='confirmed') AS amt FROM orders o`));
  const out = [];
  for (const r of rows) {
    const paid = core.PAID_LIKE.includes(core.toLegacy(r.payment_status, r.fulfillment_status));
    if (paid && (r.n !== 1 || r.amt !== r.total_baht)) out.push({ order: r.order_no, problem: "paid order must have exactly one confirmed payment equal to total", confirmed: r.n, amount: r.amt, total: r.total_baht });
    if (!paid && r.n > 0) out.push({ order: r.order_no, problem: "unpaid order has a confirmed payment", confirmed: r.n, amount: r.amt });
  }
  return out;
}

// ======================= Phase 03: dashboard, production, exports =======================
const T = (includeTest) => (includeTest ? "1=1" : "o.is_test=0");
const PAIDLIKE_SQL = "(o.payment_status='confirmed' AND o.fulfillment_status!='cancelled')";

/** Overview: the work that needs the owner today. `includeTest` shows synthetic/test orders (staging). */
export async function dashboard(env, { now = Date.now(), includeTest = false } = {}) {
  const db = env.ORDERS_DB, w = T(includeTest), one = (sql, ...a) => db.prepare(sql).bind(...a).first(), all = (sql, ...a) => rowsOf(db.prepare(sql).bind(...a));
  const [pend, pendList, prod, prodByRound, ship, pickup, notif] = await Promise.all([
    one(`SELECT COUNT(*) n, COALESCE(SUM(o.total_baht),0) amt FROM orders o WHERE ${w} AND o.payment_status IN ('pending','slip_received') AND o.fulfillment_status='received'`),
    all(`SELECT o.order_no id, o.customer_name name, o.total_baht total, o.created_at createdAt, r.code round FROM orders o JOIN rounds r ON r.id=o.round_id WHERE ${w} AND o.payment_status IN ('pending','slip_received') AND o.fulfillment_status='received' ORDER BY o.created_at LIMIT 5`),
    one(`SELECT COUNT(DISTINCT o.id) orders, COALESCE(SUM(i.qty),0) pieces FROM orders o JOIN rounds r ON r.id=o.round_id JOIN order_items i ON i.order_id=o.id WHERE ${w} AND r.status!='sent' AND o.fulfillment_status='received' AND o.payment_status IN ('confirmed','deferred_on_site')`),
    all(`SELECT r.code, r.name, r.closes_at closesAt, COALESCE(SUM(i.qty),0) pieces, COUNT(DISTINCT o.id) orders FROM orders o JOIN rounds r ON r.id=o.round_id JOIN order_items i ON i.order_id=o.id WHERE ${w} AND r.status!='sent' AND o.fulfillment_status='received' AND o.payment_status IN ('confirmed','deferred_on_site') GROUP BY r.id ORDER BY r.id DESC`),
    one(`SELECT COUNT(*) n FROM orders o LEFT JOIN shipments s ON s.order_id=o.id WHERE ${w} AND o.delivery='ship' AND o.payment_status='confirmed' AND o.fulfillment_status IN ('in_production','qc','ready_ship') AND s.shipped_at IS NULL`),
    one(`SELECT COUNT(*) n FROM orders o WHERE ${w} AND o.delivery IN ('city','event') AND o.payment_status IN ('confirmed','deferred_on_site') AND o.fulfillment_status IN ('in_production','qc','ready_pickup')`),
    one(`SELECT COALESCE(SUM(status='queued'),0) queued, COALESCE(SUM(status IN ('failed','sending')),0) failed, COALESCE(SUM(status='dead'),0) dead FROM notification_queue WHERE status!='sent'`),
  ]);
  const shipList = await all(`SELECT o.order_no id, a.recipient name, o.total_baht total FROM orders o LEFT JOIN shipping_addresses a ON a.order_id=o.id LEFT JOIN shipments s ON s.order_id=o.id WHERE ${w} AND o.delivery='ship' AND o.payment_status='confirmed' AND o.fulfillment_status IN ('in_production','qc','ready_ship') AND s.shipped_at IS NULL ORDER BY o.created_at LIMIT 5`);
  const config = await loadConfig(env).catch(() => ({ rounds: [] }));
  const accepting = core.currentRound(config, now), live = accepting || config.rounds.filter((r) => r.state !== "draft").at(-1) || null;
  let round = null;
  if (live) { const all2 = await roundsWithSummary(env, now); const r = all2.rounds.find((x) => x.id === live.id); round = { code: r.id, name: r.name, phase: r.phase, closesAt: r.closesAt, summary: r.summary }; }
  const violations = (await paymentIntegrity(env)).length;
  return {
    awaitingPayment: { count: pend.n, amount: pend.amt, oldest: pendList },
    readyForProduction: { orders: prod.orders, pieces: prod.pieces, rounds: prodByRound },
    awaitingShipment: { count: ship.n, orders: shipList }, awaitingHandover: { count: pickup.n },
    notifications: { queued: notif.queued, failed: notif.failed, dead: notif.dead },
    round, integrityViolations: violations, includeTest,
    events: null, // Events live in a separate system/DB (kept isolated); shown as a link, not read from here
  };
}

/** Production summary: quantities by collection/product/fit/sleeve/size, split by payment state. Production = paid + on-site; pending shown for information. */
export async function productionSummary(env, { round = "", includeTest = false } = {}) {
  const args = [], where = [T(includeTest)];
  if (round && round !== "all") { where.push("r.code=?"); args.push(round); }
  const sum = (cond) => `COALESCE(SUM(CASE WHEN ${cond} THEN i.qty END),0)`;
  const live = "o.payment_status IN ('confirmed','deferred_on_site')";
  const raw = await rowsOf(env.ORDERS_DB.prepare(
    `SELECT r.code round, COALESCE(c.name,'—') collection, p.slug product, p.name productName, p.fit_name fitName, p.sort psort, i.sleeve, i.size,
        (SELECT sort FROM product_sizes ps WHERE ps.product_id=p.id AND ps.size=i.size) ssort,
        ${sum("o.payment_status='confirmed'")} paid, ${sum("o.payment_status='deferred_on_site'")} deferred, ${sum("o.payment_status IN ('pending','slip_received')")} pending,
        ${sum(live + " AND i.production_status='pending'")} s_pending, ${sum(live + " AND i.production_status='batched'")} s_batched,
        ${sum(live + " AND i.production_status='produced'")} s_produced, ${sum(live + " AND i.production_status='received'")} s_received
     FROM order_items i JOIN orders o ON o.id=i.order_id JOIN rounds r ON r.id=o.round_id JOIN products p ON p.id=i.product_id LEFT JOIN collections c ON c.id=p.collection_id
     WHERE ${where.join(" AND ")} AND o.fulfillment_status!='cancelled' AND o.payment_status!='cancelled' GROUP BY r.id, p.id, i.sleeve, i.size`).bind(...args));
  const rows = raw.map((r) => ({ round: r.round, collection: r.collection, product: r.product, productName: r.productName, fitName: r.fitName, sleeve: r.sleeve, size: r.size, production: r.paid + r.deferred, paid: r.paid, deferred: r.deferred, pending: r.pending,
      status: { pending: r.s_pending, batched: r.s_batched, produced: r.s_produced, received: r.s_received }, _k: [r.round, r.psort, r.sleeve === "short" ? 0 : 1, r.ssort ?? 99] }))
    .filter((r) => r.production + r.pending > 0).sort((a, b) => { for (let i = 0; i < 4; i++) { if (a._k[i] < b._k[i]) return -1; if (a._k[i] > b._k[i]) return 1; } return 0; });
  for (const r of rows) delete r._k;
  const t = rows.reduce((n, r) => ({ production: n.production + r.production, paid: n.paid + r.paid, deferred: n.deferred + r.deferred, pending: n.pending + r.pending,
    status: Object.fromEntries(["pending", "batched", "produced", "received"].map((k) => [k, n.status[k] + r.status[k]])) }), { production: 0, paid: 0, deferred: 0, pending: 0, status: { pending: 0, batched: 0, produced: 0, received: 0 } });
  return { round: round || "all", rows, totals: t };
}
export function productionCsv(sum) {
  return toCsv([["รอบ", "Collection", "รุ่น", "ทรง", "แขน", "ไซส์", "ผลิต (ชำระแล้ว+จ่ายหน้างาน)", "ชำระแล้ว", "จ่ายหน้างาน (ยังไม่ชำระ)", "รอโอน (ไม่นับผลิต)", "รอส่งร้าน", "ส่งร้านแล้ว", "ผลิตเสร็จ", "รับของแล้ว"],
    ...sum.rows.map((r) => [r.round, r.collection, r.productName, r.fitName, core.sleeveName(r.sleeve), r.size, r.production, r.paid, r.deferred, r.pending, r.status.pending, r.status.batched, r.status.produced, r.status.received]),
    ["", "", "", "", "", "รวม", sum.totals.production, sum.totals.paid, sum.totals.deferred, sum.totals.pending, sum.totals.status.pending, sum.totals.status.batched, sum.totals.status.produced, sum.totals.status.received]]);
}

// Batch update of production status for a lot (V1 had none). Only after cut-off (round "sent"); atomic; guarded by the piece count the admin saw.
export const ITEM_MOVES = { batched: ["produced"], produced: ["batched", "received"], received: ["produced"] };
export async function setItemsStatus(env, actor, { round, from, to, product = null, sleeve = null, size = null, expected, now = Date.now() }) {
  if (!(ITEM_MOVES[from] || []).includes(to)) throw new UserError("เปลี่ยนสถานะการผลิตจาก " + from + " เป็น " + to + " ไม่ได้");
  if (sleeve && !["short", "long"].includes(sleeve)) throw new UserError("แขนไม่ถูกต้อง");
  if (!Number.isSafeInteger(expected) || expected < 1) throw new UserError("จำนวนที่คาดหวังไม่ถูกต้อง");
  const r = roundOf(await loadConfig(env), round);
  if (r.state !== "sent") throw new UserError("ต้องตัดยอดส่งร้านก่อน จึงจะอัปเดตสถานะการผลิตได้");
  const db = env.ORDERS_DB, at = iso(now);
  const cond = `i.production_status=?2 AND o.round_id=?1 AND o.payment_status IN ('confirmed','deferred_on_site') AND o.fulfillment_status!='cancelled' AND (?4 IS NULL OR i.sleeve=?4) AND (?5 IS NULL OR i.size=?5) AND (?6 IS NULL OR i.product_id=(SELECT id FROM products WHERE slug=?6))`;
  const piecesSql = `(SELECT COALESCE(SUM(i.qty),0) FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${cond})`;
  const res = await db.batch([
    db.prepare(`UPDATE order_items SET production_status=?3 WHERE id IN (SELECT i.id FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${cond}) AND ${piecesSql}=?7`).bind(r.dbId, from, to, sleeve, size, product, expected),
  ]);
  if (res[0].meta.changes < 1) throw new UserError("จำนวนชิ้นเปลี่ยนไปจากที่เห็น กรุณาโหลดใหม่");
  await audit(env, actor, "production.items_status", round, { from, product, sleeve, size }, { to, pieces: expected, rows: res[0].meta.changes });
  return { rows: res[0].meta.changes, pieces: expected };
}

export async function ordersCsv(env, actor, { round, status, includeTest = true } = {}) {
  const list = (await listOrders(env, { round, status, limit: 500 })).filter((o) => includeTest || !o.isTest);
  const addr = new Map((await rowsOf(env.ORDERS_DB.prepare("SELECT o.order_no n, a.address a FROM shipping_addresses a JOIN orders o ON o.id=a.order_id"))).map((r) => [r.n, r.a]));
  const csv = toCsv([["เลขออเดอร์", "สั่งเมื่อ", "รอบ", "ชื่อ", "เบอร์โทร", "วิธีรับ", "ที่อยู่จัดส่ง", "รายการ", "ค่าเสื้อ", "ค่าส่ง", "ยอดรวม", "สถานะ", "สถานะชำระเงิน", "สถานะจัดส่ง", "ออเดอร์ทดสอบ", "หมายเหตุ"],
    ...list.map((o) => [o.id, o.createdAt, o.roundId, o.name, o.phone, core.DELIVERY[o.delivery], addr.get(o.id) ?? "", o.items.map((i) => i.name + " " + core.sleeveName(i.sleeve) + " " + i.size + "×" + i.qty).join("; "), o.subtotal, o.shipping, o.total, o.status, o.paymentStatus, o.fulfillmentStatus, o.isTest ? "ใช่" : "", o.note])]);
  await audit(env, actor, "export.orders", round || "all", null, { rows: list.length });
  return csv;
}
