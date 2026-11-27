// Generates SYNTHETIC V1-shaped exports (two snapshots: before/after V1 kept changing) and passes them through the
// real anonymiser, so fixtures exercise exactly the pipeline a real private export would go through.
// Usage: node scripts/make-anonymized-fixtures.mjs   (writes tests/fixtures/v1-anonymized/*.csv)
import { writeFileSync } from "node:fs";
import { anonymizeOrders, ordersToCsv, roundsToCsv } from "../src/v1-import.mjs";
import { STATUS as S } from "../src/orders-core.mjs";
let seed = 424242; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32), pick = (a) => a[Math.floor(rnd() * a.length)], int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const hex8 = () => Array.from({ length: 8 }, () => "0123456789ABCDEF"[int(0, 15)]).join("");
const P = { drop03: ["HOME TERRAIN EDITION", "boxy", "ทรง Boxy", ["XS", "S", "M", "L", "XL", "2XL"]], drop02: ["WOVEN STRIDE EDITION", "regular", "ทรงปกติ", ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL"]] };
const rounds = [
  { id: "ROUND-001", name: "รอบ 1", opensAt: "2026-11-01T00:00:00+07:00", closesAt: "2026-11-08T23:59:00+07:00", paymentDue: "2026-11-09T10:00:00+07:00", state: "ส่งร้านแล้ว", shipping: 50, supplierShipping: 80, deliveries: "city,event,ship", readyText: "สินค้าพร้อมประมาณ 20 พ.ย. – 28 พ.ย.", sentAt: "2026-11-10T03:00:00.000Z" },
  { id: "ROUND-002", name: "รอบ 2", opensAt: "2026-11-09T00:00:00+07:00", closesAt: "2026-11-15T23:59:00+07:00", paymentDue: "2026-11-16T10:00:00+07:00", state: "ปิดรับ", shipping: 50, supplierShipping: 80, deliveries: "city,ship", readyText: "", sentAt: "" },
  { id: "ROUND-003", name: "รอบ 3", opensAt: "2026-11-16T00:00:00+07:00", closesAt: "2026-11-22T23:59:00+07:00", paymentDue: "2026-11-23T10:00:00+07:00", state: "เปิดรับ", shipping: 50, supplierShipping: 80, deliveries: "city,ship", readyText: "", sentAt: "" },
];
const names = ["PII-คนหนึ่ง", "PII-คนสอง", "PII-คนสาม"], longAddr = "เลขที่ 123/45 อาคารสมมติเรสซิเดนซ์ ชั้น 12 ห้อง 1208 หมู่บ้านทดสอบวิลล์ ซอยทดสอบ 7 แยก 3 (ตรงข้ามร้านสมมติ) ถนนสมมติเหนือ แขวงทดสอบใต้ เขตสมมติ กรุงเทพมหานคร 10110 โทรก่อนส่ง";
function order(id, round, status, { delivery = "city", items, note = "", day = 2, by = "owner@example.test" } = {}) {
  items ||= [pick(Object.keys(P))].map((p) => ({ product: p, fit: P[p][1], sleeve: pick(["short", "long"]), size: pick(P[p][3]), qty: int(1, 3) }));
  const lines = items.map((i) => { const price = i.sleeve === "short" ? 490 : 590; return { ...i, name: P[i.product][0], fitName: P[i.product][2], unitPrice: price, lineTotal: price * i.qty }; });
  const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0), shipping = delivery === "ship" ? 50 : 0, r = rounds.find((x) => x.id === round);
  return { id, requestId: "req-" + id.toLowerCase() + "-" + hex8().toLowerCase(), fingerprint: "x", createdAt: new Date(Date.parse(r.opensAt) + day * 864e5).toISOString(), roundId: round, name: pick(names) + " " + id, phone: "0899" + String(int(0, 999999)).padStart(6, "0"),
    delivery, address: delivery === "ship" ? (id.endsWith("7") ? longAddr : "99/" + int(1, 99) + " ถนนส่วนตัว ตำบลจริง จังหวัดจริง " + pick(["50000", "57000", "10110", "10400"])) : "", subtotal, shipping, total: subtotal + shipping, status,
    updatedAt: status === S.PENDING ? "" : new Date(Date.parse(r.opensAt) + (day + 1) * 864e5).toISOString(), updatedBy: status === S.PENDING ? "" : by, details: JSON.stringify({ items: lines, round: { id: round, name: r.name, paymentDue: r.paymentDue, readyText: r.readyText } }), note };
}
const base = [];
let n = 0; const id = () => "NORX-" + hex8();
for (const [rd, sts] of [["ROUND-001", [S.DONE, S.DONE, S.SENT, S.SENT, S.CANCEL, S.DONE, S.SENT, S.LATER, S.DONE, S.SENT]], ["ROUND-002", [S.PAID, S.PAID, S.PENDING, S.LATER, S.PAID, S.PENDING, S.CANCEL, S.PAID, S.LATER, S.PENDING, S.PAID, S.PAID]], ["ROUND-003", [S.PENDING, S.PAID, S.PENDING, "เห็นยอดแล้ว", S.PENDING, S.LATER, S.PAID, S.PENDING]]])
  for (const st of sts) { const del = pick(["city", "ship", "ship", "event"]); const d = rd === "ROUND-003" && del === "event" ? "city" : rd === "ROUND-002" && del === "event" ? "ship" : del; base.push(order(id(), rd, st, { delivery: d, day: int(0, 5) })); n++; }
base[2] = { ...base[2], delivery: "ship", address: longAddr, total: base[2].subtotal + 50, shipping: 50 };
for (const [i, st] of [[1, S.PAID], [2, S.PENDING], [3, S.DONE]].map((x) => x)) base.push(order("NORX-LEGACY-00" + i, "ROUND-001", st, { delivery: "city", day: 1 }));
base.push(order(id(), "ROUND-003", S.PENDING, { note: "ทดสอบ", day: 6 }));
// two-item, multi-product, formula-guard names, multi-line address
base.push(order(id(), "ROUND-003", S.PENDING, { delivery: "ship", items: [{ product: "drop03", fit: "boxy", sleeve: "short", size: "M", qty: 2 }, { product: "drop02", fit: "regular", sleeve: "long", size: "XXS", qty: 1 }], day: 5 }));
base[base.length - 1].address = "'=HYPERLINK(\"x\") บ้านเลขที่ 5\nซอยทดสอบ 57000"; base[base.length - 1].name = "'=1+1 PII-สูตร";

// ----- snapshot 2: V1 kept being used (statuses moved, edits, new orders, cut-off, one row removed) -----
const snap2 = base.map((o) => ({ ...o })), at = (o) => new Date(Date.parse(o.createdAt) + 5 * 864e5).toISOString();
const byRound = (r) => snap2.filter((o) => o.roundId === r);
for (const o of byRound("ROUND-002")) { if (o.status === S.PENDING) { o.status = pick([S.PAID, S.CANCEL]); } else if (o.status === S.PAID) o.status = S.SENT; o.updatedAt = at(o); o.updatedBy = "owner@example.test"; }
const l2 = snap2.find((o) => o.roundId === "ROUND-001" && o.status === S.LATER); l2.status = S.DONE; l2.updatedAt = at(l2);
const r3p = byRound("ROUND-003").filter((o) => o.status === S.PENDING).slice(0, 2); r3p[0].status = S.PAID; r3p[1].status = S.LATER; for (const o of r3p) o.updatedAt = at(o);
const ship = snap2.find((o) => o.roundId === "ROUND-003" && o.delivery === "ship" && o.status !== S.PAID); if (ship) { ship.address = "แก้ไขที่อยู่ใหม่ 77/7 ถนนใหม่ ตำบลใหม่ จังหวัดใหม่ 50100"; ship.updatedAt = at(ship); }
const q = snap2.find((o) => o.roundId === "ROUND-003" && o.status === S.PENDING && o.delivery === "city"); if (q) { const it = JSON.parse(q.details); it.items[0].qty += 1; it.items[0].lineTotal = it.items[0].qty * it.items[0].unitPrice; q.details = JSON.stringify(it); q.subtotal = it.items.reduce((s, i) => s + i.lineTotal, 0); q.total = q.subtotal + q.shipping; q.updatedAt = at(q); }
snap2.splice(snap2.findIndex((o) => o.id === "NORX-LEGACY-002"), 1); // row deleted from the sheet -> orphan
for (let i = 0; i < 3; i++) snap2.push(order(id(), "ROUND-003", pick([S.PENDING, S.PAID]), { delivery: pick(["city", "ship"]), day: 6 }));
const rounds2 = rounds.map((r) => ({ ...r })); rounds2[1].state = "ส่งร้านแล้ว"; rounds2[1].sentAt = "2026-11-17T03:00:00.000Z"; rounds2[2].closesAt = "2026-11-23T23:59:00+07:00"; rounds2[2].paymentDue = "2026-11-24T10:00:00+07:00";

const dir = new URL("../tests/fixtures/v1-anonymized/", import.meta.url);
writeFileSync(new URL("snapshot-1-orders.csv", dir), ordersToCsv(await anonymizeOrders(base)));
writeFileSync(new URL("snapshot-2-orders.csv", dir), ordersToCsv(await anonymizeOrders(snap2)));
writeFileSync(new URL("snapshot-1-rounds.csv", dir), roundsToCsv(rounds));
writeFileSync(new URL("snapshot-2-rounds.csv", dir), roundsToCsv(rounds2));
console.log("orders:", base.length, "->", snap2.length, "| rounds:", rounds.length);
