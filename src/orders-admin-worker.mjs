import { verifiedOwner } from "./admin-access-worker.mjs";
import { environmentGuard } from "./orders-guard.mjs";
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const reply = (data, status = 200) => Response.json(data, { status, headers });
const routes = new Map([["/api/admin/overview", "GET"]]);

export async function overview(env) {
  const one = async (sql) => (await env.ORDERS_DB.prepare(sql).first())?.n ?? 0;
  return {
    awaitingPayment: await one("SELECT COUNT(*) n FROM orders WHERE is_test=0 AND payment_status IN ('pending','slip_received') AND fulfillment_status!='cancelled'"),
    readyForProduction: await one("SELECT COUNT(*) n FROM orders WHERE is_test=0 AND payment_status='confirmed' AND fulfillment_status='received'"),
    awaitingShipment: await one("SELECT COUNT(*) n FROM orders WHERE is_test=0 AND fulfillment_status='ready_ship'"),
  };
}

// Every route: allowlist -> Origin/host -> owner identity -> environment guard -> handler.
export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    const method = routes.get(u.pathname);
    if (!method || u.origin !== env.ORDERS_ALLOWED_ORIGIN) return reply({ error: "NOT_FOUND" }, 404);
    if (request.method !== method) return reply({ error: "METHOD" }, 405);
    if (!(await verifiedOwner(ctx, env))) return reply({ error: "ACCESS_REQUIRED" }, 403);
    if (!(await environmentGuard(env))) return reply({ error: "ENVIRONMENT_MISMATCH" }, 503);
    return reply(await overview(env));
  },
};
