// Usage: npx wrangler d1 list --json | node scripts/staging-verify-d1.mjs --id <uuid> [--name norx-orders-staging]
import { verifyD1List } from "./staging-lib.mjs";
const a = process.argv.slice(2), arg = (k) => a[a.indexOf(k) + 1];
let raw = ""; for await (const c of process.stdin) raw += c;
const r = verifyD1List(JSON.parse(raw), { id: arg("--id"), name: arg("--name") || undefined });
if (!r.ok) { console.error("D1 identity check FAILED: " + r.error); process.exit(1); }
console.log("D1 identity ok:", r.name, r.id);
