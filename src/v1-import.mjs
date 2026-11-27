// Orders V1 (Google Sheets) -> V2 import planning, statement building and reconciliation.
// Pure + D1-agnostic. Reads rows exported from the V1 "ติดตามออเดอร์"/"รอบพรีออเดอร์" sheets (a local, private export:
// never commit real exports). Fail-closed: any unknown status, bad money or duplicate stops the plan (errors[]).
import { STATUS, FROM_LEGACY, legacyStatus, toLegacy, DELIVERY } from "./orders-core.mjs";

// V1 column order (SHEETS.orders.head / SHEETS.rounds.head)
export const ORDER_COLS = ["id", "requestId", "fingerprint", "createdAt", "roundId", "name", "phone", "delivery", "address", "subtotal", "shipping", "total", "status", "updatedAt", "updatedBy", "details", "note"];
export const ROUND_COLS = ["id", "name", "opensAt", "closesAt", "paymentDue", "state", "shipping", "supplierShipping", "deliveries", "readyText", "sentAt"];
const ROUND_STATE = { เปิดรับ: "open", ฉบับร่าง: "draft", ปิดรับ: "closed", ส่งร้านแล้ว: "sent" };
const row = (cols, r) => (Array.isArray(r) ? Object.fromEntries(cols.map((c, i) => [c, r[i]])) : r);
const unsafe = (s) => String(s ?? "").replace(/^'/, ""); // V1 prefixes "'" to defuse spreadsheet formulas
const iso = (v) => { const t = Date.parse(v instanceof Date ? v.toISOString() : String(v)); if (Number.isNaN(t)) throw new Error("bad date: " + v); return new Date(t).toISOString(); };

export function planImport({ rounds = [], orders = [], knownProducts = [], existingOrderNos = new Set() }) {
  const errors = [], warnings = [], plan = { rounds: [], orders: [] }, seenId = new Set(), seenReq = new Set(), codes = new Set();
  const err = (id, m) => errors.push({ id, error: m });
  for (const rr of rounds) {
    const r = row(ROUND_COLS, rr);
    try {
      const state = ROUND_STATE[r.state]; if (!state) throw new Error("unknown round state " + r.state);
      const deliveries = String(r.deliveries || "city,ship").split(",").map((s) => s.trim()).filter((d) => DELIVERY[d]);
      plan.rounds.push({ code: String(r.id), name: String(r.name), opens_at: iso(r.opensAt), closes_at: iso(r.closesAt), payment_due_at: iso(r.paymentDue), status: state, shipping_baht: Number(r.shipping) || 0,
        supplier_shipping_baht: Number(r.supplierShipping) || 0, deliveries, ready_text: String(r.readyText || ""), sent_at: r.sentAt ? iso(r.sentAt) : null });
      codes.add(String(r.id));
    } catch (e) { err(String(r.id), e.message); }
  }
  for (const rr of orders) {
    const o = row(ORDER_COLS, rr), id = String(o.id);
    try {
      if (!id) throw new Error("missing order id");
      if (seenId.has(id)) throw new Error("duplicate order id in export");
      seenId.add(id);
      if (!/^NORX-[0-9A-F]{8}$/.test(id)) warnings.push({ id, warning: "order id does not match NORX-XXXXXXXX (kept as is)" });
      if (o.requestId) { if (seenReq.has(o.requestId)) throw new Error("duplicate requestId in export"); seenReq.add(o.requestId); }
      const legacy = legacyStatus(o.status), m = FROM_LEGACY[legacy];
      if (!m) throw new Error("unknown V1 status: " + JSON.stringify(o.status));
      const d = typeof o.details === "string" ? JSON.parse(o.details || "{}") : o.details || {};
      if (!Array.isArray(d.items) || !d.items.length) throw new Error("order has no items");
      const subtotal = Number(o.subtotal), shipping = Number(o.shipping), total = Number(o.total);
      if (![subtotal, shipping, total].every(Number.isSafeInteger) || total !== subtotal + shipping) throw new Error("money mismatch (total != subtotal + shipping)");
      let sum = 0;
      const items = d.items.map((i) => {
        if (!knownProducts.includes(i.product)) throw new Error("unknown product " + i.product);
        if (!Number.isSafeInteger(i.qty) || i.qty < 1 || i.qty > 99 || !Number.isSafeInteger(i.unitPrice) || i.unitPrice < 1 || i.lineTotal !== i.qty * i.unitPrice) throw new Error("bad line item");
        sum += i.lineTotal; return { product: i.product, fit: i.fit, sleeve: i.sleeve, size: i.size, qty: i.qty, unit_price_baht: i.unitPrice, line_total_baht: i.lineTotal, product_name: i.name, fit_name: i.fitName };
      });
      if (sum !== subtotal) throw new Error("items do not add up to subtotal");
      if (!DELIVERY[o.delivery]) throw new Error("unknown delivery " + o.delivery);
      if (!d.round && !o.roundId) throw new Error("no round");
      plan.orders.push({
        order_no: id, request_key: o.requestId || null, fingerprint: o.fingerprint || null, created_at: iso(o.createdAt), round_code: String(o.roundId), customer_name: unsafe(o.name), customer_phone: unsafe(o.phone),
        delivery: o.delivery, address: unsafe(o.address), subtotal_baht: subtotal, shipping_baht: shipping, total_baht: total, payment_status: m.payment, fulfillment_status: m.fulfillment, legacy_status: legacy,
        payment_due_at: d.round?.paymentDue ? iso(d.round.paymentDue) : null, round_snapshot: d.round ?? null, note: String(o.note || ""), is_test: String(o.note || "") === "ทดสอบ" ? 1 : 0,
        updated_at: o.updatedAt ? iso(o.updatedAt) : iso(o.createdAt), updated_by: o.updatedBy || null, items, already: existingOrderNos.has(id),
      });
    } catch (e) { err(id, e.message); }
  }
  const known = new Set([...codes]); for (const o of plan.orders) if (!known.has(o.round_code)) warnings.push({ id: o.order_no, warning: "round " + o.round_code + " not in this export (must already exist in V2)" });
  return { plan, errors, warnings, ok: errors.length === 0 };
}

/** Idempotent statements: rounds by code, orders by order_no (ON CONFLICT DO NOTHING). One batch (transaction) per order. */
export function buildStatements(db, plan) {
  const out = plan.rounds.map((r) => [db.prepare(`INSERT INTO rounds(code,name,opens_at,closes_at,payment_due_at,shipping_baht,supplier_shipping_baht,deliveries,ready_text,status,sent_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(code) DO NOTHING`)
    .bind(r.code, r.name, r.opens_at, r.closes_at, r.payment_due_at, r.shipping_baht, r.supplier_shipping_baht, JSON.stringify(r.deliveries), r.ready_text, r.status, r.sent_at)]);
  for (const o of plan.orders) {
    const s = [db.prepare(`INSERT INTO orders(order_no,request_key,fingerprint,round_id,customer_name,customer_phone,source,delivery,subtotal_baht,shipping_baht,total_baht,payment_status,fulfillment_status,payment_due_at,note,round_snapshot,is_test,legacy_ref,status_updated_by,created_at,updated_at)
      SELECT ?1,?2,?3,r.id,?4,?5,'v1_import',?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19 FROM rounds r WHERE r.code=?20 ON CONFLICT(order_no) DO NOTHING`)
      .bind(o.order_no, o.request_key, o.fingerprint, o.customer_name, o.customer_phone, o.delivery, o.subtotal_baht, o.shipping_baht, o.total_baht, o.payment_status, o.fulfillment_status, o.payment_due_at, o.note,
        o.round_snapshot ? JSON.stringify(o.round_snapshot) : null, o.is_test, "v1:" + o.order_no, o.updated_by, o.created_at, o.updated_at, o.round_code)];
    // child rows only when THIS run inserted the order (legacy_ref + source tell us); re-runs insert nothing
    for (const i of o.items) s.push(db.prepare(`INSERT OR IGNORE INTO order_items(order_id,product_id,sleeve,size,qty,unit_price_baht,line_total_baht,product_name,fit,fit_name,production_status)
      SELECT o.id,(SELECT id FROM products WHERE slug=?2),?3,?4,?5,?6,?7,?8,?9,?10,?11 FROM orders o WHERE o.order_no=?1 AND o.source='v1_import'`)
      .bind(o.order_no, i.product, i.sleeve, i.size, i.qty, i.unit_price_baht, i.line_total_baht, i.product_name, i.fit, i.fit_name, o.fulfillment_status === "in_production" || o.fulfillment_status === "completed" ? "batched" : "pending"));
    if (o.delivery === "ship") s.push(db.prepare(`INSERT OR IGNORE INTO shipping_addresses(order_id,recipient,phone,address,postal_code) SELECT id,?2,?3,?4,?5 FROM orders WHERE order_no=?1 AND source='v1_import'`)
      .bind(o.order_no, o.customer_name, o.customer_phone, o.address, [...o.address.matchAll(/(?<!\d)\d{5}(?!\d)/g)].at(-1)?.[0] ?? null));
    s.push(db.prepare(`INSERT INTO order_status_history(order_id,kind,from_status,to_status,actor,at,note) SELECT id,'legacy',NULL,?2,'v1_import',?3,'imported from Orders V1' FROM orders WHERE order_no=?1 AND source='v1_import' AND NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id=orders.id)`).bind(o.order_no, o.legacy_status, o.updated_at));
    out.push(s);
  }
  return out;
}
export async function runImport(db, plan, { dryRun = true } = {}) {
  const groups = buildStatements(db, plan); if (dryRun) return { dryRun: true, groups: groups.length };
  for (const g of groups) await db.batch(g);
  return { dryRun: false, groups: groups.length };
}

/** Compare the V1 plan against what is now in V2: counts, pieces, money, status, recipient and shipping fields. */
export async function reconcile(db, plan) {
  const diffs = [], sum = (a, f) => a.reduce((n, x) => n + f(x), 0);
  const rows = (await db.prepare("SELECT o.*, r.code AS round_code FROM orders o JOIN rounds r ON r.id=o.round_id WHERE o.source='v1_import'").all()).results;
  const items = (await db.prepare("SELECT i.*, o.order_no FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.source='v1_import'").all()).results;
  const addr = (await db.prepare("SELECT a.*, o.order_no FROM shipping_addresses a JOIN orders o ON o.id=a.order_id WHERE o.source='v1_import'").all()).results;
  const want = plan.orders, by = new Map(rows.map((r) => [r.order_no, r]));
  const check = (k, a, b) => { if (a !== b) diffs.push({ check: k, v1: a, v2: b }); };
  check("order count", want.length, rows.length);
  check("piece count", sum(want, (o) => sum(o.items, (i) => i.qty)), sum(items, (i) => i.qty));
  check("subtotal sum", sum(want, (o) => o.subtotal_baht), sum(rows, (r) => r.subtotal_baht));
  check("shipping sum", sum(want, (o) => o.shipping_baht), sum(rows, (r) => r.shipping_baht));
  check("total sum", sum(want, (o) => o.total_baht), sum(rows, (r) => r.total_baht));
  const stat = (arr) => { const m = {}; for (const s of arr) m[s] = (m[s] || 0) + 1; return JSON.stringify(Object.entries(m).sort()); };
  check("status counts", stat(want.map((o) => o.legacy_status)), stat(rows.map((r) => toLegacy(r.payment_status, r.fulfillment_status))));
  for (const o of want) {
    const r = by.get(o.order_no); if (!r) { diffs.push({ order: o.order_no, check: "missing in V2" }); continue; }
    for (const [k, a, b] of [["status", o.legacy_status, toLegacy(r.payment_status, r.fulfillment_status)], ["name", o.customer_name, r.customer_name], ["phone", o.customer_phone, r.customer_phone], ["delivery", o.delivery, r.delivery],
      ["total", o.total_baht, r.total_baht], ["requestId", o.request_key, r.request_key], ["fingerprint", o.fingerprint, r.fingerprint], ["created_at", o.created_at, r.created_at], ["round", o.round_code, r.round_code]])
      if (a !== b) diffs.push({ order: o.order_no, check: k, v1: a, v2: b });
    const its = items.filter((i) => i.order_no === o.order_no);
    if (JSON.stringify(o.items.map((i) => [i.sleeve, i.size, i.qty, i.unit_price_baht]).sort()) !== JSON.stringify(its.map((i) => [i.sleeve, i.size, i.qty, i.unit_price_baht]).sort())) diffs.push({ order: o.order_no, check: "items" });
    if (o.delivery === "ship") { const a = addr.find((x) => x.order_no === o.order_no); if (!a || a.address !== o.address || a.recipient !== o.customer_name) diffs.push({ order: o.order_no, check: "shipping address" }); }
  }
  return { ok: diffs.length === 0, diffs };
}
