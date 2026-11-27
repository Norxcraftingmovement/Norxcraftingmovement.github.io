// Rollback V2 -> V1: export what the V1 Sheets can hold (same columns the V1 -> V2 importer reads), say plainly what they cannot,
// and PROVE the export: the CSVs are re-read with the importer's own parser and validation, and reconciled against the V2 rows.
// Output contains customer data: it is written only outside the repo or into ignored folders (/private/, /.staging/). Never commit it.
import { ordersToCsv, roundsToCsv, readOrdersCsv, readRoundsCsv, planSync, reconcileState, v2OrderHash, v2RoundHash } from "./v1-import.mjs";
import { toLegacy } from "./orders-core.mjs";

// ---------- reading V2 (same SQL runs in-process and through `wrangler d1 execute --json`) ----------
export const EXPORT_SQL = {
  orders: `SELECT json_group_array(json_object('order_no',o.order_no,'source',o.source,'import_hash',o.import_hash,'payment_status',o.payment_status,'fulfillment_status',o.fulfillment_status,
    'customer_name',o.customer_name,'customer_phone',o.customer_phone,'delivery',o.delivery,'subtotal_baht',o.subtotal_baht,'shipping_baht',o.shipping_baht,'total_baht',o.total_baht,
    'round_code',r.code,'created_at',o.created_at,'updated_at',o.updated_at,'status_updated_by',o.status_updated_by,'note',o.note,'is_test',o.is_test,'request_key',o.request_key,
    'fingerprint',o.fingerprint,'payment_due_at',o.payment_due_at,'round_snapshot',o.round_snapshot,
    'address',(SELECT a.address FROM shipping_addresses a WHERE a.order_id=o.id),
    'items',json((SELECT COALESCE(json_group_array(json_object('product',p.slug,'sleeve',i.sleeve,'size',i.size,'qty',i.qty,'unit_price_baht',i.unit_price_baht,'line_total_baht',i.line_total_baht,
      'product_name',i.product_name,'fit',i.fit,'fit_name',i.fit_name,'production_status',i.production_status,'received_qty',i.received_qty)),'[]') FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=o.id)),
    'payments',json((SELECT COALESCE(json_group_array(json_object('status',y.status,'amount_baht',y.amount_baht,'method',y.method,'bank_txn_ref',y.bank_txn_ref)),'[]') FROM payments y WHERE y.order_id=o.id)),
    'shipments',json((SELECT COALESCE(json_group_array(json_object('provider',s.provider,'tracking_no',s.tracking_no,'shipped_at',s.shipped_at)),'[]') FROM shipments s WHERE s.order_id=o.id)))) AS j
    FROM orders o JOIN rounds r ON r.id=o.round_id`,
  rounds: `SELECT json_group_array(json_object('code',code,'name',name,'opens_at',opens_at,'closes_at',closes_at,'payment_due_at',payment_due_at,'status',status,'shipping_baht',shipping_baht,
    'supplier_shipping_baht',supplier_shipping_baht,'deliveries',json(deliveries),'ready_text',ready_text,'sent_at',sent_at,'import_hash',import_hash)) AS j FROM rounds`,
  products: `SELECT json_group_array(slug) AS j FROM products`,
};
export async function readExportState(db) {
  const one = async (k) => JSON.parse((await db.prepare(EXPORT_SQL[k]).first())?.j ?? "[]");
  return { orders: await one("orders"), rounds: await one("rounds"), products: await one("products") };
}
/** Accepts the output of `wrangler d1 execute --json` (or a plain JSON array / JSON string) and returns the array. */
export function parseRows(text) {
  const t = String(text).replace(/^﻿/, ""); // wrangler may print banner lines before the JSON: try each line that could start it
  let v, last;
  for (const m of t.matchAll(/^[\[{"]/gm)) { try { v = JSON.parse(t.slice(m.index)); break; } catch (e) { last = e; } }
  if (v === undefined) throw new Error("no JSON found in the file" + (last ? ": " + last.message : ""));
  if (Array.isArray(v) && v[0]?.results) v = v[0].results[0]?.j ?? "[]";
  if (typeof v === "string") v = JSON.parse(v);
  if (!Array.isArray(v)) throw new Error("expected a JSON array of rows");
  return v;
}

// ---------- mapping ----------
const ROUND_STATE_TH = { draft: "ฉบับร่าง", open: "เปิดรับ", closed: "ปิดรับ", sent: "ส่งร้านแล้ว" };
// V1 writes "'" in front of text that a spreadsheet could read as a formula; the importer strips exactly one leading "'" from name/phone/address.
const defuse = (s) => { const t = String(s ?? ""); return /^[=+\-@\t\r']/.test(t) ? "'" + t : t; };
const COLLAPSED = ["qc", "ready_pickup", "ready_ship", "shipped"]; // finer V2 fulfillment states that V1 shows as ส่งร้านแล้ว / จ่ายหน้างาน
const sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const parseJson = (v) => { try { return typeof v === "string" ? JSON.parse(v) : v ?? {}; } catch { return {}; } };
const byKey = (a, b) => [a.product, a.sleeve, a.size].join("|").localeCompare([b.product, b.sleeve, b.size].join("|"));

export function toV1Order(o) {
  const items = [...o.items].sort(byKey).map((i) => ({ product: i.product, fit: i.fit, sleeve: i.sleeve, size: i.size, qty: i.qty, name: i.product_name, fitName: i.fit_name, unitPrice: i.unit_price_baht, lineTotal: i.line_total_baht }));
  const round = { ...parseJson(o.round_snapshot), id: o.round_code };
  if (o.payment_due_at) round.paymentDue = o.payment_due_at; else delete round.paymentDue; // the importer reads the due date from here
  return { id: o.order_no, requestId: o.request_key ?? "", fingerprint: o.fingerprint ?? "", createdAt: o.created_at, roundId: o.round_code, name: defuse(o.customer_name), phone: defuse(o.customer_phone),
    delivery: o.delivery, address: o.delivery === "ship" ? defuse(o.address ?? "") : "", subtotal: o.subtotal_baht, shipping: o.shipping_baht, total: o.total_baht,
    status: toLegacy(o.payment_status, o.fulfillment_status), updatedAt: o.updated_at, updatedBy: o.status_updated_by ?? "", details: JSON.stringify({ items, round }), note: o.is_test === 1 ? "ทดสอบ" : o.note ?? "" };
}
export const toV1Round = (r) => ({ id: r.code, name: r.name, opensAt: r.opens_at, closesAt: r.closes_at, paymentDue: r.payment_due_at, state: ROUND_STATE_TH[r.status] ?? r.status, shipping: r.shipping_baht,
  supplierShipping: r.supplier_shipping_baht, deliveries: (typeof r.deliveries === "string" ? JSON.parse(r.deliveries) : r.deliveries).join(","), readyText: r.ready_text ?? "", sentAt: r.sent_at ?? "" });

/**
 * @param scope "delta" (default): V2-born orders (append) + imported orders changed since import (replace row); "all": every order (rebuild the sheet)
 * @returns { files: { orders, rounds, manifest }, manifest, selected: { orders:Set, rounds:Set } }
 */
export async function exportRollback({ orders, rounds, scope = "delta", includeTest = false, now = Date.now() }) {
  const warnings = [], stats = { v2Orders: orders.length, v2Born: 0, imported: 0, excludedTest: 0, unchanged: 0 }, sel = [];
  for (const o of orders) {
    const native = o.source !== "v1_import"; if (native) stats.v2Born++; else stats.imported++;
    if (o.is_test === 1 && !includeTest) { stats.excludedTest++; continue; }
    let action;
    if (scope === "all") action = "full";
    else if (native) action = "append";
    else if ((await v2OrderHash(o)) !== o.import_hash) action = "replace";
    else { stats.unchanged++; continue; }
    if (o.is_test === 1 && o.note && o.note !== "ทดสอบ") warnings.push({ id: o.order_no, warning: "test order: note replaced by ทดสอบ (V1 marks test orders by that note)" });
    if (/^[=+\-@]/.test(o.note ?? "")) warnings.push({ id: o.order_no, warning: "note starts with a formula character; format the Note column as plain text before pasting" });
    sel.push({ o, action });
  }
  sel.sort((a, b) => a.o.created_at.localeCompare(b.o.created_at) || a.o.order_no.localeCompare(b.o.order_no));
  const selRounds = [];
  for (const r of rounds) {
    const native = !r.import_hash;
    if (scope === "all" || native || (await v2RoundHash(r)) !== r.import_hash) selRounds.push({ r, action: scope === "all" ? "full" : native ? "append" : "replace" });
  }
  selRounds.sort((a, b) => a.r.opens_at.localeCompare(b.r.opens_at));
  const v1Orders = sel.map((x) => toV1Order(x.o)), v1Rounds = selRounds.map((x) => toV1Round(x.r));
  const ordersCsv = ordersToCsv(v1Orders), roundsCsv = roundsToCsv(v1Rounds);
  const sum = (f) => sel.reduce((n, x) => n + f(x.o), 0), byStatus = {};
  for (const v of v1Orders) byStatus[v.status] = (byStatus[v.status] || 0) + 1;
  const real = orders.filter((o) => includeTest || o.is_test !== 1), has = (o, f) => f(o);
  const exportedCodes = new Set(selRounds.map((x) => x.r.code)), referenced = [...new Set(sel.map((x) => x.o.round_code))].sort();
  const manifest = {
    tool: "export-v2-to-v1", generatedAt: new Date(now).toISOString(), scope, includeTest,
    v2: { orders: stats.v2Orders, v2Born: stats.v2Born, imported: stats.imported, excludedTest: stats.excludedTest, unchangedSinceImport: stats.unchanged },
    orders: { rows: v1Orders.length, append: sel.filter((x) => x.action === "append").map((x) => x.o.order_no), replace: sel.filter((x) => x.action === "replace").map((x) => x.o.order_no), full: scope === "all" ? v1Orders.length : 0 },
    rounds: { rows: v1Rounds.length, append: selRounds.filter((x) => x.action === "append").map((x) => x.r.code), replace: selRounds.filter((x) => x.action === "replace").map((x) => x.r.code), referencedByOrders: referenced, alsoInThisExport: referenced.filter((c) => exportedCodes.has(c)) },
    totals: { pieces: sum((o) => o.items.reduce((n, i) => n + i.qty, 0)), subtotal: sum((o) => o.subtotal_baht), shipping: sum((o) => o.shipping_baht), total: sum((o) => o.total_baht), byV1Status: byStatus },
    products: [...new Set(sel.flatMap((x) => x.o.items.map((i) => i.product)))].sort(),
    // What the Sheets cannot hold. Not in the CSV; it stays in D1, so KEEP a D1 snapshot (export/backup) before any rollback.
    cannotHold: {
      stillInD1: ["shipments (carrier, tracking number, shipped date)", "partial receipts (received_qty, production_status)", "payment details (method, bank reference, payment requests / QR)", "status history and audit log", "notification queue", "customer tracking tokens"],
      ordersWithTracking: real.filter((o) => has(o, (x) => x.shipments?.some((s) => s.tracking_no || s.shipped_at))).length,
      ordersWithReceiptProgress: real.filter((o) => o.items.some((i) => i.received_qty > 0 || ["produced", "received"].includes(i.production_status))).length,
      confirmedPaymentsWithBankRef: real.reduce((n, o) => n + (o.payments ?? []).filter((p) => p.status === "confirmed" && p.bank_txn_ref).length, 0),
      onSitePayments: real.reduce((n, o) => n + (o.payments ?? []).filter((p) => p.status === "confirmed" && p.method === "on_site").length, 0),
      exportedOrdersWhoseFinerStatusIsCollapsed: sel.filter((x) => COLLAPSED.includes(x.o.fulfillment_status)).length,
    },
    warnings,
    csv: { orders: { rows: v1Orders.length, sha256: await sha(ordersCsv) }, rounds: { rows: v1Rounds.length, sha256: await sha(roundsCsv) } },
    steps: [
      "1. Freeze V2 (stop new orders) and take a D1 backup/snapshot first.",
      "2. Copy the V1 spreadsheet (File → Make a copy). Work on the copy until the check at step 5 passes; only then repeat on the live sheet.",
      "3. Orders sheet: for ids in orders.append paste the rows from orders-v1.csv at the bottom; for ids in orders.replace overwrite the row whose เลขออเดอร์ matches. Rounds sheet: same with rounds-v1.csv.",
      "4. Before pasting format the text columns (เบอร์โทร, ที่อยู่, หมายเหตุ, รายละเอียด) as Plain text so leading zeros and = + - @ are kept.",
      "5. Check against this manifest: row counts, sum of ค่าเสื้อ / ค่าส่ง / ยอดรวม, number of rows per สถานะ. Any difference = stop and keep V2.",
      "6. Switch NORX_API back to the V1 Apps Script URL (single revert commit), then unfreeze V1.",
    ],
  };
  return { files: { orders: ordersCsv, rounds: roundsCsv, manifest: JSON.stringify(manifest, null, 2) + "\n" }, manifest, selected: { orders: new Set(sel.map((x) => x.o.order_no)), rounds: exportedCodes } };
}

/**
 * Round-trip proof: re-read the CSV with the V1 -> V2 importer (its validation is fail-closed) and reconcile every important field
 * (status, name, phone, address, items, money, round, note, test flag, requestId, fingerprint, dates, payments) against the V2 rows.
 */
export async function verifyRoundTrip({ result, original }) {
  const { files, selected } = result;
  const orders = readOrdersCsv(files.orders), rounds = readRoundsCsv(files.rounds);
  const { plan, errors, warnings } = await planSync({ rounds, orders, state: { orders: [], rounds: [], products: original.products } });
  if (errors.length) return { ok: false, errors, diffs: [], warnings };
  // V1 marks a test order by the note "ทดสอบ" (is_test <-> note); that mapping is deliberate and reported in the manifest, so expect it here.
  const expectedOrders = original.orders.filter((o) => selected.orders.has(o.order_no)).map((o) => ({ ...o, source: "v1_import", payments: o.payments ?? [], note: o.is_test === 1 ? "ทดสอบ" : o.note }));
  const expectedRounds = original.rounds.filter((r) => selected.rounds.has(r.code));
  const rec = await reconcileState(plan, { orders: expectedOrders, rounds: expectedRounds, products: original.products });
  const m = result.manifest, t = plan.v1.orders, sum = (f) => t.reduce((n, o) => n + f(o), 0), diffs = [...rec.diffs];
  for (const [k, v1, v2] of [["manifest pieces", m.totals.pieces, sum((o) => o.items.reduce((n, i) => n + i.qty, 0))], ["manifest subtotal", m.totals.subtotal, sum((o) => o.subtotal_baht)], ["manifest shipping", m.totals.shipping, sum((o) => o.shipping_baht)], ["manifest total", m.totals.total, sum((o) => o.total_baht)]])
    if (v1 !== v2) diffs.push({ check: k, manifest: v1, csv: v2 });
  return { ok: diffs.length === 0, errors: [], diffs, warnings };
}
