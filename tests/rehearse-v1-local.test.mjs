import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// The cutover rehearsal script (import -> reconcile -> rollback export -> compare) must keep working; it is run on the owner's masked export before go/no-go.
// Here it runs on the SYNTHETIC fixtures only. Its output must hold verdicts and counts, never rows.
const root = fileURLToPath(new URL("../", import.meta.url)), fx = (f) => fileURLToPath(new URL("./fixtures/v1-anonymized/" + f, import.meta.url));

test("rehearse-v1-local: synthetic snapshot imports, reconciles, rolls back and compares clean", () => {
  const r = spawnSync(process.execPath, ["scripts/rehearse-v1-local.mjs", fx("snapshot-1-orders.csv"), fx("snapshot-1-rounds.csv")], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, "ALL CHECKS PASS");
  assert.ok(out.input.orders > 30 && out.money.orders === out.input.orders);
  assert.ok(Object.values(out.checks).every((v) => v === "PASS"));
  assert.ok(!/ลูกค้าทดสอบ|080000|ซอยทดสอบ/.test(r.stdout), "no customer-like values in the output");
});

test("rehearse-v1-local: bad arguments and wrong headers fail loudly", () => {
  assert.equal(spawnSync(process.execPath, ["scripts/rehearse-v1-local.mjs"], { cwd: root, encoding: "utf8" }).status, 2);
  const r = spawnSync(process.execPath, ["scripts/rehearse-v1-local.mjs", fx("snapshot-1-rounds.csv"), fx("snapshot-1-rounds.csv")], { cwd: root, encoding: "utf8" });
  assert.notEqual(r.status, 0, "rounds file passed as orders must not be accepted");
});
