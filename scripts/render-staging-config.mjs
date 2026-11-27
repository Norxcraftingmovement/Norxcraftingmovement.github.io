// Usage: NORX_STAGING_D1_ID=… NORX_STAGING_RATELIMIT_NS=… NORX_STAGING_ACCESS_AUD=… NORX_OWNER_EMAIL=… NORX_NOTIFY_FROM=… node scripts/render-staging-config.mjs
// Writes .staging/*.jsonc (git-ignored), .staging/seed.guarded.sql and .staging/deploy.sh. Executes nothing against Cloudflare.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { renderStaging, deploymentCommands } from "./staging-lib.mjs";
import { guardSql } from "../src/env-guard-sql.mjs";
const env = process.env, inputs = { d1Id: env.NORX_STAGING_D1_ID, rateLimitNs: env.NORX_STAGING_RATELIMIT_NS, accessAud: env.NORX_STAGING_ACCESS_AUD, ownerEmail: env.NORX_OWNER_EMAIL, notifyFrom: env.NORX_NOTIFY_FROM };
const root = new URL("../", import.meta.url), out = new URL(".staging/", root);
try {
  const configs = renderStaging(inputs, root); mkdirSync(out, { recursive: true });
  for (const [f, c] of Object.entries(configs)) writeFileSync(new URL(f, out), JSON.stringify(c, null, 2) + "\n");
  writeFileSync(new URL("seed.guarded.sql", out), guardSql("staging") + "\n" + readFileSync(new URL("seeds/orders-staging-synthetic.sql", root), "utf8"));
  writeFileSync(new URL("deploy.sh", out), deploymentCommands());
  console.log("rendered", Object.keys(configs).join(", "), "→ .staging/ (nothing was deployed)");
} catch (e) { console.error(e.message); process.exit(1); }
