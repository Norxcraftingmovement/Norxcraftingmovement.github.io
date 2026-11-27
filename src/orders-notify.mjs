// Notification outbox consumer: claim -> send -> accepted | classified failure -> bounded retry.
// Order creation never calls this, so a slow/failing provider cannot slow or fail orders.
//
// Delivery policy (tested in tests/orders-notify*.test.mjs):
//  * 'sent' means ACCEPTED BY THE PROVIDER (messageId stored). It is not proof of inbox delivery.
//  * NORMAL failure (definite refusal): retry with backoff 1m/5m/30m/2h/12h, at most max_attempts (5) provider calls, then 'dead'.
//  * AMBIGUOUS failure (timeout/abort, or the Worker stopped after calling the provider): the message may already be out.
//    Exactly ONE further automatic attempt is allowed (flagged "possible duplicate") — whatever its outcome — and then the row
//    ends in 'unconfirmed' (or 'sent' if that attempt is accepted). The owner decides (resend or mark as received).
//  * We do NOT assume the provider de-duplicates. The reference id in the body lets a human recognise a duplicate.
//  * Stale-lock recovery and outcome writes are compare-and-set on `lock_token`, so concurrent workers cannot double count.
//  * History is append-only (notification_failures + notification_events) and contains codes/fixed text only — never raw
//    provider errors, e-mail addresses or message content.
export const BACKOFF_MS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 12 * 3600e3]; // after failed attempt 1..5
export const MAX_AMBIGUOUS = 2; // the first ambiguous outcome + the ONE additional attempt that follows it
const iso = (ms) => new Date(ms).toISOString();
const STALE_MS = 5 * 60e3;
const token = () => crypto.randomUUID();

/** Turn any thrown value into {code, ambiguous}. Never keeps the original message (it may contain addresses or names). */
export function classifyError(e) {
  const name = typeof e?.name === "string" ? e.name : "", rawCode = typeof e?.code === "string" ? e.code : "";
  const ambiguous = name === "TimeoutError" || name === "AbortError" || e?.ambiguous === true || ["ETIMEDOUT", "ECONNRESET", "E_TIMEOUT"].includes(rawCode);
  const pick = [rawCode, name].find((c) => /^[A-Za-z0-9_.-]{2,64}$/.test(c) && c !== "Error");
  return { code: ambiguous && !pick ? "timeout" : pick ?? "unknown", ambiguous };
}
const fixedText = (c) => (c.ambiguous ? "delivery unconfirmed (ambiguous provider outcome): " + c.code : "provider refused or failed: " + c.code);

const event = (db, id, name, detail = null, guardToken = null) => guardToken
  ? db.prepare("INSERT INTO notification_events(queue_id,at,event,detail) SELECT ?1,?2,?3,?4 WHERE EXISTS (SELECT 1 FROM notification_queue WHERE id=?1 AND lock_token=?5)").bind(id, iso(Date.now()), name, detail, guardToken)
  : db.prepare("INSERT INTO notification_events(queue_id,at,event,detail) VALUES (?1,?2,?3,?4)").bind(id, iso(Date.now()), name, detail);

/**
 * Apply one failed/ambiguous/reclaimed outcome. Compare-and-set on the lock token the caller saw: exactly one caller wins
 * (changes === 1); the history rows are written only by the winner, in the same transaction.
 */
async function applyOutcome(db, row, { kind, code, ambiguous }, now) {
  const mine = token(), attempts = row.attempts + 1, amb = row.ambiguous_count + (ambiguous ? 1 : 0), exhausted = attempts >= row.max_attempts;
  // Once ANY attempt has ended ambiguously the message may already be out, so exactly ONE further automatic attempt is allowed,
  // whatever that attempt's own outcome is. After it (accepted aside) the row stops: 'unconfirmed' (owner decides). An ambiguous
  // outcome that exhausts the attempt budget is also 'unconfirmed', never 'dead' (dead = we know it was refused every time).
  const status = row.ambiguous_count >= 1 ? "unconfirmed" : ambiguous ? (exhausted ? "unconfirmed" : "failed") : exhausted ? "dead" : "failed";
  const next = iso(now + BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1]), text = fixedText({ code, ambiguous });
  const res = await db.batch([
    db.prepare(`UPDATE notification_queue SET status=?3, attempts=?4, ambiguous_count=?5, last_error_code=?6, locked_at=NULL, provider_called_at=NULL, lock_token=?7,
        possible_duplicate=CASE WHEN ?8=1 THEN 1 ELSE possible_duplicate END, next_attempt_at=?9 WHERE id=?1 AND status='sending' AND lock_token IS ?2`)
      .bind(row.id, row.lock_token ?? null, status, attempts, amb, code, mine, ambiguous ? 1 : 0, next),
    db.prepare("INSERT INTO notification_failures(queue_id,at,attempt,kind,code,error) SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS (SELECT 1 FROM notification_queue WHERE id=?1 AND lock_token=?7)").bind(row.id, iso(now), attempts, kind, code, text, mine),
    event(db, row.id, status === "unconfirmed" ? "unconfirmed_no_more_automatic_attempts" : status === "dead" ? "dead" : kind, code, mine),
  ]);
  return res[0].meta.changes === 1 ? status : null; // null = someone else already handled this row
}

/**
 * @param provider async (row, {idempotencyKey, possibleDuplicate}) => {messageId?} — throws on failure.
 *        null/undefined = no provider configured: rows stay queued (visible in Admin); nothing is marked failed.
 */
export async function dispatchDue(env, provider, { now = Date.now(), batch = 10 } = {}) {
  const db = env.ORDERS_DB, real0 = Date.now(), clock = () => now + (Date.now() - real0);
  const stats = { claimed: 0, sent: 0, failed: 0, dead: 0, unconfirmed: 0, reclaimed: 0, lateAccept: 0 };
  // 1) recover rows whose worker vanished (stale lock). If the provider call had started, the outcome is AMBIGUOUS.
  const stale = (await db.prepare("SELECT * FROM notification_queue WHERE status='sending' AND locked_at<=?1").bind(iso(now - STALE_MS)).all()).results;
  for (const r of stale) {
    const called = !!r.provider_called_at;
    const st = await applyOutcome(db, r, called ? { kind: "unconfirmed_delivery", code: "worker_stopped_after_provider_call", ambiguous: true } : { kind: "reclaimed", code: "worker_stopped_before_provider_call", ambiguous: false }, now);
    if (st) { stats.reclaimed++; if (st === "unconfirmed") stats.unconfirmed++; }
  }
  if (!provider) return stats;
  // 2) atomic claim (concurrent runs cannot claim the same row)
  const mine = token();
  const rows = (await db.prepare(
    `UPDATE notification_queue SET status='sending', locked_at=?1, lock_token=?3, provider_called_at=NULL WHERE id IN
       (SELECT id FROM notification_queue WHERE status IN ('queued','failed') AND next_attempt_at<=?1 ORDER BY next_attempt_at, id LIMIT ?2) RETURNING *`).bind(iso(now), batch, mine).all()).results;
  stats.claimed = rows.length;
  for (const row of rows) {
    const meta = { idempotencyKey: "norx-notification-" + row.id, possibleDuplicate: row.possible_duplicate === 1 };
    // persisted BEFORE the call, so a crash afterwards is recognised as ambiguous
    const called = await db.prepare("UPDATE notification_queue SET provider_called_at=?2 WHERE id=?1 AND lock_token=?3").bind(row.id, iso(clock()), mine).run();
    if (called.meta.changes !== 1) continue; // reclaimed by someone else before we started: do not send
    await event(db, row.id, "provider_called", meta.possibleDuplicate ? "possible_duplicate_retry" : null).run();
    let result;
    try { result = await provider(row, meta); }
    catch (e) {
      const c = classifyError(e), st = await applyOutcome(db, { ...row, lock_token: mine }, { kind: c.ambiguous ? "ambiguous" : "failed", ...c }, now);
      if (st) stats[st]++;
      continue;
    }
    // provider accepted. Record it (one retry); if the database is unreachable we throw and leave the row 'sending' with
    // provider_called_at set — step 1 will treat it as ambiguous.
    const sentAt = clock(), mid = typeof result?.messageId === "string" && /^[\w<>@.+=:-]{1,200}$/.test(result.messageId) ? result.messageId.replace(/@[^\s>]*/, "@…") : null; // keep the id, drop any domain part
    const mark = () => db.batch([
      db.prepare(`UPDATE notification_queue SET status='sent', sent_at=?2, provider_accepted_at=?2, provider_message_id=?4, attempts=attempts+1, last_error_code=NULL, locked_at=NULL, lock_token=NULL, provider_called_at=NULL
          WHERE id=?1 AND status='sending' AND lock_token=?3`).bind(row.id, iso(sentAt), mine, mid),
      // notification latency = enqueue -> provider accepted; recorded separately from order-creation latency
      db.prepare("INSERT INTO latency_log(kind,ref,ms,at) SELECT 'notification',?1,?2,?3 WHERE changes()=1").bind(String(row.id), Math.max(0, sentAt - Date.parse(row.created_at)), iso(sentAt)),
    ]);
    let res; try { res = await mark(); } catch { res = await mark(); }
    if (res[0].meta.changes === 1) { stats.sent++; await event(db, row.id, "provider_accepted", mid ? "message_id_recorded" : "no_message_id").run(); }
    else { stats.lateAccept++; await event(db, row.id, "late_accept_after_reclaim", "row was recovered by another worker; a duplicate may follow").run(); }
  }
  return stats;
}

// ---------- owner actions (append history; never delete it) ----------
export async function retryNotification(env, id, now = Date.now()) { // failed | dead | unconfirmed -> queued (counters reset, history kept)
  const db = env.ORDERS_DB, r = await db.prepare("UPDATE notification_queue SET status='queued', attempts=0, ambiguous_count=0, next_attempt_at=?2, locked_at=NULL, lock_token=NULL WHERE id=?1 AND status IN ('failed','dead','unconfirmed')").bind(id, iso(now)).run();
  if (r.meta.changes === 1) await event(db, id, "manual_retry").run();
  return r.meta.changes === 1;
}
export async function markNotificationReceived(env, id, now = Date.now()) { // owner confirms the message actually arrived
  const db = env.ORDERS_DB, r = await db.prepare("UPDATE notification_queue SET status='sent', sent_at=COALESCE(sent_at,?2), delivery_confirmed_at=?2, locked_at=NULL, lock_token=NULL WHERE id=?1 AND status IN ('failed','dead','unconfirmed','sent')").bind(id, iso(now)).run();
  if (r.meta.changes === 1) await event(db, id, "manual_marked_received").run();
  return r.meta.changes === 1;
}
export async function listNotifications(env, { limit = 50 } = {}) {
  return (await env.ORDERS_DB.prepare(
    `SELECT q.id, o.order_no AS orderNo, q.channel, q.template, q.status, q.attempts, q.max_attempts AS maxAttempts, q.ambiguous_count AS ambiguousCount, q.possible_duplicate AS possibleDuplicate,
            q.next_attempt_at AS nextAttemptAt, q.last_error_code AS lastErrorCode, q.created_at AS createdAt, q.sent_at AS sentAt, q.provider_message_id AS providerMessageId, q.delivery_confirmed_at AS deliveryConfirmedAt
     FROM notification_queue q LEFT JOIN orders o ON o.id=q.order_id WHERE q.status!='sent' ORDER BY q.id DESC LIMIT ?1`).bind(Math.min(limit, 200)).all()).results;
}
export async function notificationHistory(env, id) {
  const db = env.ORDERS_DB, f = (await db.prepare("SELECT at, attempt, kind, code FROM notification_failures WHERE queue_id=?1 ORDER BY id").bind(id).all()).results;
  const e = (await db.prepare("SELECT at, event, detail FROM notification_events WHERE queue_id=?1 ORDER BY id").bind(id).all()).results;
  return { failures: f, events: e };
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

// ---------- providers ----------
/** Owner alert text (same content as the V1 e-mail). Pure. The reference line lets a human spot a duplicate; no provider-side dedupe is assumed. */
export function renderOrderAlert(payload, { adminUrl = "", possibleDuplicate = false, reference = "" } = {}) {
  const sleeve = (x) => (x === "short" ? "แขนสั้น" : "แขนยาว");
  const body = ["ออเดอร์ใหม่ " + payload.orderNo, payload.name + " · " + payload.phone, ...payload.items.map((i) => i.name + " / " + sleeve(i.sleeve) + " / " + i.size + " × " + i.qty), "ยอดที่ต้องตรวจ " + payload.total + " บาท", "ตรวจสลิปในเพจและเงินเข้าบัญชีก่อนยืนยัน", adminUrl, reference ? "รหัสอ้างอิงการแจ้งเตือน: " + reference : ""].filter(Boolean);
  if (possibleDuplicate) body.unshift("(อาจเป็นข้อความซ้ำ: ระบบยืนยันการส่งครั้งก่อนไม่ได้)");
  return { subject: (possibleDuplicate ? "[NORX][อาจซ้ำ] " : "[NORX] ") + payload.orderNo + " · " + payload.total + " บาท", text: body.join("\n") };
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Cloudflare Email Service (Workers `send_email` binding, structured API):
 *   const result = await env.EMAIL.send({ from, to, subject, text });   // result.messageId
 * (documented at developers.cloudflare.com/email-service/api/send-emails/workers-api/ — verified by the project reviewer).
 * Acceptance by the service is NOT inbox delivery. The binding itself should be restricted to the verified owner recipient
 * (destination_address / allowed_destination_addresses in the wrangler `send_email` entry) — see docs/EMAIL_NOTIFICATIONS.md.
 */
export async function sendViaBinding(binding, msg) { return binding.send(msg); }
export function makeEmailProvider(env, getRecipient) {
  if (!env.EMAIL || typeof env.EMAIL.send !== "function") return null;
  return async (row, meta) => {
    const to = await getRecipient(), from = env.NOTIFY_FROM;
    if (!to || !EMAIL_RE.test(to)) { const e = new Error("recipient"); e.code = "recipient_not_configured"; throw e; }
    if (!from || !EMAIL_RE.test(from)) { const e = new Error("sender"); e.code = "sender_not_configured"; throw e; }
    const { subject, text } = renderOrderAlert(JSON.parse(row.payload), { adminUrl: env.ORDERS_ADMIN_URL || "", possibleDuplicate: meta?.possibleDuplicate, reference: meta?.idempotencyKey });
    const result = await sendViaBinding(env.EMAIL, { from, to, subject, text });
    return { messageId: result?.messageId };
  };
}
/** Generic outbound webhook (fallback). 5xx and timeouts are AMBIGUOUS (the receiver may have processed the request). */
export function makeWebhookProvider(env, getRecipient) {
  if (!env.NOTIFY_WEBHOOK_URL) return null;
  return async (row, meta) => {
    const res = await fetch(env.NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(env.NOTIFY_WEBHOOK_TOKEN ? { Authorization: "Bearer " + env.NOTIFY_WEBHOOK_TOKEN } : {}) },
      body: JSON.stringify({ id: row.id, channel: row.channel, template: row.template, to: await getRecipient(), reference: meta?.idempotencyKey, possibleDuplicate: !!meta?.possibleDuplicate, payload: JSON.parse(row.payload) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { const e = new Error("http"); e.code = "http_" + res.status; e.ambiguous = res.status >= 500; throw e; }
    return {};
  };
}
/** Preference: native email binding > webhook > none (queue holds the messages). */
export const makeProvider = (env, getRecipient) => makeEmailProvider(env, getRecipient) ?? makeWebhookProvider(env, getRecipient);
const channelMode = env => env.EMAIL && typeof env.EMAIL.send === "function" ? "email" : env.NOTIFY_WEBHOOK_URL ? "webhook" : "none";
/** Local configuration check for tools/tests. Admin uses the Public Worker's report below. Nothing is sent here. */
export async function notificationReadiness(env, getRecipient) {
  const mode = channelMode(env), missing = [];
  if (mode === "none") missing.push("ช่องทางส่ง (Email binding หรือ webhook)");
  if (mode === "email" && (!env.NOTIFY_FROM || !EMAIL_RE.test(env.NOTIFY_FROM))) missing.push("อีเมลผู้ส่ง (NOTIFY_FROM)");
  if (mode !== "none" && !EMAIL_RE.test((await getRecipient()) || "")) missing.push("อีเมลผู้รับแจ้งเตือน (ตั้งค่าที่ Storefront settings)");
  return { mode, ready: mode !== "none" && missing.length === 0, missing };
}

// The Public Worker owns sending. Admin reads its recent, non-sensitive configuration report,
// not Admin's own bindings. This proves configuration only, never provider acceptance or inbox delivery.
export const CHANNEL_REPORT_KEY = "notification_channel_report";
export const CHANNEL_REPORT_MAX_AGE_MS = 5 * 60e3;
export async function reportNotificationChannel(env, { now = Date.now() } = {}) {
  const mode = channelMode(env);
  const report = { version: 1, environment: env.ENVIRONMENT, mode,
    senderConfigured: mode !== "email" || EMAIL_RE.test(env.NOTIFY_FROM || ""), checkedAt: iso(now) };
  await env.ORDERS_DB.prepare("INSERT INTO settings(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(CHANNEL_REPORT_KEY, JSON.stringify(report)).run();
}
export async function reportedNotificationReadiness(env, getRecipient, { now = Date.now() } = {}) {
  const unknown = (reason, checkedAt = null) => ({ mode: "unknown", ready: false, missing: [reason], source: "public_worker", checkedAt });
  const row = await env.ORDERS_DB.prepare("SELECT value FROM settings WHERE key=?1").bind(CHANNEL_REPORT_KEY).first();
  if (!row) return unknown("รอระบบส่งแจ้งเตือนรายงานสถานะ");
  let report; try { report = JSON.parse(row.value); } catch { return unknown("สถานะจากระบบส่งแจ้งเตือนไม่ถูกต้อง"); }
  const at = Date.parse(report?.checkedAt);
  if (report?.version !== 1 || report.environment !== env.ENVIRONMENT || !["email", "webhook", "none"].includes(report.mode) || typeof report.senderConfigured !== "boolean" || !Number.isFinite(at)) {
    return unknown("สถานะจากระบบส่งแจ้งเตือนไม่ถูกต้อง");
  }
  if (at > now + 60e3 || now - at > CHANNEL_REPORT_MAX_AGE_MS) return unknown("สถานะจากระบบส่งแจ้งเตือนไม่เป็นปัจจุบัน", iso(at));
  const missing = [];
  if (report.mode === "none") missing.push("ช่องทางส่ง (Email binding หรือ webhook)");
  if (report.mode === "email" && !report.senderConfigured) missing.push("อีเมลผู้ส่ง (NOTIFY_FROM)");
  // Read the current recipient: an owner edit must take effect without waiting for the next cron.
  if (report.mode !== "none" && !EMAIL_RE.test((await getRecipient()) || "")) missing.push("อีเมลผู้รับแจ้งเตือน (ตั้งค่าที่ Storefront settings)");
  return { mode: report.mode, ready: report.mode !== "none" && missing.length === 0, missing, source: "public_worker", checkedAt: iso(at) };
}
