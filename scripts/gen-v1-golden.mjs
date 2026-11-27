// Records the outputs of Orders V1's pure logic ("NorxCore") on SYNTHETIC inputs into tests/fixtures/v1-golden.json.
// Usage: node scripts/gen-v1-golden.mjs /path/to/local/v1-source.txt
// The V1 source itself contains private configuration and must NEVER be committed; only the recorded
// input/output pairs (synthetic) are. Also usable as a live differential check: see tests/orders-core.golden.test.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";

export function loadV1Core(path) {
  const src = readFileSync(path, "utf8"), a = src.indexOf("NorxCore=(()=>{"), b = src.indexOf("})();", a) + 5;
  if (a < 0 || b < 5) throw new Error("NorxCore block not found");
  return vm.runInNewContext("const " + src.slice(a, b).replace(/;$/, "") + ";NorxCore", {});
}
const attempt = (f) => { try { return { out: f() }; } catch (e) { return { error: e.message }; } };
let seed = 20261127; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32), pick = (a) => a[Math.floor(rnd() * a.length)], int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

export const catalog = { products: [
  { id: "drop03", name: "HOME TERRAIN EDITION", short: "DROP 03", fit: "boxy", fitName: "ทรง Boxy", sizes: ["XS", "S", "M", "L", "XL", "2XL"], prices: { short: 490, long: 590 } },
  { id: "drop02", name: "WOVEN STRIDE EDITION", short: "DROP 02", fit: "regular", fitName: "ทรงปกติ", sizes: ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"], prices: { short: 490, long: 590 } },
] };
const T0 = Date.parse("2026-12-01T00:00:00+07:00");
const mkRound = (o) => Object.assign({ id: "ROUND-001", name: "รอบ 1", opensAt: "2026-12-01T00:00:00+07:00", closesAt: "2026-12-06T23:59:00+07:00", paymentDue: "2026-12-07T10:00:00+07:00", state: "open", shipping: 50, supplierShipping: 80, deliveries: ["city", "event", "ship"], readyText: "สินค้าพร้อมประมาณ 20 ธ.ค. – 28 ธ.ค.", sentAt: null }, o);
export const rounds = [mkRound({}), mkRound({ id: "ROUND-002", name: "รอบ 2", opensAt: "2026-12-07T00:00:00+07:00", closesAt: "2026-12-13T23:59:00+07:00", shipping: 60, deliveries: ["city", "ship"] }),
  mkRound({ id: "ROUND-003", name: "สั่งก่อนปีใหม่", state: "closed" }), mkRound({ id: "ROUND-004", name: "รอบ 4", state: "sent", sentAt: "2026-12-08T10:00:00Z" }), mkRound({ id: "ROUND-005", state: "draft" })];

const valid = () => ({ requestId: "req-" + "abcdef0123456789".repeat(2).slice(0, 20), roundId: "ROUND-001", name: "ทดสอบ นามสมมติ", phone: "080-000-0000", delivery: pick(["city", "event", "ship"]), address: "99/9 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 50000",
  items: [{ product: "drop03", fit: "boxy", sleeve: "short", size: "M", qty: 2 }, { product: "drop02", fit: "regular", sleeve: "long", size: "XXS", qty: 1 }], preorder: true, sizing: true, privacy: true, website: "", expectedTotal: 0 });
const mutations = [
  (o) => { o.requestId = pick(["short", "has space needed!!", "", 123, "x".repeat(81)]); }, (o) => { o.name = pick(["", "a", " b ", "x".repeat(121), 5, "  ทดสอบ    ชื่อ  "]); },
  (o) => { o.phone = pick(["", "123", "0800000000", "(080) 000-0000", "08000000000", "abc", 800000000]); }, (o) => { o.delivery = pick(["", "pickup", "ship", "city", "event", undefined]); },
  (o) => { o.delivery = "ship"; o.address = pick(["", "สั้น 50000", "ที่อยู่ยาวพอแต่ไม่มีรหัสไปรษณีย์", "ที่อยู่ 123456 หกหลัก ไม่ใช่รหัส", "x".repeat(1001), "บ้านเลขที่ 1 ถนนทดสอบ 50000"]); },
  (o) => { o[pick(["preorder", "sizing", "privacy"])] = pick([false, "true", undefined]); }, (o) => { o.website = pick(["x", "http://spam"]); },
  (o) => { o.items = pick([[], null, "x", Array.from({ length: 101 }, () => ({ product: "drop03", fit: "boxy", sleeve: "short", size: "M", qty: 1 }))]); },
  (o) => { if (o.items?.[0] && typeof o.items[0] === 'object') Object.assign(o.items[0], pick([{ product: "nope" }, { fit: "regular" }, { size: "XXS" }, { sleeve: "mid" }, { qty: 0 }, { qty: 100 }, { qty: 1.5 }, { qty: "2" }])); },
  (o) => { if (Array.isArray(o.items) && o.items[0]) o.items.push({ ...o.items[0], qty: pick([1, 50, 98, 99]) }); }, (o) => { o.items = [null]; }, (o) => { o.roundId = pick(["ROUND-002", "NOPE", undefined, 7, "ROUND-005", "ROUND-004"]); }, () => {},
];
const cases = { normalize: [], quote: [], fingerprint: [], rounds: [], summary: [], moves: [], receipt: [] };

export function build(core) {
  seed = 20261127;
  for (const k of Object.keys(cases)) cases[k] = [];
  for (let i = 0; i < 260; i++) {
    const o = valid(); for (let k = int(0, 2); k > 0; k--) pick(mutations)(o);
    const n = attempt(() => core.normalize(o, catalog)); cases.normalize.push({ input: o, ...n });
    if (n.out) {
      cases.fingerprint.push({ normalized: n.out, sha256: createHash("sha256").update(JSON.stringify(n.out)).digest("hex") });
      for (const now of [T0 + 3 * 864e5, T0 - 864e5, Date.parse("2026-12-10T12:00:00+07:00")]) {
        const cfg = { products: catalog.products, rounds }, q = attempt(() => core.quote(n.out, cfg, now)); cases.quote.push({ normalized: n.out, now, ...q });
        if (q.out) cases.receipt.push({ order: { ...q.out, id: "NORX-TESTTEST", name: n.out.name, roundId: n.out.roundId, status: "รอโอน" }, out: core.receipt({ ...q.out, id: "NORX-TESTTEST", name: n.out.name, roundId: n.out.roundId, status: "รอโอน" }) });
      }
    }
  }
  // price edge cases: unavailable / zero / non-integer price in catalog
  for (const price of [undefined, 0, -5, 490.5, "490", null]) {
    const cfg = { products: [{ ...catalog.products[0], prices: { short: price, long: 590 } }], rounds }, o = { ...valid(), delivery: "city", items: [{ product: "drop03", fit: "boxy", sleeve: "short", size: "M", qty: 1 }] };
    cases.quote.push({ normalized: core.normalize(o, catalog), now: T0 + 864e5, config: cfg, ...attempt(() => core.quote(core.normalize(o, catalog), cfg, T0 + 864e5)) });
  }
  // rounds: time-based behaviour on many instants (incl. exact boundaries, Sunday cut-off edges)
  const edges = rounds.flatMap((r) => [r.opensAt, r.closesAt].map(Date.parse)).flatMap((t) => [t - 1, t, t + 1]);
  const instants = [...edges, ...Array.from({ length: 70 }, () => T0 + int(-10, 40) * 864e5 + int(0, 864e5 - 1))];
  const cfgs = [{ products: catalog.products, rounds }, { products: catalog.products, rounds: [rounds[2]] }, { products: catalog.products, rounds: [rounds[3], rounds[2]] }, { products: catalog.products, rounds: [] }];
  for (const t of instants) {
    cfgs.forEach((cfg, ci) => cases.rounds.push({ ci, t, current: (core.currentRound(cfg, t) || {}).id ?? null, next: (core.nextRound(cfg, t) || {}).id ?? null, source: (core.rollingSource(cfg, t) || {}).id ?? null, phases: cfg.rounds.map((r) => core.phase(r, t)), accepting: cfg.rounds.map((r) => core.accepting(r, t)) }));
    cases.rounds.push({ cutoff: t, out: core.nextSundayCutoff(t) });
  }
  for (const r of [...rounds, mkRound({ name: "สั่งก่อนปีใหม่ 9", paymentDue: null }), mkRound({ name: "", deliveries: ["event"] }), mkRound({ id: "R", name: "รอบ 12", closesAt: "2026-12-13T23:59:00+07:00", paymentDue: "2026-12-13T10:00:00+07:00" })])
    for (const o of [undefined, { minDays: 3, maxDays: 9 }]) cases.rounds.push({ successorOf: r, opts: o, out: core.weeklySuccessor(r, o) });
  cases.rounds.push({ ready: [1_800_000_000_000, 7, 15], out: core.readyEstimate(1_800_000_000_000, 7, 15) });
  // summary + shopText over random order books
  const sts = Object.values(core.STATUS);
  for (let i = 0; i < 60; i++) {
    const orders = Array.from({ length: int(0, 14) }, (_, k) => { const items = Array.from({ length: int(1, 3) }, () => { const p = pick(catalog.products); return { product: p.id, fit: p.fit, sleeve: pick(["short", "long"]), size: pick(p.sizes), qty: int(1, 5) }; }); const subtotal = items.reduce((n, x) => n + x.qty * 490, 0), shipping = pick([0, 50]); return { id: "O" + k, roundId: pick(["ROUND-001", "ROUND-002"]), status: pick(sts), items, total: subtotal + shipping }; });
    const r = pick(rounds), cfg = { products: catalog.products, rounds }, s = core.summary(orders, r, cfg);
    cases.summary.push({ orders, round: r, out: s, shopText: core.shopText(s, r, cfg) });
  }
  for (const a of [...sts, "เห็นยอดแล้ว", "x"]) { cases.moves.push({ legacy: a, out: core.legacyStatus(a) }); for (const b of sts) cases.moves.push({ from: a, to: b, out: core.canMove(a, b) }); }
  return { generatedFrom: "NorxCore pure logic (V1), synthetic inputs only", catalog, rounds, cases };
}
if (process.argv[1]?.endsWith("gen-v1-golden.mjs")) {
  const path = process.argv[2]; if (!path) throw new Error("usage: node scripts/gen-v1-golden.mjs <v1-source-file>");
  const g = build(loadV1Core(path)), json = JSON.stringify(g);
  writeFileSync(new URL("../tests/fixtures/v1-golden.json", import.meta.url), json + "\n");
  console.log("golden written:", Object.fromEntries(Object.entries(g.cases).map(([k, v]) => [k, v.length])), (json.length / 1024).toFixed(0) + "KB");
}
