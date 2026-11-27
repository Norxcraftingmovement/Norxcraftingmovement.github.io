// Payments (Phase 1): per-order dynamic PromptPay QR, manual verification retained.
// Rules enforced here and covered by tests/payments.test.mjs:
//  * the QR amount is the server-validated order total, taken from the saved order (never from the client);
//  * a QR is issued only when the owner-configured PromptPay ID has been VERIFIED by the owner;
//  * generating, viewing or downloading a QR never changes order or payment state — only an owner-confirmed payment does;
//  * the customer access token is random, stored hashed, and a wrong token gets the same answer as an unknown order.
import { buildPromptPayPayload, normalizePromptPayId, maskPromptPayId, ID_TYPES } from "./promptpay.mjs";
import qrcode from "./vendor/qrcode-generator.mjs";
import { UserError, toLegacy, STATUS } from "./orders-core.mjs";

const iso = (ms) => new Date(ms).toISOString();
const sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const same = (a, b) => { if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
export const BASE = "/api/orders";

export async function getPaymentSettings(env) {
  const r = await env.ORDERS_DB.prepare("SELECT value FROM settings WHERE key='payment'").first();
  return r ? JSON.parse(r.value) : null;
}
const ready = (s) => !!(s && s.provider === "promptpay" && s.verified === true && s.promptpayId && s.idType && s.payeeName);

// ---------- QR image ----------
export function qrSvg(payload, { size = 320 } = {}) {
  const qr = qrcode(0, "M"); qr.addData(payload, "Byte"); qr.make();
  const n = qr.getModuleCount(), quiet = 4, dim = n + quiet * 2; let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code PromptPay"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- customer access token ----------
export async function newPayToken() {
  const b = crypto.getRandomValues(new Uint8Array(16)), token = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { token, hash: await sha("norx-pay|" + token) };
}
export const hashToken = (t) => sha("norx-pay|" + String(t));

// ---------- payment request (what the customer is asked to pay) ----------
async function orderFor(env, orderNo) {
  return env.ORDERS_DB.prepare("SELECT o.id, o.order_no, o.total_baht, o.payment_status, o.fulfillment_status, o.payment_due_at, o.tracking_token_hash FROM orders o WHERE o.order_no=?1").bind(String(orderNo)).first();
}
/** Idempotently create the payment request (and its QR payload) for a PENDING order. Returns the row, or null when QR payment is not available. */
export async function ensurePaymentRequest(env, order, now = Date.now()) {
  const db = env.ORDERS_DB, existing = await db.prepare("SELECT * FROM payment_requests WHERE order_id=?1").bind(order.id).first();
  if (existing) return existing;
  const s = await getPaymentSettings(env);
  if (!ready(s) || toLegacy(order.payment_status, order.fulfillment_status) !== STATUS.PENDING) return null;
  const payload = buildPromptPayPayload({ type: s.idType, id: s.promptpayId, amountBaht: order.total_baht }); // amount = saved, validated total
  const at = iso(now);
  const res = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO payment_requests(order_id,reference,provider,expected_amount_baht,deadline_at,qr_payload,payee_name,payee_id_masked,created_at,updated_at) VALUES (?1,?2,'promptpay_p2p',?3,?4,?5,?6,?7,?8,?8)`)
      .bind(order.id, order.order_no, order.total_baht, order.payment_due_at, payload, s.payeeName, maskPromptPayId(s.idType, normalizePromptPayId(s.idType, s.promptpayId).display), at),
    db.prepare("INSERT INTO payment_events(request_id,at,event,detail) SELECT id,?2,'qr_issued','promptpay_p2p' FROM payment_requests WHERE order_id=?1 AND created_at=?2").bind(order.id, at),
  ]);
  void res;
  return db.prepare("SELECT * FROM payment_requests WHERE order_id=?1").bind(order.id).first();
}
const urls = (orderNo, token) => { const q = "?o=" + encodeURIComponent(orderNo) + "&t=" + encodeURIComponent(token); return { payUrl: "/pay/" + q, apiUrl: BASE + "/pay" + q, qrUrl: BASE + "/pay.svg" + q, downloadUrl: BASE + "/pay.svg" + q + "&download=1" }; };

/** `payment` block added to the receipt (extra field; the V1 storefront ignores it). null when QR payment is unavailable. */
export async function paymentForReceipt(env, orderNo, token, now = Date.now()) {
  try {
    const o = await orderFor(env, orderNo), r = o && (await ensurePaymentRequest(env, o, now));
    if (!r) return null;
    return { provider: r.provider, reference: r.reference, amount: r.expected_amount_baht, deadline: r.deadline_at, payeeName: r.payee_name, ...urls(orderNo, token) };
  } catch { return null; } // never let payment display break order creation
}

/** Customer payment view. Returns null for unknown order OR wrong token (indistinguishable). */
export async function getPayView(env, orderNo, token, now = Date.now()) {
  const o = await orderFor(env, orderNo); if (!o || !o.tracking_token_hash || !same(o.tracking_token_hash, await hashToken(token))) return null;
  const legacy = toLegacy(o.payment_status, o.fulfillment_status), store = await env.ORDERS_DB.prepare("SELECT value FROM settings WHERE key='storefront'").first(), bank = store ? JSON.parse(store.value).bank : null;
  const base = { ok: true, order: { id: o.order_no, total: o.total_baht, status: legacy }, deadline: o.payment_due_at, bank };
  if (legacy !== STATUS.PENDING) return { ...base, payment: { state: legacy === STATUS.LATER ? "on_site" : legacy === STATUS.CANCEL ? "cancelled" : "paid" } };
  if (o.payment_due_at && now > Date.parse(o.payment_due_at)) return { ...base, payment: { state: "expired", reference: o.order_no, amount: o.total_baht } };
  const r = await ensurePaymentRequest(env, o, now);
  if (!r) return { ...base, payment: { state: "unavailable", reference: o.order_no, amount: o.total_baht } };
  await env.ORDERS_DB.prepare("INSERT INTO payment_events(request_id,at,event) SELECT ?1,?2,'qr_viewed' WHERE NOT EXISTS (SELECT 1 FROM payment_events WHERE request_id=?1 AND event='qr_viewed')").bind(r.id, iso(now)).run();
  return { ...base, payment: { state: "awaiting", provider: r.provider, reference: r.reference, amount: r.expected_amount_baht, deadline: r.deadline_at, payeeName: r.payee_name, ...urls(o.order_no, token) } };
}
export async function getPaySvg(env, orderNo, token, now = Date.now()) {
  const v = await getPayView(env, orderNo, token, now); if (!v || v.payment.state !== "awaiting") return null;
  const r = await env.ORDERS_DB.prepare("SELECT qr_payload FROM payment_requests WHERE reference=?1").bind(String(orderNo)).first();
  return r ? qrSvg(r.qr_payload) : null;
}

// ---------- owner configuration ----------
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max + 1);
const audit = (env, actor, action, after) => env.ORDERS_DB.prepare("INSERT INTO audit_log(actor_hash,action,entity,entity_id,before,after) VALUES (?1,?2,'settings','payment',NULL,?3)").bind(actor, action, JSON.stringify(after)).run();
export const publicPaymentSettings = (s) => (s ? { provider: s.provider, idType: s.idType, idTypeLabel: ID_TYPES[s.idType]?.label, idMasked: maskPromptPayId(s.idType, normalizePromptPayId(s.idType, s.promptpayId).display), payeeName: s.payeeName, verified: s.verified === true, verifiedAt: s.verifiedAt ?? null } : null);

export async function putPaymentSettings(env, actor, b, now = Date.now()) {
  let p; try { p = normalizePromptPayId(b?.idType, b?.id); } catch (e) { throw new UserError(e.message); }
  const payeeName = clean(b?.payeeName, 80); if (payeeName.length < 2 || payeeName.length > 80) throw new UserError("กรุณากรอกชื่อผู้รับเงินตามบัญชี PromptPay");
  const old = await getPaymentSettings(env), unchanged = old && old.idType === p.type && old.promptpayId === p.display && old.payeeName === payeeName;
  const next = { provider: "promptpay", idType: p.type, promptpayId: p.display, payeeName, verified: unchanged ? old.verified === true : false, verifiedAt: unchanged ? old.verifiedAt ?? null : null }; // ANY change un-verifies
  await env.ORDERS_DB.prepare("INSERT INTO settings(key,value) VALUES ('payment',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(next)).run();
  await audit(env, actor, "payment.settings", { idType: p.type, idMasked: maskPromptPayId(p.type, p.display), verified: next.verified });
  return publicPaymentSettings(next);
}
/** The owner attests that the payee name shown by their banking app for this PromptPay ID matches. Typing the name is the attestation. */
export async function verifyPaymentSettings(env, actor, b, now = Date.now()) {
  const s = await getPaymentSettings(env); if (!s) throw new UserError("ยังไม่ได้ตั้งค่า PromptPay");
  if (clean(b?.confirmName, 80) !== s.payeeName) throw new UserError("ชื่อที่พิมพ์ไม่ตรงกับชื่อผู้รับที่ตั้งไว้ — ตรวจชื่อที่แอปธนาคารแสดงอีกครั้ง");
  const next = { ...s, verified: true, verifiedAt: iso(now) };
  await env.ORDERS_DB.prepare("UPDATE settings SET value=?1 WHERE key='payment'").bind(JSON.stringify(next)).run();
  await audit(env, actor, "payment.verified", { idMasked: maskPromptPayId(s.idType, s.promptpayId) });
  return publicPaymentSettings(next);
}
/** Preview for the owner's verification step: amount 1.00 THB. Scan to read the payee name; do NOT confirm the transfer. */
export async function previewSvg(env) {
  const s = await getPaymentSettings(env); if (!s) return null;
  return qrSvg(buildPromptPayPayload({ type: s.idType, id: s.promptpayId, amountBaht: 1 }));
}
