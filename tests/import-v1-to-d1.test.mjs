import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_SQL } from "../src/v1-import.mjs";
import { setupV1 } from "./helpers/orders-env.mjs";
// scripts/import-v1-to-d1.mjs is what the cutover night (and the staging rehearsal) runs around wrangler. SYNTHETIC fixtures only; the "D1" is an in-memory SQLite.
const root = fileURLToPath(new URL("../", import.meta.url)), script = join(root, "scripts/import-v1-to-d1.mjs");
const fx = (f) => fileURLToPath(new URL("./fixtures/v1-anonymized/" + f, import.meta.url));
const run = (args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
const saveState = (sqlite, dir) => { mkdirSync(dir, { recursive: true }); for (const k of ["orders", "rounds", "products"]) writeFileSync(join(dir, k + ".json"), JSON.stringify([{ results: [{ j: sqlite.prepare(STATE_SQL[k]).get().j }], success: true }])); }; // the shape `wrangler d1 execute --json` prints
const common = (tmp, extra = []) => ["--orders", fx("snapshot-1-orders.csv"), "--rounds", fx("snapshot-1-rounds.csv"), "--state", join(tmp, "before"), ...extra];
const count = (sqlite, t) => sqlite.prepare("SELECT COUNT(*) AS n FROM " + t).get().n;

test("print-sql lists the three read-only state queries", () => {
  const r = run(["print-sql"]); assert.equal(r.status, 0);
  assert.equal((r.stdout.match(/^SELECT /gm) || []).length, 3); assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP)\b/i.test(r.stdout));
});

test("empty database: plan -> apply the guarded SQL -> verify (re-plan is a no-op, reconcile 0 diff)", async () => {
  const { sqlite } = await setupV1({ rounds: false }), tmp = mkdtempSync(join(tmpdir(), "norx-imp-"));
  try {
    saveState(sqlite, join(tmp, "before"));
    const out = join(tmp, "sync.sql"), p = run(["plan", ...common(tmp), "--out", out, "--env", "staging"]);
    assert.equal(p.status, 0, p.stdout + p.stderr); assert.match(p.stdout, /"ordersToInsert":35/); assert.match(p.stdout, /"guard":"staging"/);
    assert.ok(!/ลูกค้าทดสอบ|080000/.test(p.stdout), "counts only, no customer-like values in the output");
    const sql = readFileSync(out, "utf8"); assert.match(sql.split("\n")[0], /environment guard/);
    sqlite.exec(sql); assert.equal(count(sqlite, "orders"), 35);
    saveState(sqlite, join(tmp, "after"));
    const v = run(["verify", "--orders", fx("snapshot-1-orders.csv"), "--rounds", fx("snapshot-1-rounds.csv"), "--state", join(tmp, "after")]);
    assert.equal(v.status, 0, v.stdout + v.stderr); assert.match(v.stdout, /VERIFIED/);
    // applying the same SQL again changes nothing (idempotent)
    sqlite.exec(sql); assert.equal(count(sqlite, "orders"), 35);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("the environment guard aborts a file written for another environment before anything changes", async () => {
  const { sqlite } = await setupV1({ rounds: false }), tmp = mkdtempSync(join(tmpdir(), "norx-imp-"));
  try {
    saveState(sqlite, join(tmp, "before"));
    const out = join(tmp, "sync-prod.sql"), p = run(["plan", ...common(tmp), "--out", out, "--env", "production"]); assert.equal(p.status, 0);
    assert.throws(() => sqlite.exec(readFileSync(out, "utf8")), /malformed JSON/i);
    assert.equal(count(sqlite, "orders"), 0, "nothing was written");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("a database that already holds synthetic ROUND-001/002 is a conflict: nothing is written; --round-prefix imports beside them", async () => {
  const { sqlite } = await setupV1(), tmp = mkdtempSync(join(tmpdir(), "norx-imp-")); // default setup has native ROUND-001 and ROUND-002
  try {
    saveState(sqlite, join(tmp, "before"));
    const out = join(tmp, "sync.sql"), blocked = run(["plan", ...common(tmp), "--out", out, "--env", "staging"]);
    assert.equal(blocked.status, 1); assert.match(blocked.stdout, /NOT written/); assert.ok(!existsSync(out));
    const ok = run(["plan", ...common(tmp, ["--round-prefix", "V1-"]), "--out", out, "--env", "staging"]); assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    sqlite.exec(readFileSync(out, "utf8"));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM rounds WHERE code LIKE 'V1-%'").get().n, 3);
    assert.equal(sqlite.prepare("SELECT status FROM rounds WHERE code='ROUND-001'").get().status, "open", "the existing round is untouched");
    saveState(sqlite, join(tmp, "after"));
    const v = run(["verify", "--orders", fx("snapshot-1-orders.csv"), "--rounds", fx("snapshot-1-rounds.csv"), "--state", join(tmp, "after"), "--round-prefix", "V1-"]);
    assert.equal(v.status, 0, v.stdout + v.stderr); assert.match(v.stdout, /"v2NativeOrders":0|"v2NativeOrders": 0/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("output inside the repo is refused unless it is git-ignored (private/ or .staging/)", async () => {
  const { sqlite } = await setupV1({ rounds: false }), tmp = mkdtempSync(join(tmpdir(), "norx-imp-"));
  try {
    saveState(sqlite, join(tmp, "before"));
    const r = run(["plan", ...common(tmp), "--out", join(root, "docs/oops-sync.sql"), "--env", "staging"]);
    assert.equal(r.status, 2); assert.match(r.stderr, /not in \/private\/|\.staging/); assert.ok(!existsSync(join(root, "docs/oops-sync.sql")));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("verify fails when the database does not match the export", async () => {
  const { sqlite } = await setupV1({ rounds: false }), tmp = mkdtempSync(join(tmpdir(), "norx-imp-"));
  try {
    saveState(sqlite, join(tmp, "before"));
    const out = join(tmp, "sync.sql"); assert.equal(run(["plan", ...common(tmp), "--out", out, "--env", "staging"]).status, 0);
    sqlite.exec(readFileSync(out, "utf8"));
    sqlite.prepare("UPDATE orders SET customer_name='ชื่อที่ถูกแก้' WHERE order_no=(SELECT order_no FROM orders ORDER BY id LIMIT 1)").run(); // someone edits an imported order behind the importer's back (money is protected by CHECK constraints)
    saveState(sqlite, join(tmp, "after"));
    const v = run(["verify", "--orders", fx("snapshot-1-orders.csv"), "--rounds", fx("snapshot-1-rounds.csv"), "--state", join(tmp, "after")]);
    assert.equal(v.status, 1); assert.match(v.stdout, /NOT VERIFIED/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
