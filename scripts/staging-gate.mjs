// Access gate: run IMMEDIATELY after the staging routes exist and BEFORE any other test or sharing of the URL.
// Probes the hostname with NO credentials. Every probe must be stopped at the edge by Cloudflare Access (redirect to *.cloudflareaccess.com,
// or 401/403 with no application content). A 200, a 404 from an application route, or any application content means the hostname is
// exposed: remove the routes (non-destructive: keep Workers, D1 and the Access app), fix the policy, run the gate again.
// Usage: node scripts/staging-gate.mjs --base https://staging.norxcraftingmovement.com
import { fileURLToPath } from "node:url";
export const PROBES = [["GET", "/"], ["GET", "/cart/"], ["GET", "/pay/"], ["GET", "/shop.js"], ["GET", "/assets/pay-panel.js"], ["GET", "/api/orders"], ["POST", "/api/orders"], ["GET", "/api/orders/pay?o=NORX-00000000&t=" + "A".repeat(22)],
  ["GET", "/admin/"], ["GET", "/admin/orders/"], ["GET", "/admin/assets/style.css"], ["GET", "/api/admin/dashboard"], ["GET", "/api/admin/orders/export.csv"], ["POST", "/api/admin/orders/NORX-AAAAAAAA/status"], ["GET", "/robots.txt"], ["GET", "/nonexistent-" + "x".repeat(6)]];
const APP = /NORX|"ok"\s*:|<title>|ACCESS_REQUIRED|NOT_FOUND/;
export function judge(status, location, body) {
  if ([301, 302, 303, 307, 308].includes(status)) { let h = ""; try { h = new URL(location, "https://x.invalid").hostname; } catch {} return h.endsWith("cloudflareaccess.com") ? { ok: true, how: "redirect to Access login" } : { ok: false, why: "redirects somewhere other than Cloudflare Access: " + location }; }
  if ((status === 401 || status === 403) && !APP.test(String(body).slice(0, 4000))) return { ok: true, how: "blocked (" + status + ") with no application content" };
  return { ok: false, why: "reached the origin or returned content (HTTP " + status + ")" };
}
export async function checkGate({ base, fetchImpl = fetch }) {
  const results = [];
  for (const [method, path] of PROBES) {
    try { const r = await fetchImpl(base + path, { method, redirect: "manual", headers: method === "POST" ? { "Content-Type": "application/json" } : {}, body: method === "POST" ? "{}" : undefined }); const j = judge(r.status, r.headers.get("location") ?? "", await r.text()); results.push({ method, path, status: r.status, ...j }); }
    catch (e) { results.push({ method, path, ok: false, why: "no response: " + e.message }); }
  }
  return { ok: results.every((r) => r.ok), results };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), base = a[a.indexOf("--base") + 1];
  if (!base || !/staging/.test(base)) { console.error("usage: node scripts/staging-gate.mjs --base https://staging…"); process.exit(2); }
  const r = await checkGate({ base: base.replace(/\/$/, "") });
  for (const x of r.results) console.log((x.ok ? "PASS " : "FAIL ") + x.method + " " + x.path + " → " + x.status + " " + (x.how ?? x.why));
  console.log(r.ok ? "\nGATE OK: the hostname is closed to everyone but the Access policy." : "\nGATE FAILED: the hostname is EXPOSED. Remove the routes now (keep Workers, D1, Access app), fix the Access policy, re-run.");
  process.exit(r.ok ? 0 : 1);
}
