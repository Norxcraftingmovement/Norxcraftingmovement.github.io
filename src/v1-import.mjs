// Orders V1 (Google Sheets) -> V2: import AND repeatable delta sync, with full reconciliation.
// Works on a private export of the V1 sheets (CSV) plus a snapshot of the current V2 state. Never commit real exports.
// Fail-closed: unknown statuses/bad money/duplicates stop the plan. V2 rows are NEVER deleted by a sync.
//
// Sync model (per order / per round): each synced row stores `import_hash` = hash of the V1 canonical form it was last
// synced from. On a new run, with h = hash(V1 now), s = stored hash, c = hash(V2 row as it is now):
//   no V2 row                      -> INSERT
//   h == s && c == s               -> unchanged
//   h != s && c == s               -> V1 changed, V2 untouched  -> UPDATE from V1
//   h == s && c != s               -> V2 was edited locally     -> keep (report), overwrite only in mode "v1-wins"
//   h != s && c != s               -> both changed              -> CONFLICT (report), overwrite only in mode "v1-wins"
//   h == c && s != h               -> already equal             -> refresh marker only
// "v1-wins" is for the final sync during the V1 freeze, when V1 is the single source of truth.
import { guardSql } from "./env-guard-sql.mjs";
import { FROM_LEGACY, legacyStatus, toLegacy, DELIVERY, PAID_LIKE } from "./orders-core.mjs";

// ---------- V1 sheet layout (header names as in V1 SHEETS; column order irrelevant when reading CSV) ----------
export const ORDER_COLS = ["id", "requestId", "fingerprint", "createdAt", "roundId", "name", "phone", "delivery", "address", "subtotal", "shipping", "total", "status", "updatedAt", "updatedBy", "details", "note"];
export const ORDER_HEADERS = ["เลขออเดอร์", "requestId", "fingerprint", "สั่งเมื่อ", "รอบ", "ชื่อ", "เบอร์โทร", "วิธีรับ", "ที่อยู่", "ค่าเสื้อ", "ค่าส่ง", "ยอดรวม", "สถานะ", "แก้ล่าสุด", "แก้โดย", "รายละเอียด", "หมายเหตุ"];
export const ROUND_COLS = ["id", "name", "opensAt", "closesAt", "paymentDue", "state", "shipping", "supplierShipping", "deliveries", "readyText", "sentAt"];
export const ROUND_HEADERS = ["รหัสรอบ", "ชื่อรอบ", "เปิดรับ", "ปิดรับ", "โอนภายใน", "สถานะ", "ค่าส่งลูกค้า", "ค่าส่งร้าน", "วิธีรับ", "วันที่รับสินค้า", "ส่งร้านเมื่อ"];
const ROUND_STATE = { เปิดรับ: "open", ฉบับร่าง: "draft", ปิดรับ: "closed", ส่งร้านแล้ว: "sent" };

// ---------- CSV ----------
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export const toCsv = (rows) => "﻿" + rows.map((r) => r.map((v) => { const t = String(v ?? ""); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(",")).join("\r\n") + "\r\n";
function fromCsv(text, headers, cols, what) {
  const [head, ...body] = parseCsv(text), idx = headers.map((h) => (head ?? []).indexOf(h));
  const missing = headers.filter((h, i) => idx[i] < 0); if (missing.length) throw new Error(what + " CSV missing columns: " + missing.join(", "));
  return body.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[idx[i]] ?? ""])));
}
export const readOrdersCsv = (t) => fromCsv(t, ORDER_HEADERS, ORDER_COLS, "orders");
export const readRoundsCsv = (t) => fromCsv(t, ROUND_HEADERS, ROUND_COLS, "rounds");
export const ordersToCsv = (objs) => toCsv([ORDER_HEADERS, ...objs.map((o) => ORDER_COLS.map((c) => o[c]))]);
export const roundsToCsv = (objs) => toCsv([ROUND_HEADERS, ...objs.map((o) => ROUND_COLS.map((c) => o[c]))]);

// ---------- helpers ----------
const sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const row = (cols, r) => (Array.isArray(r) ? Object.fromEntries(cols.map((c, i) => [c, r[i]])) : r);
const unsafe = (s) => String(s ?? "").replace(/^'/, ""); // V1 prefixes "'" to defuse spreadsheet formulas
const iso = (v) => { const t = Date.parse(v instanceof Date ? v.toISOString() : String(v)); if (Number.isNaN(t)) throw new Error("bad date: " + v); return new Date(t).toISOString(); };
const zip = (a) => [...String(a).matchAll(/(?<!\d)\d{5}(?!\d)/g)].at(-1)?.[0] ?? null;
const itemKey = (i) => [i.product, i.sleeve, i.size, i.qty, i.unit_price_baht ?? i.unitPrice];

// Canonical comparable form (same shape from V1 plan and from a V2 state row). Timestamps other than created/due are excluded.
const canonOrder = (o) => ({ no: o.order_no, status: o.legacy_status, name: o.customer_name, phone: o.customer_phone, delivery: o.delivery, address: o.address ?? "", subtotal: o.subtotal_baht, shipping: o.shipping_baht, total: o.total_baht,
  round: o.round_code, note: o.note ?? "", test: o.is_test ?? 0, req: o.request_key ?? null, fp: o.fingerprint ?? null, created: o.created_at, due: o.payment_due_at ?? null, items: o.items.map(itemKey).sort() });
const canonRound = (r) => ({ code: r.code, name: r.name, opens: r.opens_at, closes: r.closes_at, due: r.payment_due_at, status: r.status, ship: r.shipping_baht, sup: r.supplier_shipping_baht, del: r.deliveries, ready: r.ready_text ?? "", sent: r.sent_at ?? null });
const v2Order = (s) => ({ ...s, legacy_status: toLegacy(s.payment_status, s.fulfillment_status), address: s.address ?? "", items: s.items });
const v2Round = (r) => ({ ...r, deliveries: typeof r.deliveries === "string" ? JSON.parse(r.deliveries) : r.deliveries });
const h = (c) => sha(JSON.stringify(c));
const itemsDiffer = (cur, o) => JSON.stringify(canonOrder(v2Order(cur)).items) !== JSON.stringify(canonOrder(o).items);

// ---------- reading V2 state (same SQL works in-process and via `wrangler d1 execute --json`) ----------
export const STATE_SQL = {
  orders: `SELECT json_group_array(json_object('order_no',o.order_no,'source',o.source,'import_hash',o.import_hash,'payment_status',o.payment_status,'fulfillment_status',o.fulfillment_status,
    'customer_name',o.customer_name,'customer_phone',o.customer_phone,'delivery',o.delivery,'subtotal_baht',o.subtotal_baht,'shipping_baht',o.shipping_baht,'total_baht',o.total_baht,
    'round_code',r.code,'updated_at',o.updated_at,'note',o.note,'is_test',o.is_test,'request_key',o.request_key,'fingerprint',o.fingerprint,'payment_due_at',o.payment_due_at,'created_at',o.created_at,
    'address',(SELECT a.address FROM shipping_addresses a WHERE a.order_id=o.id),
    'items',json((SELECT COALESCE(json_group_array(json_object('product',p.slug,'sleeve',i.sleeve,'size',i.size,'qty',i.qty,'unit_price_baht',i.unit_price_baht)),'[]') FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=o.id)),
    'payments',json((SELECT COALESCE(json_group_array(json_object('status',y.status,'amount_baht',y.amount_baht)),'[]') FROM payments y WHERE y.order_id=o.id)))) AS j
    FROM orders o JOIN rounds r ON r.id=o.round_id`,
  rounds: `SELECT json_group_array(json_object('code',code,'name',name,'opens_at',opens_at,'closes_at',closes_at,'payment_due_at',payment_due_at,'status',status,'shipping_baht',shipping_baht,
    'supplier_shipping_baht',supplier_shipping_baht,'deliveries',json(deliveries),'ready_text',ready_text,'sent_at',sent_at,'import_hash',import_hash)) AS j FROM rounds`,
  products: `SELECT json_group_array(slug) AS j FROM products`,
};
export async function readState(db) {
  const one = async (k) => JSON.parse((await db.prepare(STATE_SQL[k]).first())?.j ?? "[]");
  return { orders: await one("orders"), rounds: await one("rounds"), products: await one("products") };
}

// ---------- plan ----------
function parseV1(rounds, orders, knownProducts, errors, warnings) {
  const out = { rounds: [], orders: [] }, seenId = new Set(), seenReq = new Set(), err = (id, m) => errors.push({ id, error: m });
  for (const rr of rounds) {
    const r = row(ROUND_COLS, rr);
    try {
      const state = ROUND_STATE[r.state]; if (!state) throw new Error("unknown round state " + r.state);
      const deliveries = String(r.deliveries || "city,ship").split(",").map((s) => s.trim()).filter((d) => DELIVERY[d]);
      out.rounds.push({ code: String(r.id), name: String(r.name), opens_at: iso(r.opensAt), closes_at: iso(r.closesAt), payment_due_at: iso(r.paymentDue), status: state, shipping_baht: Number(r.shipping) || 0,
        supplier_shipping_baht: Number(r.supplierShipping) || 0, deliveries, ready_text: String(r.readyText || ""), sent_at: r.sentAt ? iso(r.sentAt) : null });
    } catch (e) { err(String(r.id), e.message); }
  }
  for (const rr of orders) {
    const o = row(ORDER_COLS, rr), id = String(o.id).trim();
    try {
      if (!id) throw new Error("missing order id");
      if (seenId.has(id)) throw new Error("duplicate order id in export"); seenId.add(id);
      if (!/^NORX-[0-9A-F]{8}$/.test(id) && !/^NORX-LEGACY-[A-Za-z0-9-]{1,40}$/.test(id)) warnings.push({ id, warning: "unusual order id format (kept as is)" });
      if (o.requestId) { if (seenReq.has(o.requestId)) throw new Error("duplicate requestId in export"); seenReq.add(o.requestId); }
      const legacy = legacyStatus(o.status), m = FROM_LEGACY[legacy]; if (!m) throw new Error("unknown V1 status: " + JSON.stringify(o.status));
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
      const address = unsafe(o.address);
      if (o.delivery === "ship" && !address) throw new Error("ship order without address");
      out.orders.push({ order_no: id, request_key: o.requestId || null, fingerprint: o.fingerprint || null, created_at: iso(o.createdAt), round_code: String(o.roundId), customer_name: unsafe(o.name), customer_phone: unsafe(o.phone),
        delivery: o.delivery, address: o.delivery === "ship" ? address : "", subtotal_baht: subtotal, shipping_baht: shipping, total_baht: total, payment_status: m.payment, fulfillment_status: m.fulfillment, legacy_status: legacy,
        payment_due_at: d.round?.paymentDue ? iso(d.round.paymentDue) : null, round_snapshot: d.round ?? null, note: String(o.note || ""), is_test: String(o.note || "") === "ทดสอบ" ? 1 : 0,
        updated_at: o.updatedAt ? iso(o.updatedAt) : iso(o.createdAt), updated_by: o.updatedBy || null, items });
    } catch (e) { err(id, e.message); }
  }
  return out;
}

/**
 * @param state result of readState(db) (or {orders:[],rounds:[],products:[...]} for a first import)
 * @param mode "safe" (default) | "v1-wins" (final sync while V1 is frozen)
 */
export async function planSync({ rounds = [], orders = [], state, mode = "safe", now = Date.now() }) {
  const errors = [], warnings = [], knownProducts = state.products ?? [];
  const v1 = parseV1(rounds, orders, knownProducts, errors, warnings);
  const plan = { mode, at: new Date(now).toISOString(), rounds: [], orders: [], report: { inserted: [], updated: [], unchanged: [], refreshed: [], localChanges: [], conflicts: [], orphans: [], roundsInserted: [], roundsUpdated: [], roundsUnchanged: [], roundConflicts: [], roundLocalChanges: [] } };
  const R = plan.report, wins = mode === "v1-wins";
  const v2r = new Map(state.rounds.map((r) => [r.code, r])), v2o = new Map(state.orders.map((o) => [o.order_no, o]));
  const codes = new Set([...v2r.keys(), ...v1.rounds.map((r) => r.code)]);
  for (const r of v1.rounds) {
    const hash = await h(canonRound(r)), cur = v2r.get(r.code);
    if (!cur) { plan.rounds.push({ op: "insert", r, hash }); R.roundsInserted.push(r.code); continue; }
    const c = await h(canonRound(v2Round(cur))), s = cur.import_hash ?? null;
    if (hash === c) { if (s !== hash) plan.rounds.push({ op: "refresh", r, hash, old: s }); R.roundsUnchanged.push(r.code); continue; }
    if (hash === s) { R.roundLocalChanges.push(r.code); if (wins) plan.rounds.push({ op: "update", r, hash, old: null, force: true }); continue; }
    if (c === s) { plan.rounds.push({ op: "update", r, hash, old: s }); R.roundsUpdated.push(r.code); continue; }
    R.roundConflicts.push(r.code); if (wins) plan.rounds.push({ op: "update", r, hash, old: null, force: true });
  }
  const seen = new Set();
  for (const o of v1.orders) {
    seen.add(o.order_no);
    if (!codes.has(o.round_code)) warnings.push({ id: o.order_no, warning: "round " + o.round_code + " exists neither in V2 nor in this export" });
    const hash = await h(canonOrder(o)), cur = v2o.get(o.order_no);
    if (!cur) { plan.orders.push({ op: "insert", o, hash }); R.inserted.push(o.order_no); continue; }
    if (cur.source !== "v1_import") { R.conflicts.push({ order: o.order_no, why: "exists in V2 as a native order (source=" + cur.source + ")" }); continue; }
    const c = await h(canonOrder(v2Order(cur))), s = cur.import_hash ?? null;
    if (hash === c) { if (s !== hash) { plan.orders.push({ op: "refresh", o, hash, old: s }); R.refreshed.push(o.order_no); } else R.unchanged.push(o.order_no); continue; }
    if (hash === s) { R.localChanges.push(o.order_no); if (wins) plan.orders.push({ op: "update", o, hash, old: null, force: true, from: v2Order(cur).legacy_status, itemsChanged: itemsDiffer(cur, o), v2UpdatedAt: cur.updated_at }); continue; }
    if (c === s) { plan.orders.push({ op: "update", o, hash, old: s, from: v2Order(cur).legacy_status, itemsChanged: itemsDiffer(cur, o), v2UpdatedAt: cur.updated_at }); R.updated.push(o.order_no); continue; }
    R.conflicts.push({ order: o.order_no, why: "changed in both V1 and V2" }); if (wins) plan.orders.push({ op: "update", o, hash, old: null, force: true, from: v2Order(cur).legacy_status, itemsChanged: itemsDiffer(cur, o), v2UpdatedAt: cur.updated_at });
  }
  for (const [no, cur] of v2o) if (cur.source === "v1_import" && !seen.has(no)) R.orphans.push(no); // never deleted automatically
  R.v2NativeOrders = state.orders.filter((x) => x.source !== "v1_import").length;
  plan.v1 = v1;
  plan.needsAttention = !wins && (R.conflicts.length > 0 || R.roundConflicts.length > 0);
  return { plan, errors, warnings, ok: errors.length === 0, needsAttention: plan.needsAttention };
}

// ---------- statements (idempotent; per-order batch = one transaction) ----------
export function buildStatements(db, plan) {
  const out = [], at = plan.at;
  for (const x of plan.rounds) {
    const r = x.r;
    if (x.op === "refresh") { out.push([db.prepare("UPDATE rounds SET import_hash=?2 WHERE code=?1").bind(r.code, x.hash)]); continue; }
    out.push([db.prepare(`INSERT INTO rounds(code,name,opens_at,closes_at,payment_due_at,shipping_baht,supplier_shipping_baht,deliveries,ready_text,status,sent_at,import_hash) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name,opens_at=excluded.opens_at,closes_at=excluded.closes_at,payment_due_at=excluded.payment_due_at,shipping_baht=excluded.shipping_baht,supplier_shipping_baht=excluded.supplier_shipping_baht,
        deliveries=excluded.deliveries,ready_text=excluded.ready_text,status=excluded.status,sent_at=excluded.sent_at,import_hash=excluded.import_hash
      WHERE ?13=1 OR rounds.import_hash IS ?14`).bind(r.code, r.name, r.opens_at, r.closes_at, r.payment_due_at, r.shipping_baht, r.supplier_shipping_baht, JSON.stringify(r.deliveries), r.ready_text, r.status, r.sent_at, x.hash, x.force || x.op === "insert" ? 1 : 0, x.old ?? null)]);
  }
  for (const x of plan.orders) {
    const o = x.o, no = o.order_no, newer = "EXISTS (SELECT 1 FROM orders WHERE order_no=?1 AND import_hash=?2)", s = [];
    const paidLike = PAID_LIKE.includes(o.legacy_status), prod = ["in_production", "completed"].includes(o.fulfillment_status) ? "batched" : "pending";
    if (x.op === "refresh") { out.push([db.prepare("UPDATE orders SET import_hash=?2 WHERE order_no=?1").bind(no, x.hash)]); continue; }
    if (x.op === "insert") {
      s.push(db.prepare(`INSERT INTO orders(order_no,request_key,fingerprint,round_id,customer_name,customer_phone,source,delivery,subtotal_baht,shipping_baht,total_baht,payment_status,fulfillment_status,payment_due_at,note,round_snapshot,is_test,legacy_ref,status_updated_by,created_at,updated_at,import_hash)
        SELECT ?1,?2,?3,r.id,?4,?5,'v1_import',?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?21 FROM rounds r WHERE r.code=?20 ON CONFLICT(order_no) DO NOTHING`)
        .bind(no, o.request_key, o.fingerprint, o.customer_name, o.customer_phone, o.delivery, o.subtotal_baht, o.shipping_baht, o.total_baht, o.payment_status, o.fulfillment_status, o.payment_due_at, o.note,
          o.round_snapshot ? JSON.stringify(o.round_snapshot) : null, o.is_test, "v1:" + no, o.updated_by, o.created_at, o.updated_at, o.round_code, x.hash));
    } else {
      s.push(db.prepare(`UPDATE orders SET request_key=?3,fingerprint=?4,round_id=(SELECT id FROM rounds WHERE code=?21),customer_name=?5,customer_phone=?6,delivery=?7,subtotal_baht=?8,shipping_baht=?9,total_baht=?10,payment_status=?11,fulfillment_status=?12,
        payment_due_at=?13,note=?14,round_snapshot=?15,is_test=?16,status_updated_by=?17,status_updated_at=?18,updated_at=?19,import_hash=?2,created_at=?20 WHERE order_no=?1 AND (?22=1 OR (import_hash IS ?23 AND updated_at IS ?24))`)
        .bind(no, x.hash, o.request_key, o.fingerprint, o.customer_name, o.customer_phone, o.delivery, o.subtotal_baht, o.shipping_baht, o.total_baht, o.payment_status, o.fulfillment_status, o.payment_due_at, o.note,
          o.round_snapshot ? JSON.stringify(o.round_snapshot) : null, o.is_test, "v1_delta_sync", at, at, o.created_at, o.round_code, x.force ? 1 : 0, x.old ?? null, x.v2UpdatedAt ?? null));
      // history row only once per resulting V1 state (re-running the same SQL adds nothing)
      s.push(db.prepare(`INSERT INTO order_status_history(order_id,kind,from_status,to_status,actor,at,note) SELECT id,'legacy',?3,?4,'v1_delta_sync',?5,?6 FROM orders WHERE order_no=?1 AND import_hash=?2
        AND NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id=orders.id AND h.note=?6)`).bind(no, x.hash, x.from ?? null, o.legacy_status, at, "V1 delta sync " + x.hash.slice(0, 12)));
      s.push(db.prepare(`INSERT INTO audit_log(actor_hash,action,entity,entity_id,before,after) SELECT 'v1_delta_sync',?3,'orders',?1,?4,?5 FROM orders WHERE order_no=?1 AND import_hash=?2
        AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id=?1 AND a.after=?5)`).bind(no, x.hash, x.force ? "order.v1_overwrite" : "order.v1_sync", JSON.stringify({ status: x.from ?? null }), JSON.stringify({ status: o.legacy_status, hash: x.hash.slice(0, 12) })));
      // items are reconciled in place only when they actually changed: stale lines removed, others upserted
      // (row ids and V2 production progress are preserved, and re-running is a no-op)
      if (x.itemsChanged) { const keys = o.items.map((i) => i.product + "|" + i.sleeve + "|" + i.size);
        s.push(db.prepare(`DELETE FROM order_items WHERE order_id=(SELECT id FROM orders WHERE order_no=?1 AND import_hash=?2)
          AND (SELECT slug FROM products WHERE id=order_items.product_id)||'|'||sleeve||'|'||size NOT IN (${keys.map((_, k) => "?" + (k + 3)).join(",")})`).bind(no, x.hash, ...keys)); }
    }
    if (x.op === "insert" || x.itemsChanged) for (const i of o.items) s.push(db.prepare(`INSERT INTO order_items(order_id,product_id,sleeve,size,qty,unit_price_baht,line_total_baht,product_name,fit,fit_name,production_status)
      SELECT o.id,(SELECT id FROM products WHERE slug=?3),?4,?5,?6,?7,?8,?9,?10,?11,?12 FROM orders o WHERE o.order_no=?1 AND o.import_hash=?2
      ON CONFLICT(order_id,product_id,sleeve,size) DO UPDATE SET qty=excluded.qty,unit_price_baht=excluded.unit_price_baht,line_total_baht=excluded.line_total_baht,product_name=excluded.product_name,fit=excluded.fit,fit_name=excluded.fit_name`)
      .bind(no, x.hash, i.product, i.sleeve, i.size, i.qty, i.unit_price_baht, i.line_total_baht, i.product_name, i.fit, i.fit_name, prod));
    if (o.delivery === "ship") s.push(db.prepare(`INSERT INTO shipping_addresses(order_id,recipient,phone,address,postal_code) SELECT id,?3,?4,?5,?6 FROM orders WHERE order_no=?1 AND import_hash=?2
      ON CONFLICT(order_id) DO UPDATE SET recipient=excluded.recipient,phone=excluded.phone,address=excluded.address,postal_code=excluded.postal_code`).bind(no, x.hash, o.customer_name, o.customer_phone, o.address, zip(o.address)));
    else s.push(db.prepare(`DELETE FROM shipping_addresses WHERE order_id=(SELECT id FROM orders WHERE order_no=?1 AND import_hash=?2)`).bind(no, x.hash));
    // payments follow the V1 status: paid-like => exactly one confirmed payment equal to the total; otherwise none confirmed
    s.push(db.prepare(`UPDATE payments SET status='void', voided_at=?3, void_reason='V1 delta sync' WHERE status='confirmed' AND order_id=(SELECT id FROM orders WHERE order_no=?1 AND import_hash=?2)
      AND (?4=0 OR amount_baht!=(SELECT total_baht FROM orders WHERE order_no=?1))`).bind(no, x.hash, at, paidLike ? 1 : 0));
    if (paidLike) s.push(db.prepare(`INSERT OR IGNORE INTO payments(order_id,amount_baht,method,reference,status,recorded_by,created_at) SELECT id,total_baht,'v1_import','v1','confirmed','v1_import',?3 FROM orders WHERE order_no=?1 AND import_hash=?2`).bind(no, x.hash, o.updated_at));
    out.push(s);
  }
  return out;
}
export async function runSync(db, plan, { dryRun = true } = {}) {
  const groups = buildStatements(db, plan); if (dryRun) return { dryRun: true, groups: groups.length };
  for (const g of groups) await db.batch(g);
  return { dryRun: false, groups: groups.length };
}
/** Render the statements as literal SQL (for `wrangler d1 execute --file`). Same code path as runSync. */
export function renderSql(plan, { guard = null } = {}) {
  const lit = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
  const rec = { prepare: (sql) => ({ bind: (...a) => ({ sql, a }) }) };
  const groups = buildStatements(rec, plan);
  return (guard ? guardSql(guard) + "\n" : "") + groups.map((g) => g.map(({ sql, a }) => sql.replace(/\?(\d+)/g, (_, n) => lit(a[n - 1])).replace(/\s+/g, " ").trim() + ";").join("\n")).join("\n\n") + "\n";
}

// ---------- reconciliation (against a V2 state) ----------
export async function reconcileState(plan, state) {
  const diffs = [], v2o = new Map(state.orders.map((o) => [o.order_no, o])), v2r = new Map(state.rounds.map((r) => [r.code, r]));
  const sum = (a, f) => a.reduce((n, x) => n + f(x), 0), want = plan.v1.orders, orphans = new Set(plan.report.orphans), imported = state.orders.filter((o) => o.source === "v1_import" && !orphans.has(o.order_no)); // orphans are reported separately, never counted as matches
  const chk = (check, v1, v2, extra = {}) => { if (JSON.stringify(v1) !== JSON.stringify(v2)) diffs.push({ check, v1, v2, ...extra }); };
  chk("order count", want.length, imported.length);
  chk("piece count", sum(want, (o) => sum(o.items, (i) => i.qty)), sum(imported, (o) => sum(o.items, (i) => i.qty)));
  for (const [k, f] of [["subtotal sum", (o) => o.subtotal_baht], ["shipping sum", (o) => o.shipping_baht], ["total sum", (o) => o.total_baht]]) chk(k, sum(want, f), sum(imported, f));
  const stat = (arr) => JSON.stringify(Object.entries(arr.reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {})).sort());
  chk("status counts", stat(want.map((o) => o.legacy_status)), stat(imported.map((o) => toLegacy(o.payment_status, o.fulfillment_status))));
  chk("paid-like total vs confirmed payments", sum(want.filter((o) => PAID_LIKE.includes(o.legacy_status)), (o) => o.total_baht), sum(imported, (o) => sum(o.payments.filter((p) => p.status === "confirmed"), (p) => p.amount_baht)));
  for (const o of want) {
    const c = v2o.get(o.order_no); if (!c) { diffs.push({ order: o.order_no, check: "missing in V2" }); continue; }
    const a = canonOrder(o), b = canonOrder(v2Order(c));
    for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push({ order: o.order_no, check: k, v1: a[k], v2: b[k] });
    const conf = c.payments.filter((p) => p.status === "confirmed"), paid = PAID_LIKE.includes(o.legacy_status);
    if (paid ? !(conf.length === 1 && conf[0].amount_baht === o.total_baht) : conf.length > 0) diffs.push({ order: o.order_no, check: "payments", v1: paid ? "one confirmed = total" : "none confirmed", v2: conf });
  }
  for (const r of plan.v1.rounds) {
    const c = v2r.get(r.code); if (!c) { diffs.push({ round: r.code, check: "missing in V2" }); continue; }
    const a = canonRound(r), b = canonRound(v2Round(c));
    for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push({ round: r.code, check: k, v1: a[k], v2: b[k] });
  }
  return { ok: diffs.length === 0, diffs, orphans: plan.report.orphans, v2NativeOrders: state.orders.filter((o) => o.source !== "v1_import").length };
}

// ---------- anonymiser (private export -> shareable fixture) ----------
/** Deterministic pseudonymisation. Keeps ids, statuses, money, items, dates, rounds, notes flag; replaces every personal field. */
export async function anonymizeOrders(rows, salt = "norx-fixture") {
  const out = [];
  for (const rr of rows) {
    const o = row(ORDER_COLS, rr), d = typeof o.details === "string" ? JSON.parse(o.details || "{}") : o.details || {};
    const hx = await sha(salt + "|" + o.id), digits = String(parseInt(hx.slice(0, 8), 16) % 1e4).padStart(4, "0");
    const name = "ลูกค้าทดสอบ " + String(parseInt(hx.slice(8, 16), 16) % 1e4).padStart(4, "0"), phone = "080000" + digits; // keyed by order id (not row position) so the same order gets the same pseudonym in every snapshot
    const z = zip(unsafe(o.address)), address = o.delivery === "ship" ? "เลขที่ " + (parseInt(hx.slice(16, 20), 16) % 900 + 1) + " ซอยทดสอบ ถนนสมมติ ตำบลทดสอบ อำเภอสมมติ จังหวัดสมมติ " + (z ?? "10000") : "";
    const items = (d.items || []).map((i) => ({ product: i.product, fit: i.fit, sleeve: i.sleeve, size: i.size, qty: i.qty })).sort((a, b) => [a.product, a.fit, a.sleeve, a.size].join("|").localeCompare([b.product, b.fit, b.sleeve, b.size].join("|")));
    const normalized = { requestId: o.requestId, roundId: String(o.roundId), name, phone, delivery: o.delivery, address, items, preorder: true, sizing: true, privacy: true };
    out.push({ ...o, name, phone, address, updatedBy: o.updatedBy ? "admin" : "", note: o.note ? (o.note === "ทดสอบ" ? "ทดสอบ" : "หมายเหตุ") : "",
      fingerprint: o.fingerprint ? await sha(JSON.stringify(normalized)) : "", details: JSON.stringify({ items: d.items, round: d.round }) });
  }
  return out;
}
