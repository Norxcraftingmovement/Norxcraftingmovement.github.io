// Orders V2 pure business logic. Behaviour (including Thai error messages shown by the storefront) is
// a port of Orders V1 "NorxCore"; tests/orders-core.golden.test.mjs compares it against recorded V1 outputs.
// No I/O, no clock access (callers pass `now` in epoch ms), no secrets.
// UserError = safe to show to the customer/admin verbatim (Thai message); anything else is an internal fault.
export class UserError extends Error {}
const fail = (m) => { throw new UserError(m); };
const DAY = 864e5, TZ_MS = 252e5; // Asia/Bangkok = UTC+7, no DST

export const STATUS = { PENDING: "รอโอน", PAID: "ชำระแล้ว", SENT: "ส่งร้านแล้ว", DONE: "ส่งมอบแล้ว", CANCEL: "ยกเลิก", LATER: "จ่ายหน้างาน" };
export const PAID_LIKE = [STATUS.PAID, STATUS.SENT, STATUS.DONE];
export const MOVES = {
  [STATUS.PENDING]: [STATUS.PAID, STATUS.LATER, STATUS.CANCEL],
  [STATUS.LATER]: [STATUS.PAID, STATUS.PENDING, STATUS.CANCEL, STATUS.DONE],
  [STATUS.PAID]: [STATUS.PENDING, STATUS.CANCEL],
  [STATUS.SENT]: [STATUS.DONE],
  [STATUS.DONE]: [STATUS.SENT],
  [STATUS.CANCEL]: [STATUS.PENDING],
};
export const DELIVERY = { city: "นัดรับในเมืองเชียงราย", event: "รับที่งานกิจกรรม", ship: "จัดส่ง" };
export const legacyStatus = (s) => (s === "เห็นยอดแล้ว" ? STATUS.PAID : s);
export const canMove = (from, to) => (MOVES[from] || []).includes(to);
export const sleeveName = (s) => (s === "short" ? "แขนสั้น" : "แขนยาว");

// ---- Two-axis (V2) <-> V1 single status. Lossless for all six V1 statuses (see tests). ----
export const FROM_LEGACY = {
  [STATUS.PENDING]: { payment: "pending", fulfillment: "received" },
  [STATUS.PAID]: { payment: "confirmed", fulfillment: "received" },
  [STATUS.LATER]: { payment: "deferred_on_site", fulfillment: "received" }, // NOT paid
  [STATUS.SENT]: { payment: "confirmed", fulfillment: "in_production" },     // "ส่งร้านแล้ว" = sent to the shop/factory
  [STATUS.DONE]: { payment: "confirmed", fulfillment: "completed" },         // "ส่งมอบแล้ว"; V1 treats DONE as paid
  [STATUS.CANCEL]: { payment: "cancelled", fulfillment: "cancelled" },
};
export function toLegacy(payment, fulfillment) {
  if (fulfillment === "cancelled") return STATUS.CANCEL;
  if (fulfillment === "completed") return STATUS.DONE;
  if (fulfillment === "ready_pickup" && payment === "deferred_on_site") return STATUS.LATER;
  if (["in_production", "qc", "ready_pickup", "ready_ship", "shipped"].includes(fulfillment)) return STATUS.SENT;
  return { pending: STATUS.PENDING, slip_received: STATUS.PENDING, confirmed: STATUS.PAID, deferred_on_site: STATUS.LATER, cancelled: STATUS.CANCEL, refunded: STATUS.CANCEL }[payment] ?? fail("สถานะไม่ถูกต้อง");
}

// ---- Rounds ----
export const accepting = (r, t) => !!r && r.state === "open" && !!r.opensAt && !!r.closesAt && Date.parse(r.opensAt) <= t && t <= Date.parse(r.closesAt);
export const currentRound = (c, t) => c.rounds.find((r) => accepting(r, t)) || null;
export const nextRound = (c, t) => c.rounds.filter((r) => r.state === "open" && r.opensAt && Date.parse(r.opensAt) > t).sort((a, b) => Date.parse(a.opensAt) - Date.parse(b.opensAt))[0] || null;
const pad = (n) => String(n).padStart(2, "0");
const bkk = (ms) => {
  const d = new Date(ms + TZ_MS);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()) + "+07:00";
};
const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const dayLabel = (ms) => { const d = new Date(ms + TZ_MS); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; };
export function nextSundayCutoff(t) {
  const d = new Date(t + TZ_MS);
  let n = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 0) - TZ_MS;
  n += ((7 - new Date(n + TZ_MS).getUTCDay()) % 7) * DAY;
  if (n <= t + 432e5) n += 7 * DAY; // cut-off within 12h → next week
  return n;
}
export const readyEstimate = (cut, minDays, maxDays) => "สินค้าพร้อมประมาณ " + dayLabel(cut + (minDays + 1) * DAY) + " – " + dayLabel(cut + (maxDays + 1) * DAY);
export function weeklySuccessor(round, opts) {
  const o = Object.assign({ minDays: 7, maxDays: 15 }, opts || {});
  const start = Date.parse(round.closesAt) + 1000, cut = nextSundayCutoff(start);
  const gap = round.paymentDue && Date.parse(round.paymentDue) >= Date.parse(round.closesAt) ? Date.parse(round.paymentDue) - Date.parse(round.closesAt) : 3606e4;
  const m = String(round.name || "").match(/^(.*?)(\d+)\s*$/);
  return {
    name: m ? m[1] + (Number(m[2]) + 1) : "รอบถัดไป", opensAt: bkk(start), closesAt: bkk(cut), paymentDue: bkk(cut + gap), state: "open",
    shipping: round.shipping, supplierShipping: round.supplierShipping, deliveries: (round.deliveries || []).filter((d) => d !== "event"), readyText: readyEstimate(cut, o.minDays, o.maxDays),
  };
}
export function rollingSource(c, t) {
  if (currentRound(c, t) || nextRound(c, t)) return null;
  const r = c.rounds.filter((x) => x.state !== "draft" && x.closesAt).sort((a, b) => Date.parse(b.closesAt) - Date.parse(a.closesAt))[0];
  return r && Date.parse(r.closesAt) < t ? r : null;
}
export const phase = (r, t) => (r.state === "sent" ? "sent" : r.state === "draft" ? "draft" : r.state === "open" && r.opensAt && t < Date.parse(r.opensAt) ? "scheduled" : accepting(r, t) ? "accepting" : "closed");

// ---- Order input -> normalized order (also the idempotency fingerprint source) ----
export function normalize(input, config) {
  if (!input || typeof input !== "object") fail("ข้อมูลออเดอร์ไม่ถูกต้อง");
  if (!(typeof input.requestId === "string" && /^[-a-zA-Z0-9]{16,80}$/.test(input.requestId))) fail("รหัสคำขอไม่ถูกต้อง");
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  const phone = typeof input.phone === "string" ? input.phone.replace(/[\s()-]/g, "") : "";
  const address = typeof input.address === "string" ? input.address.trim() : "";
  if (name.length < 2 || name.length > 120) fail("กรุณากรอกชื่อผู้สั่งซื้อ");
  if (!/^0\d{8,9}$/.test(phone)) fail("กรุณาตรวจสอบเบอร์โทรศัพท์");
  if (!Object.prototype.hasOwnProperty.call(DELIVERY, input.delivery)) fail("กรุณาเลือกวิธีรับสินค้า");
  if (input.delivery === "ship" && (address.length < 15 || address.length > 1000 || !/(^|\D)\d{5}(\D|$)/.test(address))) fail("กรุณากรอกที่อยู่พร้อมรหัสไปรษณีย์");
  if (!(input.preorder === true && input.sizing === true && input.privacy === true)) fail("กรุณาตรวจสอบและยอมรับเงื่อนไขก่อนสั่ง");
  if (input.website) fail("ไม่สามารถบันทึกคำขอนี้ได้");
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) fail("กรุณาเลือกสินค้า");
  const merged = {};
  for (const it of input.items) {
    const p = it && config.products.find((x) => x.id === it.product);
    if (!p || it.fit !== p.fit || !p.sizes.includes(it.size) || !["short", "long"].includes(it.sleeve) || !Number.isSafeInteger(it.qty) || it.qty < 1 || it.qty > 99) fail("รุ่น ทรง ไซส์ หรือจำนวนไม่ถูกต้อง กรุณาเลือกใหม่");
    const k = [it.product, it.fit, it.sleeve, it.size].join("|");
    merged[k] ||= { product: it.product, fit: it.fit, sleeve: it.sleeve, size: it.size, qty: 0 };
    merged[k].qty += it.qty;
    if (merged[k].qty > 99) fail("จำนวนต่อรายการเกิน 99 ตัว กรุณาติดต่อเพจ");
  }
  // Key order is part of the fingerprint contract (identical to V1): do not reorder.
  return { requestId: input.requestId, roundId: String(input.roundId || ""), name, phone, delivery: input.delivery, address: input.delivery === "ship" ? address : "",
    items: Object.keys(merged).sort().map((k) => merged[k]), preorder: true, sizing: true, privacy: true };
}
export async function fingerprint(normalized) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(normalized)));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Server-side pricing. Never trusts client prices. ----
export function quote(order, config, now) {
  const r = currentRound(config, now);
  if (!r || r.id !== order.roundId) fail("รอบสั่งซื้อนี้ปิดรับแล้ว หรือมีการเปลี่ยนรอบ กรุณาโหลดหน้าใหม่ก่อนสั่ง");
  if (!r.deliveries.includes(order.delivery)) fail("วิธีรับสินค้านี้ไม่เปิดในรอบนี้ กรุณาเลือกใหม่");
  const items = order.items.map((it) => {
    const p = config.products.find((x) => x.id === it.product), price = p.prices[it.sleeve];
    if (!Number.isSafeInteger(price) || price < 1) fail("ราคาไม่พร้อมใช้งาน");
    return Object.assign({}, it, { name: p.name, fitName: p.fitName, unitPrice: price, lineTotal: price * it.qty });
  });
  const subtotal = items.reduce((n, it) => n + it.lineTotal, 0), shipping = order.delivery === "ship" ? r.shipping : 0;
  if (!Number.isSafeInteger(shipping) || shipping < 0 || !Number.isSafeInteger(subtotal + shipping)) fail("ยอดเงินไม่ถูกต้อง");
  return { items, subtotal, shipping, total: subtotal + shipping, round: { id: r.id, name: r.name, paymentDue: r.paymentDue, readyText: r.readyText || "" } };
}
export const receipt = (o) => ({ ok: true, id: o.id, name: o.name, roundId: o.roundId, items: o.items, subtotal: o.subtotal, shipping: o.shipping, total: o.total, paymentDue: o.round.paymentDue, status: o.status });

// ---- Production / revenue summary (orders carry V1 legacy `status`) ----
export function summary(orders, round, config) {
  const inRound = orders.filter((o) => o.roundId === round.id), paid = inRound.filter((o) => PAID_LIKE.includes(o.status)), later = inRound.filter((o) => o.status === STATUS.LATER);
  const acc = {};
  for (const o of paid.concat(later)) for (const it of o.items) {
    const k = [it.product, it.fit, it.sleeve, it.size].join("|");
    acc[k] ||= { product: it.product, fit: it.fit, sleeve: it.sleeve, size: it.size, qty: 0 };
    acc[k].qty += it.qty;
  }
  const byStatus = {};
  for (const s of Object.values(STATUS)) byStatus[s] = inRound.filter((o) => o.status === s).length;
  const idx = (it) => { const i = config.products.findIndex((p) => p.id === it.product), p = config.products[i]; return [i, it.sleeve === "short" ? 0 : 1, p ? p.sizes.indexOf(it.size) : 99]; };
  const items = Object.values(acc).sort((a, b) => { const x = idx(a), y = idx(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  return {
    roundId: round.id, orders: inRound.length, paidOrders: paid.length, pendingOrders: byStatus[STATUS.PENDING], byStatus,
    revenue: paid.reduce((n, o) => n + o.total, 0), // deferred on-site orders are NOT revenue
    pendingAmount: inRound.filter((o) => o.status === STATUS.PENDING).reduce((n, o) => n + o.total, 0),
    laterOrders: later.length, laterAmount: later.reduce((n, o) => n + o.total, 0),
    supplierShipping: paid.length || later.length ? round.supplierShipping : 0,
    pieces: items.reduce((n, it) => n + it.qty, 0), items,
  };
}
export function shopText(s, round, config) {
  const out = ["NORX · " + round.name + " (" + round.id + ")", "ยอดผลิตรวม " + s.pieces + " ตัว", ""], groups = {};
  for (const it of s.items) {
    const p = config.products.find((x) => x.id === it.product), k = (p ? p.name : it.product) + " · " + (p ? p.fitName : it.fit) + " · " + sleeveName(it.sleeve);
    (groups[k] ||= []).push(it);
  }
  for (const k of Object.keys(groups)) { const g = groups[k]; out.push(k + " = " + g.reduce((n, x) => n + x.qty, 0) + " ตัว"); out.push("  " + g.map((x) => x.size + " " + x.qty).join(" / ")); }
  return out.join("\n");
}

/**
 * V1 setOrderStatus rules (admin). `from` is the status the admin saw (optimistic concurrency);
 * throws the same Thai errors as V1. Returns nothing when the change is allowed.
 */
export function checkTransition({ order, round, from, to, amount }) {
  if (order.status !== from) fail("ออเดอร์ " + order.id + ' ถูกเปลี่ยนเป็น "' + order.status + '" แล้ว กรุณาโหลดใหม่');
  if (!canMove(from, to)) fail('เปลี่ยนจาก "' + from + '" เป็น "' + to + '" ไม่ได้');
  if (round.state === "sent" && [STATUS.PENDING, STATUS.PAID, STATUS.CANCEL].includes(to)) fail("รอบนี้ส่งร้านแล้ว เปลี่ยนสถานะนี้ไม่ได้ กรุณาทักร้านเองถ้าต้องแก้ยอด");
  if (to === STATUS.DONE && from === STATUS.LATER && round.state !== "sent") fail('ยังไม่ได้ส่งร้าน ถ้าได้รับเงินแล้วให้กด "ได้รับเงินแล้ว"');
  if ([STATUS.PAID, STATUS.DONE].includes(to) && from !== STATUS.SENT && Number(amount) !== order.total) fail("ยอดเงินไม่ตรง กรุณาตรวจอีกครั้ง");
}
