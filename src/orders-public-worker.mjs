// Public storefront API (V1-compatible contract): GET config, POST {action:'submit', order}.
// Anonymous by design; protected by validation, idempotency, rate limit and size caps. No admin routes here.
import { publicConfig, submitOrder } from "./orders-service.mjs";
import { UserError } from "./orders-core.mjs";
import { environmentGuard } from "./orders-guard.mjs";
import { verifiedOwner } from "./orders-access.mjs";
import { dispatchDue, makeProvider } from "./orders-notify.mjs";
import { getSetting } from "./orders-service.mjs";
import { getPayView, getPaySvg } from "./payments.mjs";

const base = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const allowed = (env, origin) => (env.ORDERS_PUBLIC_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(origin);
function respond(env, request, body) {
  const h = { ...base, "Content-Type": "application/json; charset=utf-8" }, o = request.headers.get("Origin");
  if (o && allowed(env, o)) { h["Access-Control-Allow-Origin"] = o; h["Vary"] = "Origin"; }
  return new Response(JSON.stringify(body), { status: 200, headers: h }); // V1 contract: always HTTP 200, errors in {ok:false,error}
}
// Customer payment page data / QR image. Capability URL: order number + random token (stored hashed). Unknown order and wrong token look identical.
async function payRoute(request, env, u) {
  const h = { ...base }, origin = request.headers.get("Origin");
  if (origin && allowed(env, origin)) { h["Access-Control-Allow-Origin"] = origin; h["Vary"] = "Origin"; }
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: h });
  if (!(await environmentGuard(env))) return new Response("Unavailable", { status: 503, headers: h });
  if (env.ORDERS_LIMITER) { const { success } = await env.ORDERS_LIMITER.limit({ key: "pay:" + (request.headers.get("CF-Connecting-IP") ?? "unknown") }); if (!success) return new Response("Too many requests", { status: 429, headers: h }); }
  const o = u.searchParams.get("o") ?? "", t = u.searchParams.get("t") ?? "";
  if (!/^NORX-[A-Za-z0-9-]{1,60}$/.test(o) || !/^[A-Za-z0-9_-]{16,64}$/.test(t)) return new Response("Not found", { status: 404, headers: h });
  try {
    if (u.pathname === "/api/orders/pay.svg") {
      const svg = await getPaySvg(env, o, t, Date.now());
      if (!svg) return new Response("Not found", { status: 404, headers: h });
      return new Response(svg, { headers: { ...h, "Content-Type": "image/svg+xml; charset=utf-8", ...(u.searchParams.get("download") === "1" ? { "Content-Disposition": `attachment; filename="NORX-${o}-QR.svg"` } : {}) } });
    }
    const v = await getPayView(env, o, t, Date.now());
    if (!v) return new Response("Not found", { status: 404, headers: h });
    return new Response(JSON.stringify(v), { headers: { ...h, "Content-Type": "application/json; charset=utf-8" } });
  } catch (e) { console.error("pay route error", e?.message); return new Response("Error", { status: 500, headers: h }); }
}
export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    // Staging: the whole hostname sits behind Cloudflare Access. Defence in depth — if the edge policy were ever misconfigured, this Worker still refuses anyone but the owner.
    if (env.STAGING_REQUIRE_ACCESS === "1" && !(await verifiedOwner(ctx, env))) return new Response(JSON.stringify({ ok: false, error: "ACCESS_REQUIRED" }), { status: 403, headers: { ...base, "Content-Type": "application/json" } });
    if (u.pathname === "/api/orders/pay" || u.pathname === "/api/orders/pay.svg") return payRoute(request, env, u);
    if (u.pathname !== "/api/orders") return new Response("Not found", { status: 404, headers: base });
    if (request.method === "OPTIONS") {
      const o = request.headers.get("Origin");
      return new Response(null, { status: 204, headers: { ...base, ...(o && allowed(env, o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" } : {}) } });
    }
    if (!["GET", "POST"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: base });
    if (!(await environmentGuard(env))) return respond(env, request, { ok: false, error: "ระบบสั่งซื้อยังไม่พร้อม กรุณาทักเพจ NORX" });
    try {
      if (request.method === "GET") return respond(env, request, await publicConfig(env, Date.now()));
      if (env.ORDERS_LIMITER) { const { success } = await env.ORDERS_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") ?? "unknown" }); if (!success) return respond(env, request, { ok: false, error: "ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่" }); }
      const text = await request.text();
      if (text.length > 65536) throw new UserError("ข้อมูลออเดอร์ไม่ถูกต้อง");
      let t; try { t = JSON.parse(text); } catch { throw new UserError("ข้อมูลออเดอร์ไม่ถูกต้อง"); } // text/plain body: no CORS preflight (same as V1)
      if (t?.action !== "submit") throw new UserError("ไม่รองรับคำสั่งนี้");
      return respond(env, request, await submitOrder(env, t.order, { ctx }));
    } catch (e) {
      if (!(e instanceof UserError)) console.error("orders-public error", e?.message); // never log request bodies (PII)
      return respond(env, request, { ok: false, error: e instanceof UserError ? e.message : "ไม่สามารถบันทึกคำขอได้ กรุณาลองใหม่อีกครั้ง หรือทักเพจ NORX" });
    }
  },
  // Cron Trigger: deliver queued notifications. Entirely separate from order creation.
  async scheduled(_event, env, ctx) {
    if (!(await environmentGuard(env))) return;
    ctx.waitUntil(dispatchDue(env, makeProvider(env, async () => (await getSetting(env, "storefront"))?.notifyTo ?? null)));
  },
};
