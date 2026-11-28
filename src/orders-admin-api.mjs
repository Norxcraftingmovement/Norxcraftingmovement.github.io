// Admin API handlers for Sender Settings and shipping labels. Called only after owner verification
// and the environment guard (see orders-admin-worker.mjs). Printing never changes order status.
import { READY_TO_SHIP } from "./orders-service.mjs";
import { UserError } from "./orders-core.mjs";
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
  if (url.searchParams.get("queue") === "ready") where.push(READY_TO_SHIP);
  if (url.searchParams.get("includeTest") === "0") where.push("o.is_test=0");
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
  await env.ORDERS_DB.prepare("UPDATE orders SET updated_at=?2 WHERE id=?1").bind(orderId, new Date().toISOString()).run(); // keeps admin auto-refresh and sync guards honest
  await audit(env, actor, "address.update", "orders", orderId, before, { ...a, postal_code: zip });
  return json({ ok: true });
}

// Provider and tracking number only (R5 fix). The shipped DATE is not set here: an order counts as shipped, and leaves the
// ready-to-ship queue, only through the batch "บันทึกจัดส่ง", which also moves its status to shipped. A stored date is never
// changed or cleared from this form, so correcting a tracking number after shipping still works (send no date, or the same one).
export async function putShipment(request, env, actor, orderId) {
  const b = await body(request); if (!b) return bad("BAD_REQUEST");
  const provider = clean(b.provider ?? "", 40) ?? "", tracking = clean(b.trackingNo ?? "", 40) ?? "", date = b.shippedAt ?? null;
  if (provider.length > 40 || !/^[A-Za-z0-9-]{0,40}$/.test(tracking) || (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return bad("INVALID_SHIPMENT");
  if (!(await env.ORDERS_DB.prepare("SELECT 1 AS x FROM orders WHERE id=?1").bind(orderId).first())) return bad("NOT_FOUND", 404);
  const before = await env.ORDERS_DB.prepare("SELECT provider,tracking_no,shipped_at FROM shipments WHERE order_id=?1").bind(orderId).first();
  if (date !== null && date !== (before?.shipped_at ?? null)) throw new UserError('วันที่ส่งกำหนดได้เฉพาะตอนกด "บันทึกจัดส่ง" (หลายรายการ) เพราะต้องเปลี่ยนสถานะออเดอร์เป็นจัดส่งแล้วพร้อมกัน');
  await env.ORDERS_DB.prepare(`INSERT INTO shipments(order_id,provider,tracking_no) VALUES (?1,?2,?3)
     ON CONFLICT(order_id) DO UPDATE SET provider=excluded.provider, tracking_no=excluded.tracking_no`)
    .bind(orderId, provider || null, tracking || null).run();
  await audit(env, actor, "shipment.update", "orders", orderId, before, { provider, tracking });
  return json({ ok: true });
}

export async function shipBatch(request, env, actor, now = Date.now()) {
  const b = await body(request);
  if (!Array.isArray(b?.rows) || !b.rows.length || b.rows.length > 50) throw new UserError("เลือกออเดอร์ 1–50 รายการ");
  const rows = b.rows.map((r, i) => {
    const order = clean(r?.orderNo, 65), carrier = clean(r?.provider, 40);
    const tracking = clean(r?.trackingNo, 40)?.toUpperCase();
    if (!order || !/^[A-Za-z0-9-]{1,65}$/.test(order) || !carrier || carrier.length > 40 || !/^[A-Z0-9-]{1,40}$/.test(tracking ?? "")) {
      throw new UserError("แถว " + (i + 1) + " ต้องมีเลขออเดอร์ บริษัทขนส่ง และเลขพัสดุที่ถูกต้อง");
    }
    return { order, carrier, tracking };
  });
  if (new Set(rows.map(r => r.order)).size !== rows.length) throw new UserError("เลขออเดอร์ซ้ำในชุด");
  if (new Set(rows.map(r => r.tracking)).size !== rows.length) throw new UserError("เลขพัสดุซ้ำในชุด");
  const date = b.shippedAt;
  const parsed = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + "T00:00:00Z") : null;
  if (!parsed || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) throw new UserError("วันที่ส่งไม่ถูกต้อง");
  const db = env.ORDERS_DB, input = JSON.stringify(rows), at = new Date(now).toISOString();
  const requested = `SELECT json_extract(value,'$.order') AS order_no,
    json_extract(value,'$.carrier') AS carrier,json_extract(value,'$.tracking') AS tracking FROM json_each(?1)`;
  const invalid = `WITH requested AS (${requested})
    SELECT q.order_no, CASE WHEN o.id IS NULL THEN 'order' ELSE 'tracking' END AS reason
    FROM requested q LEFT JOIN orders o ON o.order_no=q.order_no AND o.delivery='ship'
      AND o.payment_status='confirmed' AND o.fulfillment_status='ready_ship'
      AND EXISTS (SELECT 1 FROM shipping_addresses a WHERE a.order_id=o.id)
      AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id=o.id AND s.shipped_at IS NOT NULL)
    WHERE o.id IS NULL OR EXISTS (SELECT 1 FROM shipments s WHERE upper(s.tracking_no)=q.tracking AND s.order_id<>o.id)`;
  const issue = await db.prepare(invalid + " LIMIT 1").bind(input).first();
  if (issue) throw new UserError(issue.order_no + (issue.reason === "tracking" ? " ใช้เลขพัสดุที่ผูกกับออเดอร์อื่นแล้ว" : " ไม่อยู่ในคิวพร้อมจัดส่ง"));
  // Keep what each order had BEFORE this batch overwrites it (a mistyped number must stay traceable).
  const previous = (await db.prepare(`WITH requested AS (${requested}) SELECT o.order_no AS order_no, s.provider AS provider, s.tracking_no AS tracking FROM requested q JOIN orders o ON o.order_no=q.order_no JOIN shipments s ON s.order_id=o.id`).bind(input).all()).results ?? [];
  try {
    await db.batch([
      db.prepare(`SELECT CASE WHEN NOT EXISTS (${invalid}) THEN 1 ELSE json('SHIPMENT BATCH CHANGED') END`).bind(input),
      db.prepare(`WITH requested AS (${requested}) INSERT INTO shipments(order_id,provider,tracking_no,shipped_at)
        SELECT o.id,q.carrier,q.tracking,?2 FROM requested q JOIN orders o USING(order_no) WHERE 1
        ON CONFLICT(order_id) DO UPDATE SET provider=excluded.provider,tracking_no=excluded.tracking_no,shipped_at=excluded.shipped_at`).bind(input, date),
      db.prepare(`WITH requested AS (${requested}) INSERT INTO order_status_history(order_id,kind,from_status,to_status,actor,at)
        SELECT o.id,'fulfillment','ready_ship','shipped',?2,?3 FROM orders o JOIN requested q USING(order_no)`).bind(input, actor, at),
      db.prepare(`UPDATE orders SET fulfillment_status='shipped',status_updated_at=?2,status_updated_by=?3,updated_at=?2
        WHERE order_no IN (SELECT order_no FROM (${requested}))`).bind(input, at, actor),
    ]);
  } catch (error) {
    if (/malformed JSON/i.test(String(error?.message))) throw new UserError("สถานะหรือเลขพัสดุเปลี่ยนระหว่างบันทึก กรุณาตรวจอีกครั้ง");
    throw error;
  }
  await audit(env, actor, "shipment.batch", "orders", rows.map((r) => r.order).join(","), previous, rows.map((r) => ({ order: r.order, provider: r.carrier, tracking: r.tracking, date })));
  return json({ ok: true, shipped: rows.length });
}

// ---- Storefront settings (bank account, links, live switch, weekly rolling, notification recipient). Never in the repo. ----
const url = (v) => { try { const u = new URL(String(v)); return u.protocol === "https:" ? u.href : null; } catch { return null; } };
export async function getStorefront(env) {
  const v = await env.ORDERS_DB.prepare("SELECT value FROM settings WHERE key='storefront'").first();
  if (!v) return null;
  const { testKeyHash, ...rest } = JSON.parse(v.value);
  return { ...rest, testKeySet: !!testKeyHash };
}
// Weekly automatic rounds (V1 ROLLING_WEEKLY): flips ONLY this flag, so the rounds panel can offer it without re-sending bank details.
export async function putRolling(request, env, actor) {
  const b = await body(request); if (!b || typeof b.rolling !== "boolean") return bad("BAD_REQUEST");
  const prev = (await env.ORDERS_DB.prepare("SELECT value FROM settings WHERE key='storefront'").first())?.value;
  if (!prev) return bad("STOREFRONT_NOT_CONFIGURED", 409);
  const old = JSON.parse(prev);
  await env.ORDERS_DB.prepare("UPDATE settings SET value=?1 WHERE key='storefront'").bind(JSON.stringify({ ...old, rolling: b.rolling })).run();
  await audit(env, actor, "rolling.update", "settings", "storefront", { rolling: old.rolling ?? null }, { rolling: b.rolling });
  return json({ ok: true, rolling: b.rolling });
}
export async function putStorefront(request, env, actor) {
  const b = await body(request); if (!b) return bad("BAD_REQUEST");
  const bank = { name: clean(b.bank?.name, 60), account: clean(b.bank?.account, 30), holder: clean(b.bank?.holder, 80) };
  if (!bank.name || !bank.account || !/^[0-9-]{8,20}$/.test(bank.account) || !bank.holder) return bad("INVALID_STOREFRONT");
  const chatUrl = url(b.chatUrl), pageUrl = url(b.pageUrl), eventName = clean(b.eventName ?? "", 120) ?? "";
  const notifyTo = b.notifyTo ? clean(b.notifyTo, 120) : "";
  if (!chatUrl || !pageUrl || typeof b.liveEnabled !== "boolean" || typeof b.rolling !== "boolean" || (notifyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyTo))) return bad("INVALID_STOREFRONT");
  const prev = (await env.ORDERS_DB.prepare("SELECT value FROM settings WHERE key='storefront'").first())?.value;
  const old = prev ? JSON.parse(prev) : {};
  let testKeyHash = old.testKeyHash ?? null;
  if (b.testKey) { const k = clean(b.testKey, 64); if (!k || k.length < 8) return bad("INVALID_STOREFRONT"); testKeyHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(k))), (x) => x.toString(16).padStart(2, "0")).join(""); }
  const next = { bank, chatUrl, pageUrl, eventName, liveEnabled: b.liveEnabled, rolling: b.rolling, notifyTo, testKeyHash };
  await env.ORDERS_DB.prepare("INSERT INTO settings(key,value) VALUES ('storefront',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(next)).run();
  // audit stores which fields changed, not the bank account itself
  await audit(env, actor, "storefront.update", "settings", "storefront", { liveEnabled: old.liveEnabled ?? null, rolling: old.rolling ?? null }, { liveEnabled: next.liveEnabled, rolling: next.rolling, bankChanged: JSON.stringify(old.bank) !== JSON.stringify(bank) });
  return json({ ok: true });
}
