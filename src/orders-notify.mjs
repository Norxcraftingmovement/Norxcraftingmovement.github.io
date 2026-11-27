// Notification outbox consumer: claim -> send -> success | failure log + exponential backoff -> dead after max attempts.
// Runs from a Cron Trigger; order creation never calls this, so a slow/failing mail provider cannot slow or fail orders.
export const BACKOFF_MS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 12 * 3600e3]; // after failed attempt 1..5
const iso = (ms) => new Date(ms).toISOString();
const STALE_MS = 5 * 60e3; // a 'sending' row older than this is a crashed worker: retried, counted as a failed attempt

/**
 * @param provider async (row) => void  — throws on failure. null/undefined = no provider configured:
 *        rows stay queued (visible in Admin for manual handling) and nothing is marked failed.
 */
export async function dispatchDue(env, provider, { now = Date.now(), batch = 10 } = {}) {
  const db = env.ORDERS_DB, at = iso(now), real0 = Date.now(), clock = () => now + (Date.now() - real0), stats = { claimed: 0, sent: 0, failed: 0, dead: 0, reclaimed: 0 };
  // Reclaim crashed 'sending' rows as a failed attempt (visible in the failure log).
  const stale = (await db.prepare("SELECT id FROM notification_queue WHERE status='sending' AND locked_at<=?1").bind(iso(now - STALE_MS)).all()).results;
  for (const s of stale) { await recordFailure(db, s.id, "worker timeout (stale lock)", now); stats.reclaimed++; }
  if (!provider) return stats;
  // Atomic claim: only rows still due are flipped to 'sending'; concurrent runs cannot claim the same row.
  const rows = (await db.prepare(
    `UPDATE notification_queue SET status='sending', locked_at=?1 WHERE id IN
       (SELECT id FROM notification_queue WHERE status IN ('queued','failed') AND next_attempt_at<=?1 ORDER BY next_attempt_at, id LIMIT ?2) RETURNING *`).bind(at, batch).all()).results;
  stats.claimed = rows.length;
  for (const row of rows) {
    try {
      await provider(row);
      const sentAt = clock();
      await db.batch([
        db.prepare("UPDATE notification_queue SET status='sent', sent_at=?2, attempts=attempts+1, last_error=NULL, locked_at=NULL WHERE id=?1").bind(row.id, iso(sentAt)),
        // notification latency = enqueue -> delivered; recorded separately from order-creation latency
        db.prepare("INSERT INTO latency_log(kind,ref,ms,at) VALUES ('notification',?1,?2,?3)").bind(String(row.id), Math.max(0, sentAt - Date.parse(row.created_at)), iso(sentAt)),
      ]);
      stats.sent++;
    } catch (e) {
      const r = await recordFailure(db, row.id, String(e?.message ?? e), now);
      stats[r]++;
    }
  }
  return stats;
}

async function recordFailure(db, id, error, now) {
  const row = await db.prepare("SELECT attempts, max_attempts FROM notification_queue WHERE id=?1").bind(id).first();
  const attempt = row.attempts + 1, dead = attempt >= row.max_attempts, msg = error.slice(0, 300); // no payload / PII in the failure log
  await db.batch([
    db.prepare("INSERT INTO notification_failures(queue_id,at,attempt,error) VALUES (?1,?2,?3,?4)").bind(id, iso(now), attempt, msg),
    db.prepare("UPDATE notification_queue SET status=?2, attempts=?3, last_error=?4, locked_at=NULL, next_attempt_at=?5 WHERE id=?1")
      .bind(id, dead ? "dead" : "failed", attempt, msg, iso(now + (BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length) - 1]))),
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

/**
 * Delivery provider (decision D15 pending). Generic outbound webhook so no paid service is assumed:
 * set secrets NOTIFY_WEBHOOK_URL (+ optional NOTIFY_WEBHOOK_TOKEN). Without them the queue simply holds the
 * messages (visible in Admin). Recipient comes from the owner-editable storefront settings, not from code.
 */
export function makeProvider(env, getRecipient) {
  if (!env.NOTIFY_WEBHOOK_URL) return null;
  return async (row) => {
    const res = await fetch(env.NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(env.NOTIFY_WEBHOOK_TOKEN ? { Authorization: "Bearer " + env.NOTIFY_WEBHOOK_TOKEN } : {}) },
      body: JSON.stringify({ id: row.id, channel: row.channel, template: row.template, to: await getRecipient(), payload: JSON.parse(row.payload) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error("provider HTTP " + res.status);
  };
}
