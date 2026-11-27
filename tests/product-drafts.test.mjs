import test from "node:test";
import assert from "node:assert/strict";
import { setupV1, call, orderInput, NOW, origin } from "./helpers/orders-env.mjs";
import { listProducts, saveDraft } from "../src/product-drafts.mjs";
import * as svc from "../src/orders-service.mjs";
import worker from "../src/orders-admin-worker.mjs";
const draft = (extra = {}) => ({ slug: "drop04-test", name: "DROP 04 TEST", shortName: "DROP 04", fit: "boxy", fitName: "ทรง Boxy", description: "รายละเอียดสมมติ", collectionId: null, prices: { short: 490, long: 590 }, sizes: ["S", "M", "L"], ...extra });
const count = (db, table) => db.prepare("SELECT COUNT(*) n FROM " + table).get().n;
test("draft create/update is atomic, audited, and never enters the public catalog", async () => {
  const { env, sqlite } = await setupV1(), before = await svc.loadConfig(env);
  const created = await saveDraft(env, "test-actor", draft());
  assert.equal(created.status, "draft"); assert.equal(created.editable, true); assert.ok(created.revision > 0);
  const updated = await saveDraft(env, "test-actor", draft({ expectedRevision: created.revision, name: "Updated draft", prices: { long: 650 }, sizes: ["M", "XL"] }), created.id);
  assert.deepEqual(updated.prices, { long: 650 }); assert.deepEqual(updated.sizes, ["M", "XL"]); assert.ok(updated.revision > created.revision);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity='products'").get().n, 2);
  assert.deepEqual(await svc.loadConfig(env), before);
});
test("active/archived/referenced products and immutable slug cannot be edited", async () => {
  const { env, sqlite } = await setupV1();
  await assert.rejects(saveDraft(env, "test-actor", draft({ slug: "drop03", expectedRevision: 0 }), 1), /ดูข้อมูลได้อย่างเดียว/);
  const created = await saveDraft(env, "test-actor", draft());
  await assert.rejects(saveDraft(env, "test-actor", draft({ slug: "another-slug", expectedRevision: created.revision }), created.id), /ข้อมูลเปลี่ยน/);
  sqlite.prepare("UPDATE products SET status='archived' WHERE id=?").run(created.id);
  await assert.rejects(saveDraft(env, "test-actor", draft({ expectedRevision: created.revision }), created.id), /ดูข้อมูลได้อย่างเดียว/);
  await svc.submitOrder(env, orderInput(), { now: NOW }); sqlite.prepare("UPDATE products SET status='draft' WHERE id=1").run();
  assert.equal((await listProducts(env)).products.find(p => p.id === 1).editable, false);
  await assert.rejects(saveDraft(env, "test-actor", draft({ slug: "drop03", expectedRevision: 0 }), 1), /ดูข้อมูลได้อย่างเดียว/);
});
test("invalid payloads, duplicate slug and bad collection leave no partial rows", async () => {
  const { env, sqlite } = await setupV1();
  for (const payload of [null, [], draft({ status: "active" }), draft({ prices: { short: 0 } }), draft({ prices: { short: 2.5 } }), draft({ prices: {} }), draft({ sizes: ["M", "m"] }), draft({ sizes: [] }), draft({ collectionId: 999 }), draft({ name: "" }), draft({ slug: "../bad" }), draft({ description: "x".repeat(3001) })]) {
    await assert.rejects(saveDraft(env, "test-actor", payload)); assert.equal(count(sqlite, "products"), 2); assert.equal(count(sqlite, "audit_log"), 0);
  }
  await saveDraft(env, "test-actor", draft()); const variants = count(sqlite, "product_variants");
  await assert.rejects(saveDraft(env, "test-actor", draft({ name: "Duplicate must not overwrite" })), /มีอยู่แล้ว/);
  assert.equal(count(sqlite, "products"), 3); assert.equal(count(sqlite, "product_variants"), variants); assert.equal(count(sqlite, "audit_log"), 1);
});
test("concurrent edits use an audit-backed revision lease, with no mixed sizes/prices", async () => {
  const { env, sqlite } = await setupV1(), p = await saveDraft(env, "test-actor", draft());
  const results = await Promise.allSettled([
    saveDraft(env, "writer-a", draft({ expectedRevision: p.revision, name: "A", prices: { short: 500 }, sizes: ["S"] }), p.id),
    saveDraft(env, "writer-b", draft({ expectedRevision: p.revision, name: "B", prices: { long: 700 }, sizes: ["XL"] }), p.id),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(results.filter(r => r.status === "rejected").length, 1);
  const current = (await listProducts(env)).products.find(v => v.id === p.id);
  assert.deepEqual([current.prices, current.sizes], current.name === "A" ? [{ short: 500 }, ["S"]] : [{ long: 700 }, ["XL"]]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='product.draft.update'").get().n, 1);
  await assert.rejects(saveDraft(env, "test-actor", draft({ expectedRevision: p.revision }), p.id), /ข้อมูลเปลี่ยน/);
});
test("injected child-write failure rolls product and audit back together", async () => {
  const { env, sqlite, hooks } = await setupV1(); hooks.onStatement = sql => { if (sql.startsWith("INSERT INTO product_variants")) throw Error("synthetic failure"); };
  await assert.rejects(saveDraft(env, "test-actor", draft()), /synthetic failure/);
  assert.equal(count(sqlite, "products"), 2); assert.equal(count(sqlite, "audit_log"), 0);
});
test("draft uses an existing collection without changing collection status", async () => {
  const { env, sqlite } = await setupV1();
  sqlite.exec("INSERT INTO collections(id,slug,name,status) VALUES(1,'test-collection','TEST COLLECTION','draft')");
  const p = await saveDraft(env, "test-actor", draft({ collectionId: 1 }));
  assert.equal(p.collectionName, "TEST COLLECTION"); assert.equal(p.status, "draft");
  assert.equal(sqlite.prepare("SELECT status FROM collections WHERE id=1").get().status, "draft");
});
test("failure partway through draft edit preserves revision, data and audit", async () => {
  const { env, sqlite, hooks } = await setupV1(), p = await saveDraft(env, "test-actor", draft());
  hooks.onStatement = sql => { if (sql.startsWith("UPDATE product_sizes")) throw Error("synthetic edit failure"); };
  await assert.rejects(saveDraft(env, "test-actor", draft({ expectedRevision: p.revision, name: "Must rollback", prices: { short: 999 } }), p.id), /synthetic edit failure/);
  assert.deepEqual((await listProducts(env)).products.find(v => v.id === p.id), p); assert.equal(count(sqlite, "audit_log"), 1);
});
test("draft preparation cannot change existing order snapshots, totals or active prices", async () => {
  const { env, sqlite } = await setupV1(), input = orderInput(), original = await svc.submitOrder(env, input, { now: NOW });
  const items = JSON.stringify(sqlite.prepare("SELECT * FROM order_items").all()), active = await svc.loadConfig(env);
  const p = await saveDraft(env, "test-actor", draft()); await saveDraft(env, "test-actor", draft({ expectedRevision: p.revision, prices: { short: 999 }, sizes: ["XS"] }), p.id);
  assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM order_items").all()), items);
  assert.deepEqual(await svc.submitOrder(env, input, { now: NOW }), original); assert.deepEqual(await svc.loadConfig(env), active);
});
test("Products API retains owner/environment/same-origin gates and refuses publish/delete", async () => {
  const { env, ctx } = await setupV1();
  for (const [method, path, body] of [["GET", "/api/admin/products"], ["POST", "/api/admin/products", draft()], ["PUT", "/api/admin/products/1", draft()]]) {
    assert.equal((await call(worker, env, {}, path, { method, body })).status, 403);
    assert.equal((await call(worker, env, { access: { aud: "aud", getIdentity: async () => ({ email: "intruder@example.test" }) } }, path, { method, body })).status, 403);
  }
  assert.equal((await call(worker, env, ctx, "/api/admin/products", { method: "POST", body: draft(), headers: { Origin: "https://evil.test" } })).status, 403);
  assert.equal((await call(worker, { ...env, ORDERS_DB_LABEL: "wrong" }, ctx, "/api/admin/products")).status, 503);
  assert.equal((await call(worker, env, ctx, "/api/admin/products", { method: "POST", body: draft({ status: "active" }) })).status, 400);
  const made = await call(worker, env, ctx, "/api/admin/products", { method: "POST", body: draft() }); assert.equal(made.status, 200);
  const p = (await made.json()).product;
  assert.equal((await call(worker, env, ctx, "/api/admin/products/" + p.id, { method: "DELETE" })).status, 405);
  assert.equal((await call(worker, env, ctx, "/api/admin/products/" + p.id, { method: "PUT", body: draft({ expectedRevision: p.revision, name: "API update" }) })).status, 200);
  assert.equal((await call(worker, env, ctx, "/api/admin/products/publish", { method: "POST", body: {} })).status, 404);
  const malformed = await worker.fetch(new Request(origin + "/api/admin/products", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{" }), env, ctx); assert.equal(malformed.status, 400);
});
