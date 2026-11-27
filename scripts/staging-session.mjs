// Owner-session helpers for staging integration tests.
// Why not a Service Auth token: Access identity for service tokens has a different shape and is NOT guaranteed to contain an owner
// e-mail, and the Orders Workers (correctly) trust only a verified owner identity. So the first integration run uses the owner's own
// authenticated browser session. The saved session is a credential: it stays in .staging/ (git-ignored), mode 0600, and expires.
//
// Capture (run on the OWNER's computer; opens a visible browser, you sign in through Access once):
//   node scripts/staging-session.mjs capture --base https://staging.norxcraftingmovement.com --out .staging/owner-session.json
import { fileURLToPath } from "node:url";
import { writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Build a Cookie header for `url` from a Playwright storageState (domain, path, secure and expiry are honoured). */
export function cookieHeader(state, url, now = Date.now()) {
  const u = new URL(url), host = u.hostname;
  return (state?.cookies ?? []).filter((c) => {
    const d = c.domain.replace(/^\./, "");
    if (!(host === d || host.endsWith("." + d))) return false;
    if (c.secure && u.protocol !== "https:" && !/^(127\.0\.0\.1|localhost)$/.test(host)) return false;
    if (c.expires && c.expires > 0 && c.expires * 1000 < now) return false;
    return u.pathname.startsWith(c.path || "/");
  }).map((c) => c.name + "=" + c.value).join("; ");
}

export async function capture({ base, out }) {
  const { chromium } = await import("playwright"), b = await chromium.launch({ headless: false }), ctx = await b.newContext(), page = await ctx.newPage();
  await page.goto(base + "/admin/"); console.log("Sign in through Cloudflare Access in the browser window…");
  await page.waitForURL((u) => u.origin === new URL(base).origin && u.pathname.startsWith("/admin"), { timeout: 300000 });
  mkdirSync(dirname(out), { recursive: true }); await ctx.storageState({ path: out }); try { chmodSync(out, 0o600); } catch {}
  await b.close(); console.log("Session saved to", out, "(credential — keep it private; it expires with your Access session)");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), arg = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  if (a[0] !== "capture" || !arg("--base") || !/staging/.test(arg("--base"))) { console.error("usage: node scripts/staging-session.mjs capture --base https://staging… [--out .staging/owner-session.json]"); process.exit(2); }
  await capture({ base: arg("--base"), out: arg("--out", ".staging/owner-session.json") });
}
