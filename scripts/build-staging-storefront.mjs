// Builds a STANDALONE staging copy of the storefront into dist-staging/ (never published by the production build).
// - checkout/config API is rewritten to the same-origin staging orders API (/api/orders)
// - the production Apps Script URL, Events and Admin pages are NOT included
// - noindex everywhere, a visible STAGING banner, no-store headers
// - the static payment QR of the REAL receiving account (assets/qr.jpg) is neither shipped nor shown: staging
//   must never offer a way to pay real money (only the per-order PromptPay QR from staging settings may appear)
// The build FAILS if anything that could reach production remains in the output.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, extname, basename } from "node:path";
import { writeProductLookbookAssets } from "./product-theme-sources.mjs";
const root = fileURLToPath(new URL("../", import.meta.url)), defaultOut = join(root, "dist-staging");
export const STAGING_ORIGIN = "https://staging.norxcraftingmovement.com";
const include = ["index.html", "shop.js", "assets", "cart", "home-terrain", "woven-stride", "community", "pay"]; // no events/, no admin/
const banner = '<div role="status" style="position:sticky;top:0;z-index:99999;background:#b04922;color:#fff;font:700 14px/1.4 system-ui,sans-serif;padding:8px 12px;text-align:center">STAGING · ระบบทดสอบ ข้อมูลสมมติเท่านั้น — ห้ามโอนเงินจริง</div>';
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const REAL_QR_FILE = "qr.jpg"; // static QR of the real receiving account; production only
export const STAGING_QR_NOTICE = '<p class="qr-label" data-staging="qr-removed">STAGING · ไม่มี QR บัญชีรับเงินจริงในระบบทดสอบ — ห้ามโอนเงิน</p>';

export function transformHtml(html) {
  let n = 0, q = 0;
  html = html.replace(/window\.NORX_API="https:\/\/script\.google\.com\/[^"]*"/g, () => (n++, 'window.NORX_API="/api/orders"'));
  html = html.replaceAll("https://norxcraftingmovement.com", STAGING_ORIGIN);
  // Static QR block (label + image + save hint) → staging notice. Keeps class "qr-label" so pay-panel.js still hides it
  // when the per-order PromptPay QR is available. Any other <img> of the real QR is dropped as well.
  html = html.replace(/<p class="qr-label">[^<]*<\/p>\s*<img\b[^>]*\bclass="qr"[^>]*>\s*<p class="small qr-hint">[\s\S]*?<\/p>/g, () => (q++, STAGING_QR_NOTICE));
  html = html.replace(/<img\b[^>]*\bsrc="[^"]*\bqr\.jpg"[^>]*>/g, () => (q++, ""));
  html = html.replace(/<head>/i, '<head><meta name="robots" content="noindex,nofollow">').replace(/(<body[^>]*>)/i, "$1" + banner);
  return { html, apiRewrites: n, qrRemoved: q };
}
export function build(out = defaultOut) {
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const realQr = join(root, "assets", REAL_QR_FILE);
  for (const p of include) cpSync(join(root, p), join(out, p), { recursive: true, filter: (src) => src !== realQr });
  writeProductLookbookAssets(out);
  let rewrites = 0, qrRemoved = 0;
  for (const f of walk(out).filter((f) => extname(f) === ".html")) { const r = transformHtml(readFileSync(f, "utf8")); writeFileSync(f, r.html); rewrites += r.apiRewrites; qrRemoved += r.qrRemoved; }
  writeFileSync(join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");
  writeFileSync(join(out, "_headers"), "/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Referrer-Policy: same-origin\n");
  // Safety net: nothing that can write to production may remain.
  const bad = [];
  for (const f of walk(out)) if (basename(f).toLowerCase() === REAL_QR_FILE) bad.push(f.replace(out, "") + ": real payment QR image");
  for (const f of walk(out).filter((f) => /\.(html|js|css|json|txt)$/.test(f))) {
    const t = readFileSync(f, "utf8");
    for (const [name, re] of [["Apps Script URL", /script\.google\.com/], ["events API", /\/api\/events/], ["admin route", /\/admin\//], ["production API const", /NORX_API="https?:/], ["real payment QR reference", /\bqr\.jpg\b/i], ["static QR image", /<img\b[^>]*\bclass="qr"/]]) if (re.test(t)) bad.push(f.replace(out, "") + ": " + name);
  }
  if (bad.length) throw new Error("staging build contains production references:\n" + bad.join("\n"));
  return { rewrites, qrRemoved, files: walk(out).length };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log("staging storefront built:", build());
