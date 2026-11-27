import { verifiedOwner } from "./admin-access-worker.mjs";
import { environmentGuard } from "./orders-guard.mjs";
import { assets } from "./generated/orders-admin-assets.mjs";
import * as api from "./orders-admin-api.mjs";
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
    try { return await handler(request, env, env.MEDIA_ADMIN_EMAIL_HASH, m); } catch { return reply("SERVER_ERROR", 500); }
  },
};
