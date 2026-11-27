// Admin API handlers for Sender Settings and shipping labels. Called only after owner verification
// and the environment guard (see orders-admin-worker.mjs). Printing never changes order status.
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
export const json = (data, status = 200) => Response.json(data, { status, headers });
const bad = (code, status = 400) => json({ ok: false, error: code }, status);
const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max + 1) : null);
const ids = (v) => Array.isArray(v) && v.length > 0 && v.length <= 50 && v.every((n) => Number.isSafeInteger(n) && n > 0) ? [...new Set(v)] : null;
const like = (s) => "%" + s.replace(/[\\%_]/g, (c) => "\\" + c) + "%";

async function body(request) {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return null;
  const text = await request.text();
  if (text.length > 65536) return null;
  try { const v = JSON.parse(text); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

async function audit(env, actor, action, entity, entityId, before, after) {
  await env.ORDERS_DB.prepare("INSERT INTO audit_log(actor_hash,action,entity,entity_id,before,after) VALUES (?1,?2,?3,?4,?5,?6)")
    .bind(actor, action, entity, String(entityId), before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)).run();
}

export async function getSender(env) {
  const row = await env.ORDERS_DB.prepare("SELECT value FROM settings WHERE key='sender'").first();
  return row ? JSON.parse(row.value) : null;
}

export function validateSender(b) {
  const s = { brandName: clean(b.brandName, 60), senderName: clean(b.senderName, 80), address: clean(b.address, 300), phone: clean(b.phone, 20) };
  if (!s.brandName || s.brandName.length > 60) return null;
  if (!s.senderName || s.senderName.length > 80) return null;
  if (!s.address || s.address.length < 10 || s.address.length > 300) return null;
  if (!/^[0-9+()\-\s]{8,20}$/.test(s.phone ?? "")) return null;
  return s;
}

export async function putSender(request, env, actor) {
  const b = await body(request); if (!b) return bad("BAD_REQUEST");
  const s = validateSender(b); if (!s) return bad("INVALID_SENDER");
  const before = await getSender(env);
  await env.ORDERS_DB.prepare("INSERT INTO settings(key,value) VALUES ('sender',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(s)).run();
  await audit(env, actor, "sender.update", "settings", "sender", before, s);
  return json({ ok: true, sender: s });
}

export async function senderResponse(env) { return json({ ok: true, sender: await getSender(env) }); }

export async function labelOrders(url, env) {
  const q = clean(url.searchParams.get("q") ?? "", 60) ?? "", printed = url.searchParams.get("printed");
  const where = ["o.delivery='ship'", "o.fulfillment_status!='cancelled'"], args = [];
  if (q) { where.push("(o.order_no LIKE ? ESCAPE '\\' OR a.recipient LIKE ? ESCAPE '\\')"); args.push(like(q), like(q)); }
  if (printed === "0") where.push("COALESCE(s.label_printed_count,0)=0");
  if (printed === "1") where.push("COALESCE(s.label_printed_count,0)>0");
  const { results } = await env.ORDERS_DB.prepare(
    `SELECT o.id, o.order_no AS orderNo, o.is_test AS isTest, o.payment_status AS paymentStatus, o.fulfillment_status AS fulfillmentStatus, a.recipient,
            COALESCE(s.label_printed_count,0) AS printedCount, s.provider, s.tracking_no AS trackingNo, s.shipped_at AS shippedAt
     FROM orders o JOIN shipping_addresses a ON a.order_id=o.id LEFT JOIN shipments s ON s.order_id=o.id
     WHERE ${where.join(" AND ")} ORDER BY o.id DESC LIMIT 100`).bind(...args).all();
  return json({ ok: true, orders: results });
}

export async function labelData(request, env) {
  const b = await body(request), list = ids(b?.ids); if (!list) return bad("BAD_REQUEST");
  const { results } = await env.ORDERS_DB.prepare(
    `SELECT o.id, o.order_no AS orderNo, a.recipient, a.phone, a.address, a.postal_code AS postalCode, s.provider, s.tracking_no AS trackingNo,
            COALESCE(s.label_printed_count,0) AS printedCount, (SELECT SUM(qty) FROM order_items i WHERE i.order_id=o.id) AS itemCount
     FROM orders o JOIN shipping_addresses a ON a.order_id=o.id LEFT JOIN shipments s ON s.order_id=o.id
     WHERE o.id IN (${list.map(() => "?").join(",")})`).bind(...list).all();
  const byId = new Map(results.map((r) => [r.id, r]));
  return json({ ok: true, sender: await getSender(env), labels: list.filter((i) => byId.has(i)).map((i) => byId.get(i)), missing: list.filter((i) => !byId.has(i)) });
}

// Explicit "mark as printed" after the owner confirms. Touches only the reprint counter, never order status.
export async function markPrinted(request, env, actor) {
  const b = await body(request), list = ids(b?.ids); if (!list) return bad("BAD_REQUEST");
  const now = new Date().toISOString(), stmts = list.map((id) => env.ORDERS_DB.prepare(
    `INSERT INTO shipments(order_id,label_printed_count,last_label_at) SELECT id,1,?2 FROM orders WHERE id=?1
     ON CONFLICT(order_id) DO UPDATE SET label_printed_count=label_printed_count+1, last_label_at=excluded.last_label_at`).bind(id, now));
  await env.ORDERS_DB.batch(stmts);
  await audit(env, actor, "label.printed", "orders", list.join(","), null, { count: list.length });
  return json({ ok: true });
}

export async function putAddress(request, env, actor, orderId) {
  const b = await body(request); if (!b) return bad("BAD_REQUEST");
  const a = { recipient: clean(b.recipient, 100), phone: (clean(b.phone, 20) ?? "").replace(/[\s()-]/g, ""), address: clean(b.address, 500) };
  if (!a.recipient || a.recipient.length < 2 || a.recipient.length > 100 || !/^0[0-9]{8,9}$/.test(a.phone) || !a.address || a.address.length < 15 || a.address.length > 500) return bad("INVALID_ADDRESS");
  const zip = [...a.address.matchAll(/(?<!\d)\d{5}(?!\d)/g)].at(-1)?.[0]; if (!zip) return bad("INVALID_ADDRESS");
  const before = await env.ORDERS_DB.prepare("SELECT recipient,phone,address,postal_code FROM shipping_addresses WHERE order_id=?1").bind(orderId).first();
  if (!before) return bad("NOT_FOUND", 404);
  await env.ORDERS_DB.prepare("UPDATE shipping_addresses SET recipient=?2,phone=?3,address=?4,postal_code=?5,edited_at=?6 WHERE order_id=?1")
    .bind(orderId, a.recipient, a.phone, a.address, zip, new Date().toISOString()).run();
  await audit(env, actor, "address.update", "orders", orderId, before, { ...a, postal_code: zip });
  return json({ ok: true });
}

// Provider / tracking number / shipped date only. Changing fulfillment to "shipped" is a separate explicit action.
export async function putShipment(request, env, actor, orderId) {
  const b = await body(request); if (!b) return bad("BAD_REQUEST");
  const provider = clean(b.provider ?? "", 40) ?? "", tracking = clean(b.trackingNo ?? "", 40) ?? "", date = b.shippedAt ?? null;
  if (provider.length > 40 || !/^[A-Za-z0-9-]{0,40}$/.test(tracking) || (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return bad("INVALID_SHIPMENT");
  if (!(await env.ORDERS_DB.prepare("SELECT 1 AS x FROM orders WHERE id=?1").bind(orderId).first())) return bad("NOT_FOUND", 404);
  const before = await env.ORDERS_DB.prepare("SELECT provider,tracking_no,shipped_at FROM shipments WHERE order_id=?1").bind(orderId).first();
  await env.ORDERS_DB.prepare(`INSERT INTO shipments(order_id,provider,tracking_no,shipped_at) VALUES (?1,?2,?3,?4)
     ON CONFLICT(order_id) DO UPDATE SET provider=excluded.provider, tracking_no=excluded.tracking_no, shipped_at=excluded.shipped_at`)
    .bind(orderId, provider || null, tracking || null, date).run();
  await audit(env, actor, "shipment.update", "orders", orderId, before, { provider, tracking, date });
  return json({ ok: true });
}
