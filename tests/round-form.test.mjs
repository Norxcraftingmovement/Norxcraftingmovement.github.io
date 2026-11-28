import test from "node:test";
import assert from "node:assert/strict";
import { toLocalInput, defaultRound, roundToForm, roundBody } from "../admin-ui/round-form.mjs";
import * as svc from "../src/orders-service.mjs";
import { setupV1 } from "./helpers/orders-env.mjs";

const NOW = Date.parse("2026-11-27T09:00:00Z"); // 16:00 in Bangkok

test("times are shown and entered in Bangkok time (UTC+7, no DST)", () => {
  assert.equal(toLocalInput("2026-11-27T09:00:00.000Z"), "2026-11-27T16:00");
  assert.equal(toLocalInput("2026-12-31T17:00:00.000Z"), "2027-01-01T00:00", "crosses midnight into the next Bangkok day");
  assert.equal(toLocalInput(null), ""); assert.equal(toLocalInput(""), "");
  assert.equal(toLocalInput(NOW), "2026-11-27T16:00");
});

test("a new round starts now, closes in 7 days 23:59, due next day 10:00; fees and delivery copy the previous round; with no previous round money stays empty", () => {
  const first = defaultRound(NOW, []);
  assert.deepEqual(first, { name: "รอบ 1", opensAt: "2026-11-27T16:00", closesAt: "2026-12-04T23:59", paymentDue: "2026-12-05T10:00", deliveries: ["city", "ship"], shipping: "", supplierShipping: "", readyText: "", eventName: "" });
  const prev = [{ deliveries: ["city", "event", "ship"], shipping: 50, supplierShipping: 80, readyText: "พร้อมประมาณ 20 พ.ย.", eventName: "งานรอบก่อน" }];
  assert.deepEqual(defaultRound(NOW, prev), { ...first, name: "รอบ 2", deliveries: ["city", "event", "ship"], shipping: "50", supplierShipping: "80", readyText: "พร้อมประมาณ 20 พ.ย.", eventName: "" }, "the previous event name is NOT copied");
});

test("form values become the request body; what the server would reject is caught first, with the same wording", () => {
  const ok = { name: "  รอบ 5 ", opensAt: "2026-12-01T00:00", closesAt: "2026-12-06T23:59", paymentDue: "2026-12-07T10:00", deliveries: ["ship", "city"], shipping: "50", supplierShipping: "80", readyText: " x " };
  assert.deepEqual(roundBody(ok).body, { name: "รอบ 5", opensAt: ok.opensAt, closesAt: ok.closesAt, paymentDue: ok.paymentDue, deliveries: ["city", "ship"], eventName: "", shipping: 50, supplierShipping: 80, readyText: "x" });
  const ev = roundBody({ ...ok, deliveries: ["event", "city"], eventName: "  งานวิ่ง   เชียงราย " }).body;
  assert.deepEqual([ev.deliveries, ev.eventName], [["city", "event"], "งานวิ่ง เชียงราย"]);
  assert.equal(roundBody({ ...ok, deliveries: ["city"], eventName: "ค้างจากครั้งก่อน" }).body.eventName, "", "no event option: any typed name is dropped");
  assert.match(roundBody({ ...ok, deliveries: ["city", "event"], eventName: "  " }).error, /ชื่อกิจกรรม/);
  assert.match(roundBody({ ...ok, deliveries: ["event"], eventName: "x".repeat(121) }).error, /ชื่อกิจกรรม/);
  assert.equal(roundBody(ok, "ROUND-004").body.id, "ROUND-004");
  const bad = (patch) => roundBody({ ...ok, ...patch }).error;
  assert.match(bad({ name: "ก" }), /ตั้งชื่อรอบ/);
  assert.match(bad({ closesAt: "" }), /ให้ครบ/);
  assert.match(bad({ closesAt: "2026-11-30T00:00" }), /ปิดรับต้องหลังวันเปิดรับ/);
  assert.match(bad({ paymentDue: "2026-12-06T10:00" }), /กำหนดโอนต้องไม่ก่อน/);
  assert.match(bad({ deliveries: [] }), /วิธีรับสินค้า/);
  assert.match(bad({ shipping: "" }), /ค่าส่งลูกค้า/); assert.match(bad({ shipping: "1001" }), /ค่าส่งลูกค้า/); assert.match(bad({ shipping: "5.5" }), /ค่าส่งลูกค้า/);
  assert.match(bad({ supplierShipping: "-1" }), /ค่าส่งร้าน/);
});

test("END TO END with the real service: the body the form builds creates a draft round with the right Bangkok times; editing it keeps the id; the form round-trips an existing round", async () => {
  const { env } = await setupV1({ rounds: false });
  const form = { ...defaultRound(NOW, []), name: "รอบ ทดสอบ", shipping: "50", supplierShipping: "0", deliveries: ["city", "event", "ship"], readyText: "พร้อมประมาณ ม.ค.", eventName: "งานทดสอบ" };
  const made = await svc.saveRound(env, "t", roundBody(form).body);
  assert.equal(made.id, "ROUND-001");
  let r = (await svc.loadConfig(env)).rounds.find((x) => x.id === made.id);
  assert.equal(r.state, "draft");
  assert.equal(r.opensAt, "2026-11-27T09:00:00.000Z", "16:00 Bangkok is stored as 09:00Z");
  assert.equal(r.closesAt, "2026-12-04T16:59:00.000Z");
  assert.deepEqual(roundToForm(r), { ...form }, "the edit form shows exactly what was typed");
  const edited = await svc.saveRound(env, "t", roundBody({ ...roundToForm(r), name: "รอบ ทดสอบ (แก้)", shipping: "60" }, r.id).body);
  assert.equal(edited.id, r.id);
  r = (await svc.loadConfig(env)).rounds.find((x) => x.id === made.id);
  assert.equal(r.name, "รอบ ทดสอบ (แก้)"); assert.equal(r.shipping, 60);
  assert.equal((await svc.loadConfig(env)).rounds.length, 1, "editing never creates a second round");
  const next = defaultRound(NOW, (await svc.loadConfig(env)).rounds);
  assert.match(roundBody(next).error, /ชื่อกิจกรรม/, "the next round copies the event option but must name its own event");
  const second = await svc.saveRound(env, "t", roundBody({ ...next, eventName: "งานรอบสอง" }).body);
  assert.equal(second.id, "ROUND-002", "numbering continues");
});
