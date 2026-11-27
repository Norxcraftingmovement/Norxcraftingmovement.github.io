// Rehearsal of the cutover data path on a THROWAWAY local database (in-memory SQLite) — nothing touches Cloudflare, Google or any real service.
//   1. import the V1 orders + rounds CSV the way the cutover night will (v1-wins plan -> apply -> reconcile = 0 diff)
//   2. build the rollback export from that V2 database (scope all) with its own round-trip proof
//   3. compare what came back with what went in (status, total, delivery, round, items) and check that money/pieces add up
// Usage:  node scripts/rehearse-v1-local.mjs private/orders.anon.csv private/rounds.csv
// Feed it the MASKED export (scripts/anonymize-v1-export.mjs). It prints counts and verdicts only — never names, phones, addresses or rows.
import { readFileSync } from "node:fs";
import * as imp from "../src/v1-import.mjs";
import * as ex from "../src/v2-export.mjs";
import { legacyStatus } from "../src/orders-core.mjs";
import { setupV1 } from "../tests/helpers/orders-env.mjs"; // seeds the product catalogue + storefront settings in a fresh in-memory V2 (test helper, no real data)

const [ordersPath, roundsPath] = process.argv.slice(2);
if (!ordersPath || !roundsPath) { console.error("usage: node scripts/rehearse-v1-local.mjs <orders.csv> <rounds.csv>"); process.exit(2); }
const orders = imp.readOrdersCsv(readFileSync(ordersPath, "utf8")), rounds = imp.readRoundsCsv(readFileSync(roundsPath, "utf8"));
const now = Date.now(), result = { input: { orders: orders.length, rounds: rounds.length }, checks: {} }, fail = [];
const check = (name, ok, detail) => { result.checks[name] = ok ? "PASS" : "FAIL" + (detail ? " — " + detail : ""); if (!ok) fail.push(name); };

const { env } = await setupV1({ rounds: false });
const plan = await imp.planSync({ rounds, orders, state: await imp.readState(env.ORDERS_DB), mode: "v1-wins", now });
check("import plan has no errors", plan.ok, plan.errors.slice(0, 3).map((e) => e.id + ": " + e.error).join("; "));
if (!plan.ok) { console.log(JSON.stringify(result, null, 1)); process.exit(1); }
result.plan = { ordersToInsert: plan.plan.report.inserted.length, roundsToInsert: plan.plan.report.roundsInserted.length, warnings: plan.warnings.length };
await imp.runSync(env.ORDERS_DB, plan.plan, { dryRun: false });
const rec = await imp.reconcileState(plan.plan, await imp.readState(env.ORDERS_DB));
check("V2 reconciles with V1 after import (0 diff, 0 orphans, 0 native orders)", rec.ok && rec.orphans.length === 0 && rec.v2NativeOrders === 0, rec.diffs.slice(0, 3).map((d) => d.order + "/" + d.check).join("; "));

// money and pieces: what V1 says must equal what V2 stores
const v1Total = orders.reduce((n, o) => n + Number(o.total || 0), 0), v1Pieces = orders.reduce((n, o) => n + (JSON.parse(o.details || "{}").items || []).reduce((m, i) => m + Number(i.qty || 0), 0), 0);
const v2 = await env.ORDERS_DB.prepare("SELECT COALESCE(SUM(total_baht),0) AS t, COUNT(*) AS n FROM orders").first();
const v2Pieces = (await env.ORDERS_DB.prepare("SELECT COALESCE(SUM(qty),0) AS q FROM order_items").first()).q;
check("order count V1 = V2", v2.n === orders.length, `V1 ${orders.length} / V2 ${v2.n}`);
check("sum of order totals V1 = V2 (baht)", v2.t === v1Total, `V1 ${v1Total} / V2 ${v2.t}`);
check("pieces V1 = V2", v2Pieces === v1Pieces, `V1 ${v1Pieces} / V2 ${v2Pieces}`);
result.money = { orders: v2.n, totalBaht: v2.t, pieces: v2Pieces };

// rollback: V2 -> V1 CSV, with the tool's own proof, then field-by-field against the original V1 rows
const state = await ex.readExportState(env.ORDERS_DB), back = await ex.exportRollback({ ...state, scope: "all", includeTest: true, now }); // includeTest: V1 orders noted "ทดสอบ" must come back too, otherwise the comparison below could not see them
const proof = await ex.verifyRoundTrip({ result: back, original: state });
check("rollback export round-trips (re-import reconciles, 0 errors)", proof.ok, (proof.errors || []).slice(0, 2).join("; "));
const out = new Map(imp.readOrdersCsv(back.files.orders).map((r) => [r.id, r]));
let diffs = 0; const kinds = {};
for (const o of orders) {
  const b = out.get(o.id);
  if (!b) { diffs++; kinds.missing = (kinds.missing || 0) + 1; continue; }
  // V1 still carries one old alias ("เห็นยอดแล้ว" = ชำระแล้ว); V1's own code reads it as PAID, and the export writes the canonical word — compare after that same normalisation.
  for (const k of ["roundId", "delivery", "subtotal", "shipping", "total", "status"]) if (String(b[k]) !== String(k === "status" ? legacyStatus(o[k]) : o[k])) { diffs++; kinds[k] = (kinds[k] || 0) + 1; }
  const items = (r) => JSON.stringify((JSON.parse(r.details || "{}").items || []).map((i) => [i.product, i.sleeve, i.size, Number(i.qty)]).sort());
  if (items(b) !== items(o)) { diffs++; kinds.items = (kinds.items || 0) + 1; }
}
check("exported rows equal the imported V1 rows (round, delivery, money, status, items)", diffs === 0 && out.size === orders.length, JSON.stringify(kinds) + ` rows back ${out.size}`);
result.rollback = { rowsExported: back.manifest.orders.rows, roundsExported: back.manifest.rounds.rows, cannotHold: back.manifest.cannotHold };

result.verdict = fail.length ? "FAIL: " + fail.join(" | ") : "ALL CHECKS PASS";
console.log(JSON.stringify(result, null, 1));
process.exit(fail.length ? 1 : 0);
