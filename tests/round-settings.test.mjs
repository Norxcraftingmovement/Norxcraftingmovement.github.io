import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/orders-admin-worker.mjs";
import * as svc from "../src/orders-service.mjs";
import { setup, setupV1, call, T0, DAY } from "./helpers/orders-env.mjs";

const base = { name: "รอบ งาน", opensAt: "2026-12-01T00:00", closesAt: "2026-12-06T23:59", paymentDue: "2026-12-07T10:00", shipping: 50, supplierShipping: 0, readyText: "" };
const roundOf = async (env, id) => (await svc.loadConfig(env)).rounds.find((r) => r.id === id);

test("event name per round: required while 'รับที่งาน' is offered, cleaned up, dropped when the option is removed", async () => {
  const { env } = await setupV1({ rounds: false });
  for (const eventName of ["", "   ", undefined, "x".repeat(121)]) await assert.rejects(svc.saveRound(env, "t", { ...base, deliveries: ["city", "event"], eventName }), /ชื่อกิจกรรม/);
  const { id } = await svc.saveRound(env, "t", { ...base, deliveries: ["city", "event"], eventName: "  งานวิ่ง   เชียงราย  " });
  assert.equal((await roundOf(env, id)).eventName, "งานวิ่ง เชียงราย", "trimmed and single-spaced");
  await svc.saveRound(env, "t", { ...base, id, deliveries: ["city", "event"], eventName: "งานตลาด" });
  assert.equal((await roundOf(env, id)).eventName, "งานตลาด", "editable");
  await svc.saveRound(env, "t", { ...base, id, deliveries: ["city"], eventName: "งานเก่าที่ไม่ควรค้าง" });
  assert.equal((await roundOf(env, id)).eventName, "", "no event option = no stale event name");
  const noEvent = await svc.saveRound(env, "t", { ...base, deliveries: ["city", "ship"], eventName: "ถูกเมินเพราะไม่มีตัวเลือกงาน" });
  assert.equal((await roundOf(env, noEvent.id)).eventName, "");
});

test("the storefront gets the event name of the round being sold; rounds without one fall back to the shop-wide name", async () => {
  const { env, sqlite } = await setupV1({ rounds: false });
  const a = await svc.saveRound(env, "t", { ...base, deliveries: ["city", "event"], eventName: "งานวิ่ง เชียงราย" });
  sqlite.prepare("UPDATE rounds SET status='open' WHERE code=?").run(a.id);
  const cfg = await svc.publicConfig(env, T0 + DAY);
  assert.equal(cfg.round.id, a.id); assert.equal(cfg.round.eventName, "งานวิ่ง เชียงราย");
  assert.equal(cfg.eventName, "TEST EVENT", "shop-wide name still delivered as the fallback");
  sqlite.prepare("UPDATE rounds SET event_name='' WHERE code=?").run(a.id);
  assert.equal((await svc.publicConfig(env, T0 + DAY)).round.eventName, "", "storefront then uses cfg.eventName");
});

test("the storefront code picks the round's event name first (shop.js)", async () => {
  const { readFileSync } = await import("node:fs");
  const js = readFileSync(new URL("../shop.js", import.meta.url), "utf8");
  assert.match(js, /ROUND\.eventName\|\|CONFIG\.eventName\|\|'กิจกรรม NORX'/);
});

test("weekly rounds switch: flips only 'rolling', audits the change, refuses anonymous callers, bad input and an unconfigured shop", async () => {
  const { env, ctx, sqlite } = await setup();
  const put = (body, scope = ctx) => call(worker, env, scope, "/api/admin/settings/rolling", { method: "PUT", body });
  assert.equal((await put({ rolling: true })).status, 409, "no storefront settings yet");
  const store = { bank: { name: "TEST BANK", account: "000-0-00000-0", holder: "TEST HOLDER" }, chatUrl: "https://example.test/c", pageUrl: "https://example.test/p", eventName: "TEST", liveEnabled: false, rolling: false, notifyTo: "owner@example.test", testKeyHash: "abc" };
  sqlite.prepare("INSERT INTO settings(key,value) VALUES ('storefront',?)").run(JSON.stringify(store));
  assert.equal((await put({ rolling: true }, {})).status, 403, "anonymous");
  for (const bad of [{}, { rolling: "yes" }, { rolling: 1 }]) assert.equal((await put(bad)).status, 400, JSON.stringify(bad));
  assert.equal((await put({ rolling: true })).status, 200);
  assert.deepEqual(await svc.getSetting(env, "storefront"), { ...store, rolling: true }, "everything else (bank, test key hash, live switch) untouched");
  const audit = sqlite.prepare("SELECT before,after FROM audit_log WHERE action='rolling.update'").all();
  assert.equal(audit.length, 1); assert.deepEqual([JSON.parse(audit[0].before), JSON.parse(audit[0].after)], [{ rolling: false }, { rolling: true }]);
  assert.equal((await put({ rolling: false })).status, 200);
  assert.equal((await svc.getSetting(env, "storefront")).rolling, false);
});

test("automatic weekly rounds still never carry the event option to the next round", async () => {
  const { env } = await setupV1({ rolling: true, rounds: false });
  const a = await svc.saveRound(env, "t", { ...base, deliveries: ["city", "event", "ship"], eventName: "งานวิ่ง" });
  await env.ORDERS_DB.prepare("UPDATE rounds SET status='sent',sent_at='2026-12-08T00:00:00.000Z' WHERE code=?1").bind(a.id).run();
  const cfg = await svc.publicConfig(env, T0 + 8 * DAY); // a few days after the first round closed (Dec 6): the successor is selling
  assert.ok(cfg.round, "a successor round was created and is selling");
  assert.deepEqual(cfg.round.deliveries, ["city", "ship"]);
  assert.equal(cfg.round.eventName, "");
});
