import { verifiedOwner } from "./admin-access-worker.mjs";
import { environmentGuard } from "./orders-guard.mjs";
import { assets } from "./generated/orders-admin-assets.mjs";
import * as api from "./orders-admin-api.mjs";
import * as svc from "./orders-service.mjs";
import { UserError } from "./orders-core.mjs";
import { listNotifications, retryNotification, markNotificationReceived, notificationHistory, latencyStats, notificationReadiness } from "./orders-notify.mjs";
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const reply = (error, status) => Response.json({ error }, { status, headers });
const pageCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export async function overview(env) {
  const one = async (sql) => (await env.ORDERS_DB.prepare(sql).first())?.n ?? 0;
  return {
    awaitingPayment: await one("SELECT COUNT(*) n FROM orders WHERE is_test=0 AND payment_status IN ('pending','slip_received') AND fulfillment_status!='cancelled'"),
    readyForProduction: await one("SELECT COUNT(*) n FROM orders WHERE is_test=0 AND payment_status='confirmed' AND fulfillment_status='received'"),
    awaitingShipment: await one("SELECT COUNT(*) n FROM orders WHERE is_test=0 AND fulfillment_status='ready_ship'"),
  };
}

const csvResponse = (csv, name) => new Response(csv, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"` } });
const decoded = new Map();
const bytes = (name) => { if (!decoded.has(name)) decoded.set(name, Uint8Array.from(atob(assets[name].base64), (c) => c.charCodeAt(0))); return decoded.get(name); };
const page = (name) => new Response(assets[name].text, { headers: { ...headers, "Content-Type": assets[name].type, "Content-Security-Policy": pageCsp } });
const asset = (name) => {
  const a = assets[name];
  return new Response(a.text ?? bytes(name), { headers: { ...headers, "Cache-Control": "private, max-age=3600", "Content-Type": a.type } });
};

// [method, pattern, kind, handler]. kind: "page" | "asset" (no DB) | "api" (guarded) | "write" (guarded + same-origin required)
const routes = [
  ["GET", /^\/api\/admin\/overview$/, "api", async (r, env) => api.json(await overview(env))],
  ["GET", /^\/api\/admin\/settings\/sender$/, "api", (r, env) => api.senderResponse(env)],
  ["PUT", /^\/api\/admin\/settings\/sender$/, "write", (r, env, a) => api.putSender(r, env, a)],
  ["GET", /^\/api\/admin\/labels\/orders$/, "api", (r, env) => api.labelOrders(new URL(r.url), env)],
  ["POST", /^\/api\/admin\/labels\/data$/, "write", (r, env) => api.labelData(r, env)],
  ["POST", /^\/api\/admin\/labels\/printed$/, "write", (r, env, a) => api.markPrinted(r, env, a)],
  ["PUT", /^\/api\/admin\/orders\/(\d{1,12})\/address$/, "write", (r, env, a, m) => api.putAddress(r, env, a, +m[1])],
  ["PUT", /^\/api\/admin\/orders\/(\d{1,12})\/shipment$/, "write", (r, env, a, m) => api.putShipment(r, env, a, +m[1])],
  ["GET", /^\/api\/admin\/orders$/, "api", async (r, env) => { const q = new URL(r.url).searchParams; return api.json({ ok: true, orders: await svc.listOrders(env, { round: q.get("round") || undefined, status: q.get("status") || undefined, q: (q.get("q") || "").slice(0, 60) || undefined }) }); }],
  ["POST", /^\/api\/admin\/orders\/(NORX-[A-Za-z0-9-]{1,60})\/status$/, "write", async (r, env, a, m) => { const b = await r.json().catch(() => null); if (!b || typeof b.from !== "string" || typeof b.to !== "string") return api.json({ ok: false, error: "BAD_REQUEST" }, 400); return api.json({ ok: true, ...(await svc.changeStatus(env, a, { orderNo: m[1], from: b.from, to: b.to, amount: b.amount })) }); }],
  ["GET", /^\/api\/admin\/rounds$/, "api", async (r, env) => api.json({ ok: true, ...(await svc.roundsWithSummary(env, Date.now())) })],
  ["POST", /^\/api\/admin\/rounds$/, "write", async (r, env, a) => api.json({ ok: true, ...(await svc.saveRound(env, a, await r.json().catch(() => ({})))) })],
  ["POST", /^\/api\/admin\/rounds\/(ROUND-\d{3,})\/(open|close|cancel-unpaid|send-to-shop)$/, "write", async (r, env, a, m) => {
    const b = await r.json().catch(() => ({}));
    const out = m[2] === "open" ? await svc.openRound(env, a, m[1]) : m[2] === "close" ? await svc.closeRound(env, a, m[1]) : m[2] === "cancel-unpaid" ? await svc.cancelUnpaid(env, a, m[1], b.expected) : await svc.sendToShop(env, a, m[1], b.expectedPieces);
    return api.json({ ok: true, ...(out ?? {}) });
  }],
  ["GET", /^\/api\/admin\/dashboard$/, "api", async (r, env) => api.json({ ok: true, ...(await svc.dashboard(env, { includeTest: new URL(r.url).searchParams.get("includeTest") === "1" })) })],
  ["GET", /^\/api\/admin\/production\/summary$/, "api", async (r, env) => { const q = new URL(r.url).searchParams; return api.json({ ok: true, ...(await svc.productionSummary(env, { round: q.get("round") || "", includeTest: q.get("includeTest") === "1" })) }); }],
  ["GET", /^\/api\/admin\/production\/summary\.csv$/, "api", async (r, env) => { const q = new URL(r.url).searchParams; const csv = svc.productionCsv(await svc.productionSummary(env, { round: q.get("round") || "", includeTest: q.get("includeTest") === "1" })); return csvResponse(csv, "NORX-production-" + (q.get("round") || "all") + ".csv"); }],
  ["POST", /^\/api\/admin\/production\/items-status$/, "write", async (r, env, a) => { const b = await r.json().catch(() => null); if (!b) return api.json({ ok: false, error: "BAD_REQUEST" }, 400); return api.json({ ok: true, ...(await svc.setItemsStatus(env, a, { round: String(b.round || ""), from: b.from, to: b.to, product: b.product || null, sleeve: b.sleeve || null, size: b.size || null, expected: b.expected })) }); }],
  ["GET", /^\/api\/admin\/orders\/export\.csv$/, "api", async (r, env) => { const q = new URL(r.url).searchParams; return csvResponse(await svc.ordersCsv(env, env.MEDIA_ADMIN_EMAIL_HASH, { round: q.get("round") || undefined, status: q.get("status") || undefined, includeTest: q.get("includeTest") !== "0" }), "NORX-orders-" + (q.get("round") || "all") + ".csv"); }],
  ["GET", /^\/admin\/?$/, "page", () => page("overview.html")],
  ["GET", /^\/admin\/production\/?$/, "page", () => page("production.html")],
  ["GET", /^\/admin\/products\/?$/, "page", () => page("products.html")],
  ["GET", /^\/api\/admin\/integrity$/, "api", async (r, env) => api.json({ ok: true, violations: await svc.paymentIntegrity(env) })],
  ["GET", /^\/api\/admin\/pulse$/, "api", async (r, env) => api.json({ ok: true, ...(await svc.pulse(env)) })],
  ["GET", /^\/api\/admin\/notifications$/, "api", async (r, env) => api.json({ ok: true, notifications: await listNotifications(env), readiness: await notificationReadiness(env, async () => (await svc.getSetting(env, "storefront"))?.notifyTo ?? null) })],
  ["GET", /^\/api\/admin\/notifications\/(\d{1,12})\/history$/, "api", async (r, env, a, m) => api.json({ ok: true, ...(await notificationHistory(env, +m[1])) })],
  ["POST", /^\/api\/admin\/notifications\/(\d{1,12})\/received$/, "write", async (r, env, a, m) => api.json({ ok: true, marked: await markNotificationReceived(env, +m[1]) })],
  ["POST", /^\/api\/admin\/notifications\/(\d{1,12})\/retry$/, "write", async (r, env, a, m) => api.json({ ok: true, retried: await retryNotification(env, +m[1]) })],
  ["GET", /^\/api\/admin\/metrics\/latency$/, "api", async (r, env) => api.json({ ok: true, latency: await latencyStats(env) })],
  ["GET", /^\/api\/admin\/settings\/storefront$/, "api", async (r, env) => api.json({ ok: true, storefront: await api.getStorefront(env) })],
  ["PUT", /^\/api\/admin\/settings\/storefront$/, "write", (r, env, a) => api.putStorefront(r, env, a)],
  ["GET", /^\/admin\/orders\/?$/, "page", () => page("orders.html")],
  ["GET", /^\/admin\/shipping\/?$/, "page", () => page("shipping.html")],
  ["GET", /^\/admin\/settings\/?$/, "page", () => page("settings.html")],
  ["GET", /^\/admin\/assets\/([A-Za-z0-9._-]+)$/, "asset", (r, env, a, m) => (m[1] in assets && !m[1].endsWith(".html") ? asset(m[1]) : reply("NOT_FOUND", 404))],
];

// Every route: allowlist -> host -> method -> owner identity -> (api) environment guard -> (write) same-origin -> handler.
export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.origin !== env.ORDERS_ALLOWED_ORIGIN) return reply("NOT_FOUND", 404);
    const hits = routes.map((r) => [r, u.pathname.match(r[1])]).filter(([, m]) => m);
    if (!hits.length) return reply("NOT_FOUND", 404);
    const hit = hits.find(([r]) => r[0] === request.method || (r[0] === "GET" && request.method === "HEAD"));
    if (!hit) return reply("METHOD", 405);
    if (!(await verifiedOwner(ctx, env))) return reply("ACCESS_REQUIRED", 403);
    const [[, , kind, handler], m] = hit;
    if (kind === "api" || kind === "write") {
      if (!(await environmentGuard(env))) return reply("ENVIRONMENT_MISMATCH", 503);
      if (kind === "write" && request.headers.get("Origin") !== env.ORDERS_ALLOWED_ORIGIN) return reply("CROSS_ORIGIN", 403);
    }
    try { return await handler(request, env, env.MEDIA_ADMIN_EMAIL_HASH, m); } catch (e) { return e instanceof UserError ? Response.json({ ok: false, error: "USER_ERROR", message: e.message }, { status: 400, headers }) : reply("SERVER_ERROR", 500); }
  },
};
