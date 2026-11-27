import test from "node:test";
import assert from "node:assert/strict";
import pub from "../src/orders-public-worker.mjs";
import admin from "../src/orders-admin-worker.mjs";
import { submitOrder, pulse } from "../src/orders-service.mjs";
import { reportNotificationChannel, reportedNotificationReadiness, CHANNEL_REPORT_KEY, CHANNEL_REPORT_MAX_AGE_MS } from "../src/orders-notify.mjs";
import { setupV1, orderInput, call, NOW } from "./helpers/orders-env.mjs";

const recipient = async () => "owner@example.test";
const runCron = async env => { const jobs = []; await pub.scheduled({}, env, { waitUntil: p => jobs.push(p) }); await Promise.all(jobs); };
const snapshot = sqlite => sqlite.prepare("SELECT value FROM settings WHERE key=?").get(CHANNEL_REPORT_KEY)?.value;
const putSnapshot = (sqlite, value) => sqlite.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)").run(CHANNEL_REPORT_KEY, value);

test("Public cron reports its channel; Admin without a send binding reads it without sending", async () => {
  const { env, ctx, sqlite } = await setupV1(); let sends = 0;
  const sender = { ...env, EMAIL: { send: async () => { sends++; } }, NOTIFY_FROM: "alerts@example.test" };
  await runCron(sender);
  const r = await call(admin, env, ctx, "/api/admin/notifications");
  assert.equal(r.status, 200);
  const ready = (await r.json()).readiness;
  assert.deepEqual([ready.mode, ready.ready, ready.source, sends], ["email", true, "public_worker", 0]);
  assert.ok(ready.checkedAt); assert.deepEqual(ready.missing, []);
  const saved = snapshot(sqlite);
  assert.ok(!saved.includes("@") && !saved.includes("NOTIFY_FROM") && !saved.includes("owner"), "report stores no sender, recipient or provider details");
});

test("Admin's own email binding cannot turn an absent or stale Public report green", async () => {
  const { env } = await setupV1();
  const adminEnv = { ...env, EMAIL: { send() { throw Error("must not send"); } }, NOTIFY_FROM: "alerts@example.test" };
  assert.equal((await reportedNotificationReadiness(adminEnv, recipient, { now: NOW })).mode, "unknown");
  await reportNotificationChannel(adminEnv, { now: NOW });
  const fresh = await reportedNotificationReadiness(adminEnv, recipient, { now: NOW + CHANNEL_REPORT_MAX_AGE_MS });
  assert.equal(fresh.ready, true);
  const stale = await reportedNotificationReadiness(adminEnv, recipient, { now: NOW + CHANNEL_REPORT_MAX_AGE_MS + 1 });
  assert.deepEqual([stale.mode, stale.ready], ["unknown", false]);
});

test("reports missing channel/sender and uses the CURRENT recipient rather than an old snapshot", async () => {
  const { env } = await setupV1();
  await reportNotificationChannel(env, { now: NOW });
  assert.deepEqual((await reportedNotificationReadiness(env, recipient, { now: NOW })).missing, ["ช่องทางส่ง (Email binding หรือ webhook)"]);
  env.EMAIL = { send() {} };
  await reportNotificationChannel(env, { now: NOW });
  assert.deepEqual((await reportedNotificationReadiness(env, recipient, { now: NOW })).missing, ["อีเมลผู้ส่ง (NOTIFY_FROM)"]);
  env.NOTIFY_FROM = "alerts@example.test";
  await reportNotificationChannel(env, { now: NOW });
  assert.equal((await reportedNotificationReadiness(env, recipient, { now: NOW })).ready, true);
  const missing = await reportedNotificationReadiness(env, async () => "", { now: NOW });
  assert.equal(missing.ready, false); assert.match(missing.missing[0], /ผู้รับ/);
  delete env.EMAIL; env.NOTIFY_WEBHOOK_URL = "https://example.test/hook";
  await reportNotificationChannel(env, { now: NOW });
  assert.equal((await reportedNotificationReadiness(env, recipient, { now: NOW })).mode, "webhook");
});

test("malformed, cross-environment and future-dated reports are unknown, never ready", async () => {
  const { env, sqlite } = await setupV1();
  env.EMAIL = { send() {} }; env.NOTIFY_FROM = "alerts@example.test";
  await reportNotificationChannel(env, { now: NOW });
  const valid = JSON.parse(snapshot(sqlite));
  const corruptDb = { prepare: () => ({ bind: () => ({ first: async () => ({ value: "not json" }) }) }) };
  assert.equal((await reportedNotificationReadiness({ ...env, ORDERS_DB: corruptDb }, recipient, { now: NOW })).ready, false);
  for (const bad of ["null", JSON.stringify({ ...valid, environment: "production" }), JSON.stringify({ ...valid, mode: "unexpected" }), JSON.stringify({ ...valid, senderConfigured: "true" }), JSON.stringify({ ...valid, checkedAt: new Date(NOW + 60001).toISOString() })]) {
    putSnapshot(sqlite, bad);
    const r = await reportedNotificationReadiness(env, recipient, { now: NOW });
    assert.deepEqual([r.mode, r.ready], ["unknown", false]);
  }
});

test("report persistence failure does not block existing queued notification delivery", async () => {
  const { env, sqlite } = await setupV1(); await submitOrder(env, orderInput(), { now: NOW });
  const db = env.ORDERS_DB; let sends = 0; const logs = [], previous = console.error;
  env.ORDERS_DB = { ...db, prepare: sql => { if (sql.startsWith("INSERT INTO settings(key,value) VALUES (?1,?2)")) throw Error("private provider details"); return db.prepare(sql); } };
  env.EMAIL = { send: async () => { sends++; return { messageId: "test-message" }; } }; env.NOTIFY_FROM = "alerts@example.test";
  console.error = (...args) => logs.push(args.join(" "));
  const previousNow = Date.now; Date.now = () => NOW + 1000;
  try { await runCron(env); } finally { console.error = previous; Date.now = previousNow; }
  assert.equal(sends, 1); assert.equal(sqlite.prepare("SELECT status FROM notification_queue").get().status, "sent");
  assert.deepEqual(logs, ["notification channel report failed"]); assert.equal(snapshot(sqlite), undefined);
});

test("environment guard prevents both reports and sends against the wrong database", async () => {
  const { env, sqlite } = await setupV1(); let sends = 0;
  await runCron({ ...env, ENVIRONMENT: "production", ORDERS_DB_LABEL: "production", EMAIL: { send: async () => { sends++; } } });
  assert.equal(snapshot(sqlite), undefined); assert.equal(sends, 0);
});

test("pulse changes when the sender report arrives or expires, even without new orders", async () => {
  const { env } = await setupV1(); const previousNow = Date.now;
  Date.now = () => NOW;
  try {
    const unknown = await pulse(env);
    await reportNotificationChannel({ ...env, EMAIL: { send() {} }, NOTIFY_FROM: "alerts@example.test" }, { now: NOW });
    const fresh = await pulse(env);
    Date.now = () => NOW + CHANNEL_REPORT_MAX_AGE_MS + 1;
    const stale = await pulse(env);
    assert.notEqual(unknown.token, fresh.token); assert.notEqual(fresh.token, stale.token);
    assert.deepEqual(Object.keys(fresh).sort(), ["notifications", "orders", "token"]);
  } finally { Date.now = previousNow; }
});
