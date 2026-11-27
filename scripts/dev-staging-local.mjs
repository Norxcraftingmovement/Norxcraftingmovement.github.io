// LOCAL ONLY. Mimics the staging host routing on one origin so the smoke/UI checks can be rehearsed without Cloudflare:
//   /api/orders*  -> public Orders Worker      /admin*, /api/admin/* -> admin Worker      everything else -> dist-staging (static)
// In-memory SQLite, SYNTHETIC catalog/bank/PromptPay data, mock e-mail binding. Requests carrying "x-dev-anon: 1" are treated
// as unauthenticated (what Cloudflare Access would stop at the edge). Never touches Cloudflare or any real data.
import http from "node:http";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import admin from "../src/orders-admin-worker.mjs";
import pub from "../src/orders-public-worker.mjs";
import { putPaymentSettings, verifyPaymentSettings } from "../src/payments.mjs";
const root = fileURLToPath(new URL("../", import.meta.url)), read = (p) => readFileSync(join(root, p), "utf8");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".txt": "text/plain" };
export async function start(port = 0, { emailFails = false, staticDir = join(root, "dist-staging"), rateLimit = null, edgeAccess = true } = {}) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  for (const f of readdirSync(join(root, "migrations/orders")).filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(read("migrations/orders/" + f)); // all migrations, in order
  sqlite.exec("INSERT INTO meta(key,value) VALUES ('environment','staging')");
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => sqlite.prepare(sql).get(...args) ?? null, all: async () => ({ results: sqlite.prepare(sql).all(...args) }), run: async () => ({ success: true, meta: { changes: sqlite.prepare(sql).run(...args).changes } }), _run: () => ({ success: true, meta: { changes: sqlite.prepare(sql).run(...args).changes } }) });
  const db = { prepare: (s) => stmt(s), batch: async (l) => { sqlite.exec("BEGIN"); try { const o = l.map((s) => s._run()); sqlite.exec("COMMIT"); return o; } catch (e) { sqlite.exec("ROLLBACK"); throw e; } } };
  sqlite.exec(`INSERT INTO products(id,slug,name,short_name,fit,fit_name,status,sort) VALUES (1,'drop03','HOME TERRAIN EDITION','DROP 03','boxy','ทรง Boxy','active',0),(2,'drop02','WOVEN STRIDE EDITION','DROP 02','regular','ทรงปกติ','active',1);
    INSERT INTO product_variants(product_id,sleeve,price_baht) VALUES (1,'short',490),(1,'long',590),(2,'short',490),(2,'long',590);
    INSERT INTO product_sizes(product_id,size,sort) VALUES (1,'S',1),(1,'M',2),(1,'L',3),(2,'S',1),(2,'M',2),(2,'L',3);`);
  const t = (ms) => new Date(ms).toISOString(), n0 = Date.now();
  sqlite.prepare("INSERT INTO rounds(code,name,opens_at,closes_at,payment_due_at,shipping_baht,supplier_shipping_baht,deliveries,status) VALUES ('ROUND-001','รอบทดสอบ 1',?,?,?,50,80,'[\"city\",\"event\",\"ship\"]','open')").run(t(n0 - 864e5), t(n0 + 5 * 864e5), t(n0 + 6 * 864e5));
  sqlite.prepare("INSERT INTO settings(key,value) VALUES ('storefront',?)").run(JSON.stringify({ bank: { name: "TEST BANK", account: "000-0-00000-0", holder: "TEST HOLDER" }, chatUrl: "https://example.test/c", pageUrl: "https://example.test/p", eventName: "TEST", liveEnabled: true, rolling: false, notifyTo: "owner@example.test" }));
  sqlite.prepare("INSERT INTO settings(key,value) VALUES ('sender',?)").run(JSON.stringify({ brandName: "NORX TEST", senderName: "ผู้ส่ง ทดสอบ", address: "1 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 00000", phone: "0800000000" }));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("owner@example.test"))), (b) => b.toString(16).padStart(2, "0")).join("");
  const sent = [], hits = new Map(); let origin = "";
  // Emulates the Workers Rate Limiting binding (per key, sliding window). null = no limiter.
  const limiter = rateLimit ? { limit: async ({ key }) => { const now = Date.now(), a = (hits.get(key) ?? []).filter((t) => now - t < rateLimit.periodMs); if (a.length >= rateLimit.limit) { hits.set(key, a); return { success: false }; } a.push(now); hits.set(key, a); return { success: true }; } } : undefined;
  const media = new Map();
  const productMedia = { put: async (key, value, options) => media.set(key, {bytes:new Uint8Array(value), ...options}), get: async key => { const o=media.get(key); return o ? {...o,body:o.bytes} : null; }, delete: async key => media.delete(key) };
  const mkEnv = () => ({ PRODUCT_MEDIA: productMedia, ENVIRONMENT: "staging", ORDERS_DB_LABEL: "staging", ORDERS_DB: db, ORDERS_ALLOWED_ORIGIN: origin, ORDERS_PUBLIC_ORIGINS: origin, STAGING_REQUIRE_ACCESS: "1", MEDIA_ADMIN_ENABLED: "1", MEDIA_ACCESS_AUD: "dev", MEDIA_ADMIN_EMAIL_HASH: hash,
    ...(limiter ? { ORDERS_LIMITER: limiter } : {}), NOTIFY_FROM: "alerts@example.test", ORDERS_ADMIN_URL: origin + "/admin/orders/", EMAIL: { send: async (m) => { if (emailFails) { const e = new Error("owner@example.test refused"); e.code = "E_REFUSED"; throw e; } sent.push(m); return { messageId: "<dev-" + sent.length + "@example.test>" }; } } });
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const u = new URL(req.url, origin), anon = req.headers["x-dev-anon"] === "1", env = mkEnv();
    const ctx = anon ? {} : { access: { aud: "dev", getIdentity: async () => ({ email: "owner@example.test" }) }, waitUntil() {} };
    const send = async (r) => { res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); };
    // Access at the edge: unauthenticated requests never reach any Worker (edgeAccess:false lets them through to test the Workers' own refusal)
    if (anon && edgeAccess && !u.pathname.startsWith("/__dev/")) return send(new Response(null, { status: 302, headers: { location: "https://sim.cloudflareaccess.com/cdn-cgi/access/login/" + u.hostname } }));
    if (u.pathname === "/__dev/sent") return send(Response.json(sent));
    if (u.pathname === "/__dev/cron") { const jobs = []; await pub.scheduled({}, env, { waitUntil: (p) => jobs.push(p) }); await Promise.all(jobs); return send(Response.json({ ok: true, sent: sent.length })); }
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks), rq = () => new Request(origin + req.url, { method: req.method, headers: req.headers, body });
    if (u.pathname.startsWith("/api/orders")) return send(await pub.fetch(rq(), env, ctx));
    if (u.pathname.startsWith("/admin") || u.pathname.startsWith("/api/admin")) return send(await admin.fetch(rq(), env, ctx));
    if (anon) return send(new Response("Access required", { status: 403 }));
    let f = join(staticDir, decodeURIComponent(u.pathname)); if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!f.startsWith(staticDir) || !existsSync(f)) return send(new Response("Not found", { status: 404 }));
    return send(new Response(readFileSync(f), { headers: { "Content-Type": types[extname(f)] ?? "application/octet-stream" } }));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r)); origin = "http://127.0.0.1:" + server.address().port;
  const e0 = mkEnv(); await putPaymentSettings(e0, "dev", { idType: "mobile", id: "0800000000", payeeName: "ผู้รับทดสอบ สมมติ" }); await verifyPaymentSettings(e0, "dev", { confirmName: "ผู้รับทดสอบ สมมติ" });
  return { server, sqlite, sent, url: origin, hits };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const { url } = await start(+process.env.PORT || 8790); console.log("Synthetic staging simulation:", url, " (build first: node scripts/build-staging-storefront.mjs)"); }
