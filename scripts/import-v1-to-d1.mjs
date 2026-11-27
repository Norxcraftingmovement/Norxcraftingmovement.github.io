// V1 -> V2 import for a REAL D1 (staging rehearsal now, production cutover later). It plans, renders guarded SQL and verifies; it never talks to Cloudflare itself,
// so every network step stays a visible, separately approved wrangler command. Prints counts and verdicts only (never rows). Customer data stays in git-ignored folders.
//
//   1) read the target's current state (3 read-only SELECTs, run each with wrangler and keep the --json output):
//        node scripts/import-v1-to-d1.mjs print-sql
//        node <wrangler.js> d1 execute <db> --remote --json --command "<SQL>" > private/state-before/orders.json     (rounds.json, products.json)
//      Call wrangler.js with `node` directly: through npx.cmd on Windows the SQL's quotes/pipes are mangled by cmd.exe ("'C:\Program' is not recognized").
//   2) plan (review the counts!) and write the guarded SQL:
//        node scripts/import-v1-to-d1.mjs plan --orders private/orders.csv --rounds private/rounds.csv --state private/state-before --out private/sync.sql --env staging [--mode safe|v1-wins] [--round-prefix V1-]
//   3) back up the D1 first (wrangler d1 export), then apply:  node <wrangler.js> d1 execute <db> --remote --file private/sync.sql --json
//      The first statement of the file aborts the WHOLE file unless the database's own meta.environment equals --env.
//   4) read the state again into private/state-after/ and verify (the re-plan must be a no-op and reconcile must show 0 diffs):
//        node scripts/import-v1-to-d1.mjs verify --orders private/orders.csv --rounds private/rounds.csv --state private/state-after [--round-prefix V1-]
// --round-prefix exists for a rehearsal on a database that already holds SYNTHETIC rounds with the same codes (staging has ROUND-001/002): V1 round codes get the prefix in both files.
// Production starts empty: no prefix there.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, relative, dirname, join, isAbsolute } from "node:path";
import * as imp from "../src/v1-import.mjs";
import { parseRows } from "../src/v2-export.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const arg = (n) => { const i = rest.indexOf("--" + n); return i < 0 ? null : rest[i + 1]; };
const die = (m) => { console.error("ERROR: " + m); process.exit(2); };
const oneLine = (s) => s.replace(/\s+/g, " ").trim();
const priv = (p, what) => { const abs = resolve(p), rel = relative(root, abs); if (!(isAbsolute(rel) || rel.startsWith("..")) && !/^(private|\.staging)([\\/]|$)/.test(rel)) die(what + " is inside the repo but not in /private/ or /.staging/ — it holds customer data"); return abs; };

if (cmd === "print-sql") {
  for (const k of ["orders", "rounds", "products"]) console.log("-- " + k + "\n" + oneLine(imp.STATE_SQL[k]) + "\n");
  process.exit(0);
}
if (cmd !== "plan" && cmd !== "verify") die("usage: import-v1-to-d1.mjs print-sql | plan | verify (see the header of this file)");

const [fo, fr, sd] = [arg("orders"), arg("rounds"), arg("state")];
if (!fo || !fr || !sd) die("need --orders, --rounds and --state <folder with orders.json rounds.json products.json>");
const prefix = arg("round-prefix") || "";
const state = {}; for (const k of ["orders", "rounds", "products"]) state[k] = parseRows(readFileSync(join(resolve(sd), k + ".json"), "utf8"));
const orders = imp.readOrdersCsv(readFileSync(fo, "utf8")).map((o) => ({ ...o, roundId: prefix + o.roundId }));
const rounds = imp.readRoundsCsv(readFileSync(fr, "utf8")).map((r) => ({ ...r, id: prefix + r.id }));
const mode = arg("mode") || "safe"; if (mode !== "safe" && mode !== "v1-wins") die("--mode must be safe or v1-wins");
const p = await imp.planSync({ rounds, orders, state, mode }), R = p.plan.report;
const counts = { ok: p.ok, errors: p.errors.length, warnings: p.warnings.length, ordersToInsert: R.inserted.length, ordersToUpdate: R.updated.length, ordersUnchanged: R.unchanged.length, roundsToInsert: R.roundsInserted.length, roundsUnchanged: R.roundsUnchanged.length,
  conflicts: R.conflicts.length + R.roundConflicts.length, localChanges: R.localChanges.length, orphans: R.orphans.length, v2NativeOrders: R.v2NativeOrders, needsAttention: p.needsAttention };

if (cmd === "plan") {
  const env = arg("env"), out = arg("out"); if (!env || !out) die("plan needs --env staging|production and --out <file.sql>");
  console.log("plan: " + JSON.stringify(counts));
  if (!p.ok) { console.log("errors (first 5): " + JSON.stringify(p.errors.slice(0, 5))); process.exit(1); }
  if (p.needsAttention) { console.log("NOT written: the plan has conflicts that need a human decision (safe mode never overwrites)."); process.exit(1); }
  const sql = imp.renderSql(p.plan, { guard: env }), dest = priv(out, "--out");
  mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, sql);
  const kinds = {}; for (const l of sql.split("\n")) { if (!l || l.startsWith("--")) continue; const m = l.match(/^(INSERT(?: OR [A-Z]+)? INTO|UPDATE|DELETE FROM)\s+"?([a-z_]+)"?/i); const k = m ? m[1].replace(/ OR [A-Z]+/i, "").toUpperCase() + " " + m[2] : "OTHER"; kinds[k] = (kinds[k] || 0) + 1; }
  console.log("sql: " + JSON.stringify({ bytes: sql.length, guard: env, statementsByKind: kinds }));
  console.log("written to " + dest + " — back up the D1, then apply with wrangler (step 3).");
  process.exit(0);
}

// verify: against the state AFTER the apply
const rec = await imp.reconcileState(p.plan, state), noop = p.plan.orders.length === 0 && p.plan.rounds.length === 0;
console.log("re-plan: " + JSON.stringify(counts));
console.log("reconcile: " + JSON.stringify({ ok: rec.ok, diffs: rec.diffs.length, orphans: rec.orphans.length, v2NativeOrders: rec.v2NativeOrders }));
if (rec.diffs.length) console.log("first diffs: " + JSON.stringify(rec.diffs.slice(0, 5).map((d) => ({ check: d.check, order: d.order, round: d.round }))));
const good = p.ok && noop && rec.ok && rec.orphans.length === 0;
console.log(good ? "VERIFIED: re-plan is a no-op and V2 reconciles with the V1 export (0 diff)." : "NOT VERIFIED — do not rely on this import.");
process.exit(good ? 0 : 1);
