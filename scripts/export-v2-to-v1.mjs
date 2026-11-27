// Rollback tool: export V2 orders in the V1 Sheet format and PROVE the export (round trip). Reads only; never writes to any database.
//
//   1) print the three read-only SQL statements:        node scripts/export-v2-to-v1.mjs --print-sql
//   2) run each against the D1 you want to roll back (keep the JSON in an ignored folder), e.g.
//        npx wrangler d1 execute <db> --remote --json --command "<SQL>" > private/orders.json     (rounds.json, products.json)
//   3) export + verify:                                  node scripts/export-v2-to-v1.mjs --orders private/orders.json --rounds private/rounds.json --products private/products.json --out private/rollback-<date>
//        options: --all (every order, to rebuild the sheet) · --include-test (synthetic orders are excluded by default)
// The output holds customer data: --out must be outside the repo or inside /private/ or /.staging/ (both git-ignored).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, relative, join, isAbsolute } from "node:path";
import { EXPORT_SQL, parseRows, exportRollback, verifyRoundTrip } from "../src/v2-export.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const arg = (n) => { const i = process.argv.indexOf("--" + n); return i < 0 ? null : process.argv[i + 1]; };
const flag = (n) => process.argv.includes("--" + n);
const oneLine = (s) => s.replace(/\s+/g, " ").trim();
const die = (m) => { console.error("ERROR: " + m); process.exit(2); };

if (flag("print-sql")) {
  for (const k of ["orders", "rounds", "products"]) console.log("-- " + k + "\n" + oneLine(EXPORT_SQL[k]) + "\n");
  process.exit(0);
}
const [fo, fr, fp, out] = [arg("orders"), arg("rounds"), arg("products"), arg("out")];
if (!fo || !fr || !fp || !out) die("need --orders, --rounds, --products and --out (see the header of this file, or use --print-sql)");
const dest = resolve(out), rel = relative(root, dest);
if (!(isAbsolute(rel) || rel.startsWith("..")) && !/^(private|\.staging)([\\/]|$)/.test(rel)) die("--out is inside the repo but not in /private/ or /.staging/ — the files contain customer data");

const original = { orders: parseRows(readFileSync(fo, "utf8")), rounds: parseRows(readFileSync(fr, "utf8")), products: parseRows(readFileSync(fp, "utf8")) };
const result = await exportRollback({ ...original, scope: flag("all") ? "all" : "delta", includeTest: flag("include-test") });
const check = await verifyRoundTrip({ result, original });
mkdirSync(dest, { recursive: true });
writeFileSync(join(dest, "orders-v1.csv"), result.files.orders); writeFileSync(join(dest, "rounds-v1.csv"), result.files.rounds); writeFileSync(join(dest, "manifest.json"), result.files.manifest);
const m = result.manifest;
console.log(`orders: ${m.orders.rows} rows (append ${m.orders.append.length}, replace ${m.orders.replace.length}${m.scope === "all" ? ", full" : ""}) · rounds: ${m.rounds.rows} rows`);
console.log(`pieces ${m.totals.pieces} · subtotal ${m.totals.subtotal} · shipping ${m.totals.shipping} · total ${m.totals.total} · by status ${JSON.stringify(m.totals.byV1Status)}`);
console.log(`V2 orders ${m.v2.orders} (V2-born ${m.v2.v2Born}, imported ${m.v2.imported}, test excluded ${m.v2.excludedTest}, unchanged since import ${m.v2.unchangedSinceImport})`);
console.log("cannot be held by the Sheets: " + JSON.stringify(m.cannotHold, (k, v) => (k === "stillInD1" ? undefined : v)));
if (m.warnings.length || check.warnings.length) console.log("warnings: " + (m.warnings.length + check.warnings.length) + " (see manifest.json)");
console.log("written to " + dest);
if (!check.ok) { console.error("ROUND-TRIP CHECK FAILED — do NOT use these files\n" + JSON.stringify({ errors: check.errors.slice(0, 5), diffs: check.diffs.slice(0, 10) }, null, 1)); process.exit(1); }
console.log("ROUND-TRIP OK: the CSV re-imports with 0 validation errors and reconciles with V2 (0 diff)");
