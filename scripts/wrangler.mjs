// Runs wrangler through `node` directly. On Windows `npx.cmd` mangles quotes/pipes inside SQL arguments ("'C:\Program' is not recognized") and PowerShell blocks npx.ps1.
//   node scripts/wrangler.mjs [--mask] <wrangler arguments…>
// --mask hides uuids, presigned URLs, bearer tokens and 32-hex account ids in what is printed (use it when output may be pasted into chat/Trello; leave it off for
// `--json` output that another script reads). Without it stdio is inherited untouched. Exit code = wrangler's. It adds no approval step and no write guard of its own.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const WANTED = "4.168.0"; // the version every staging step so far was run with

export function maskSecrets(text) {
  return String(text)
    .replace(/https?:\/\/[^\s"')]*X-Amz-[^\s"')]*/g, "<presigned-url>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]{12,}/g, "Bearer <token>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{32}\b/g, "<hex32>");
}

/** The wrangler entry file to run with `node`: $WRANGLER_JS, the repo's node_modules, or the pinned version in the npx cache. null when none is found. */
export function findWrangler(root = process.cwd(), env = process.env) {
  const version = (dir) => { try { return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version; } catch { return null; } };
  const entry = (dir) => join(dir, "bin", "wrangler.js");
  if (env.WRANGLER_JS && existsSync(env.WRANGLER_JS)) return env.WRANGLER_JS;
  const local = join(root, "node_modules", "wrangler"); if (existsSync(entry(local))) return entry(local);
  for (const base of [env.LOCALAPPDATA && join(env.LOCALAPPDATA, "npm-cache", "_npx"), join(homedir(), ".npm", "_npx")].filter(Boolean)) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) { const dir = join(base, d, "node_modules", "wrangler"); if (existsSync(entry(dir)) && version(dir) === WANTED) return entry(dir); }
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), mask = args[0] === "--mask"; if (mask) args.shift();
  const js = findWrangler();
  if (!js) { console.error(`wrangler ${WANTED} not found. Fill the npx cache once with:  npx.cmd --yes wrangler@${WANTED} --version   (or set WRANGLER_JS to wrangler/bin/wrangler.js)`); process.exit(127); }
  const r = spawnSync(process.execPath, [js, ...args], { stdio: mask ? ["inherit", "pipe", "pipe"] : "inherit", encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (mask) { process.stdout.write(maskSecrets(r.stdout || "")); process.stderr.write(maskSecrets(r.stderr || "")); }
  process.exit(r.status ?? 1);
}
