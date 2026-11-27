// Builds a STANDALONE staging copy of the storefront into dist-staging/ (never published by the production build).
// - checkout/config API is rewritten to the same-origin staging orders API (/api/orders)
// - the production Apps Script URL, Events and Admin pages are NOT included
// - noindex everywhere, a visible STAGING banner, no-store headers
// The build FAILS if anything that could reach production remains in the output.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url)), out = join(root, "dist-staging");
export const STAGING_ORIGIN = "https://staging.norxcraftingmovement.com";
const include = ["index.html", "shop.js", "assets", "cart", "home-terrain", "woven-stride", "community"]; // no events/, no admin/
const banner = '<div role="status" style="position:sticky;top:0;z-index:99999;background:#b04922;color:#fff;font:700 14px/1.4 system-ui,sans-serif;padding:8px 12px;text-align:center">STAGING · ระบบทดสอบ ข้อมูลสมมติเท่านั้น — ห้ามโอนเงินจริง</div>';
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

export function transformHtml(html) {
  let n = 0;
  html = html.replace(/window\.NORX_API="https:\/\/script\.google\.com\/[^"]*"/g, () => (n++, 'window.NORX_API="/api/orders"'));
  html = html.replaceAll("https://norxcraftingmovement.com", STAGING_ORIGIN);
  html = html.replace(/<head>/i, '<head><meta name="robots" content="noindex,nofollow">').replace(/(<body[^>]*>)/i, "$1" + banner);
  return { html, apiRewrites: n };
}
export function build() {
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  for (const p of include) cpSync(join(root, p), join(out, p), { recursive: true });
  let rewrites = 0;
  for (const f of walk(out).filter((f) => extname(f) === ".html")) { const r = transformHtml(readFileSync(f, "utf8")); writeFileSync(f, r.html); rewrites += r.apiRewrites; }
  writeFileSync(join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");
  writeFileSync(join(out, "_headers"), "/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Referrer-Policy: same-origin\n");
  // Safety net: nothing that can write to production may remain.
  const bad = [];
  for (const f of walk(out).filter((f) => /\.(html|js|css|json|txt)$/.test(f))) {
    const t = readFileSync(f, "utf8");
    for (const [name, re] of [["Apps Script URL", /script\.google\.com/], ["events API", /\/api\/events/], ["admin route", /\/admin\//], ["production API const", /NORX_API="https?:/]]) if (re.test(t)) bad.push(f.replace(out, "") + ": " + name);
  }
  if (bad.length) throw new Error("staging build contains production references:\n" + bad.join("\n"));
  return { rewrites, files: walk(out).length };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log("staging storefront built:", build());
