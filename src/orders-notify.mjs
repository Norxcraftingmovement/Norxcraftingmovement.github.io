// Notification outbox consumer: claim -> send -> success | failure log + exponential backoff -> dead after max attempts.
// Runs from a Cron Trigger; order creation never calls this, so a slow/failing mail provider cannot slow or fail orders.
export const BACKOFF_MS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 12 * 3600e3]; // after failed attempt 1..5
const iso = (ms) => new Date(ms).toISOString();
const STALE_MS = 5 * 60e3; // a 'sending' row older than this is a crashed worker: retried, counted as a failed attempt

/**
 * @param provider async (row, {idempotencyKey, possibleDuplicate}) => void — throws on failure. null/undefined = no provider
 *        configured: rows stay queued (visible in Admin) and nothing is marked failed.
 *
 * Delivery is AT-LEAST-ONCE. The one unavoidable ambiguity is "provider accepted the message but the Worker stopped
 * before recording SENT". We persist `provider_called_at` BEFORE calling the provider, so a later reclaim knows the
 * message may already be out: it is retried with the SAME idempotency key and `possibleDuplicate: true` (the email says so),
 * and the failure log records "delivery unconfirmed". A missing alert is worse than a duplicate alert for an owner notification.
 */
export async function dispatchDue(env, provider, { now = Date.now(), batch = 10 } = {}) {
  const db = env.ORDERS_DB, at = iso(now), real0 = Date.now(), clock = () => now + (Date.now() - real0), stats = { claimed: 0, sent: 0, failed: 0, dead: 0, reclaimed: 0 };
  const stale = (await db.prepare("SELECT id, provider_called_at FROM notification_queue WHERE status='sending' AND locked_at<=?1").bind(iso(now - STALE_MS)).all()).results;
  for (const s of stale) { await recordFailure(db, s.id, s.provider_called_at ? "delivery unconfirmed: worker stopped after calling the provider (possible duplicate on retry)" : "worker timeout (stale lock)", now, !!s.provider_called_at); stats.reclaimed++; }
  if (!provider) return stats;
  // Atomic claim: only rows still due are flipped to 'sending'; concurrent runs cannot claim the same row.
  const rows = (await db.prepare(
    `UPDATE notification_queue SET status='sending', locked_at=?1, provider_called_at=NULL WHERE id IN
       (SELECT id FROM notification_queue WHERE status IN ('queued','failed') AND next_attempt_at<=?1 ORDER BY next_attempt_at, id LIMIT ?2) RETURNING *`).bind(at, batch).all()).results;
  stats.claimed = rows.length;
  for (const row of rows) {
    const meta = { idempotencyKey: "norx-notification-" + row.id, possibleDuplicate: row.possible_duplicate === 1 };
    await db.prepare("UPDATE notification_queue SET provider_called_at=?2 WHERE id=?1").bind(row.id, iso(clock())).run(); // recorded BEFORE the call
    try { await provider(row, meta); }
    catch (e) { stats[await recordFailure(db, row.id, String(e?.message ?? e), now, e?.name === "TimeoutError" || e?.name === "AbortError" || e?.ambiguous === true)]++; continue; }
    // Provider accepted the message. Record SENT (one retry); if the database is unreachable we throw and leave the row
    // 'sending' with provider_called_at set — the reclaim path above handles it.
    const sentAt = clock();
    const mark = () => db.batch([
      db.prepare("UPDATE notification_queue SET status='sent', sent_at=?2, attempts=attempts+1, last_error=NULL, locked_at=NULL WHERE id=?1").bind(row.id, iso(sentAt)),
      // notification latency = enqueue -> delivered; recorded separately from order-creation latency
      db.prepare("INSERT INTO latency_log(kind,ref,ms,at) VALUES ('notification',?1,?2,?3)").bind(String(row.id), Math.max(0, sentAt - Date.parse(row.created_at)), iso(sentAt)),
    ]);
    try { await mark(); } catch { await mark(); }
    stats.sent++;
  }
  return stats;
}

// Remove e-mail addresses from error text before it is stored (the failure log must not accumulate personal data).
const redact = (t) => String(t).replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[email]").replace(/\s+/g, " ").slice(0, 300);
async function recordFailure(db, id, error, now, ambiguous = false) {
  const row = await db.prepare("SELECT attempts, max_attempts FROM notification_queue WHERE id=?1").bind(id).first();
  const attempt = row.attempts + 1, dead = attempt >= row.max_attempts, msg = redact(error);
  await db.batch([
    db.prepare("INSERT INTO notification_failures(queue_id,at,attempt,error) VALUES (?1,?2,?3,?4)").bind(id, iso(now), attempt, msg),
    db.prepare("UPDATE notification_queue SET status=?2, attempts=?3, last_error=?4, locked_at=NULL, provider_called_at=NULL, possible_duplicate=CASE WHEN ?6=1 THEN 1 ELSE possible_duplicate END, next_attempt_at=?5 WHERE id=?1")
      .bind(id, dead ? "dead" : "failed", attempt, msg, iso(now + (BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length) - 1])), ambiguous ? 1 : 0),
  ]);
  return dead ? "dead" : "failed";
}

export async function retryNotification(env, id, now = Date.now()) { // admin: manual retry of failed/dead
  const r = await env.ORDERS_DB.prepare("UPDATE notification_queue SET status='queued', attempts=0, next_attempt_at=?2, locked_at=NULL WHERE id=?1 AND status IN ('failed','dead')").bind(id, iso(now)).run();
  return r.meta.changes === 1;
}
export async function listNotifications(env, { limit = 50 } = {}) {
  return (await env.ORDERS_DB.prepare(
    `SELECT q.id, o.order_no AS orderNo, q.channel, q.template, q.status, q.attempts, q.max_attempts AS maxAttempts, q.next_attempt_at AS nextAttemptAt, q.last_error AS lastError, q.created_at AS createdAt, q.sent_at AS sentAt
     FROM notification_queue q LEFT JOIN orders o ON o.id=q.order_id WHERE q.status!='sent' ORDER BY q.id DESC LIMIT ?1`).bind(Math.min(limit, 200)).all()).results;
}

/** Latency summary kept separate per kind. */
export async function latencyStats(env) {
  const out = {};
  for (const kind of ["order_creation", "notification"]) {
    const ms = (await env.ORDERS_DB.prepare("SELECT ms FROM latency_log WHERE kind=?1 ORDER BY at DESC LIMIT 500").bind(kind).all()).results.map((r) => r.ms).sort((a, b) => a - b);
    const q = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null);
    out[kind] = { count: ms.length, p50: q(0.5), p95: q(0.95), max: ms.at(-1) ?? null };
  }
  return out;
}

/** Owner alert text (same content as the V1 e-mail). Pure. */
export function renderOrderAlert(payload, { adminUrl = "", possibleDuplicate = false } = {}) {
  const sleeve = (x) => (x === "short" ? "แขนสั้น" : "แขนยาว");
  const body = ["ออเดอร์ใหม่ " + payload.orderNo, payload.name + " · " + payload.phone, ...payload.items.map((i) => i.name + " / " + sleeve(i.sleeve) + " / " + i.size + " × " + i.qty), "ยอดที่ต้องตรวจ " + payload.total + " บาท", "ตรวจสลิปในเพจและเงินเข้าบัญชีก่อนยืนยัน", adminUrl].filter(Boolean);
  if (possibleDuplicate) body.unshift("(อาจเป็นข้อความซ้ำ: ระบบยืนยันการส่งครั้งก่อนไม่ได้)");
  return { subject: (possibleDuplicate ? "[NORX][อาจซ้ำ] " : "[NORX] ") + payload.orderNo + " · " + payload.total + " บาท", text: body.join("\n") };
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Native Cloudflare Email Service provider (Workers send binding `env.EMAIL`).
 * !! The call shape below (`env.EMAIL.send({to, from, subject, text, headers})`) is NOT yet verified against the official docs
 * (developers.cloudflare.com was unreachable from the build environment). It is isolated in `sendViaBinding` so verifying/adjusting
 * it is a one-function change; the mock tests pin down our side of the contract (recipient/sender checks, text, idempotency header, errors).
 */
export async function sendViaBinding(binding, msg) { return binding.send(msg); }
export function makeEmailProvider(env, getRecipient) {
  if (!env.EMAIL || typeof env.EMAIL.send !== "function") return null;
  return async (row, meta) => {
    const to = await getRecipient(), from = env.NOTIFY_FROM;
    if (!to || !EMAIL_RE.test(to)) throw new Error("notification recipient not configured");
    if (!from || !EMAIL_RE.test(from)) throw new Error("NOTIFY_FROM sender not configured");
    const { subject, text } = renderOrderAlert(JSON.parse(row.payload), { adminUrl: env.ORDERS_ADMIN_URL || "", possibleDuplicate: meta?.possibleDuplicate });
    await sendViaBinding(env.EMAIL, { to, from, subject, text, headers: { "X-NORX-Idempotency-Key": meta?.idempotencyKey ?? "norx-notification-" + row.id } });
  };
}
/** Generic outbound webhook (fallback; no paid service assumed). */
export function makeWebhookProvider(env, getRecipient) {
  if (!env.NOTIFY_WEBHOOK_URL) return null;
  return async (row, meta) => {
    const res = await fetch(env.NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": meta?.idempotencyKey ?? "norx-notification-" + row.id, ...(env.NOTIFY_WEBHOOK_TOKEN ? { Authorization: "Bearer " + env.NOTIFY_WEBHOOK_TOKEN } : {}) },
      body: JSON.stringify({ id: row.id, channel: row.channel, template: row.template, to: await getRecipient(), possibleDuplicate: !!meta?.possibleDuplicate, payload: JSON.parse(row.payload) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error("provider HTTP " + res.status);
  };
}
/** Preference: native email binding > webhook > none (queue holds the messages). */
export const makeProvider = (env, getRecipient) => makeEmailProvider(env, getRecipient) ?? makeWebhookProvider(env, getRecipient);
/** What the admin page shows: which channel is active and what is still missing. Nothing is sent from here. */
export async function notificationReadiness(env, getRecipient) {
  const mode = env.EMAIL && typeof env.EMAIL.send === "function" ? "email" : env.NOTIFY_WEBHOOK_URL ? "webhook" : "none", missing = [];
  if (mode === "none") missing.push("ช่องทางส่ง (Email binding หรือ webhook)");
  if (mode === "email") { if (!env.NOTIFY_FROM || !EMAIL_RE.test(env.NOTIFY_FROM)) missing.push("อีเมลผู้ส่ง (NOTIFY_FROM)"); }
  if (mode !== "none" && !EMAIL_RE.test((await getRecipient()) || "")) missing.push("อีเมลผู้รับแจ้งเตือน (ตั้งค่าที่ Storefront settings)");
  return { mode, ready: mode !== "none" && missing.length === 0, missing };
}
