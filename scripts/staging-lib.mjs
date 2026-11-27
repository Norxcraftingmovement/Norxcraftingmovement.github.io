// Staging deployment preparation (pure functions; nothing here talks to Cloudflare).
// Committed wrangler files hold PLACEHOLDERS only. Real ids / addresses are supplied through environment variables when
// rendering into .staging/ (git-ignored), so no account id, Access audience or personal address is ever committed.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
export const STAGING_HOST = "staging.norxcraftingmovement.com", STAGING_DB = "norx-orders-staging";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const read = (root, f) => JSON.parse(readFileSync(new URL(f, root), "utf8"));
/** The exact file the runbook executes for seeding: environment guard + the synthetic seed (idempotent: every INSERT is OR IGNORE). */
import { guardSql } from "../src/env-guard-sql.mjs";
export const seedSql = (root) => guardSql("staging") + "\n" + readFileSync(new URL("seeds/orders-staging-synthetic.sql", root), "utf8");
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** Identifiers that must never appear in a staging config: every production D1/R2/rate-limit id in the committed configs. */
export function productionIdentifiers(root) {
  const ids = new Set();
  for (const f of ["wrangler.jsonc", "wrangler.admin.jsonc"]) { const c = read(root, f); for (const d of c.d1_databases ?? []) { ids.add(d.database_id); ids.add(d.database_name); } for (const r of c.ratelimits ?? []) ids.add(String(r.namespace_id)); for (const b of c.r2_buckets ?? []) ids.add(b.bucket_name); }
  return ids;
}
export function validateInputs(i, prodIds) {
  const e = [];
  if (!UUID.test(i.d1Id ?? "")) e.push("NORX_STAGING_D1_ID must be a D1 database UUID");
  if (prodIds.has(i.d1Id)) e.push("NORX_STAGING_D1_ID equals a production database id");
  if (!/^\d{6,12}$/.test(i.rateLimitNs ?? "")) e.push("NORX_STAGING_RATELIMIT_NS must be a numeric namespace id");
  if (prodIds.has(String(i.rateLimitNs))) e.push("NORX_STAGING_RATELIMIT_NS equals a production rate-limit namespace");
  if (!/^[a-f0-9]{64}$/.test(i.accessAud ?? "")) e.push("NORX_STAGING_ACCESS_AUD must be the 64-hex Access application audience tag");
  if (!EMAIL.test(i.ownerEmail ?? "")) e.push("NORX_OWNER_EMAIL must be the verified owner address");
  if (!EMAIL.test(i.notifyFrom ?? "")) e.push("NORX_NOTIFY_FROM must be a sender address on an onboarded sending domain");
  return e;
}
const flatten = (c, name, base) => {
  const s = c.env[name], out = { name: s.name, main: "../" + c.main, compatibility_date: c.compatibility_date, workers_dev: false, preview_urls: false };
  for (const k of Object.keys(s)) if (!["name", "workers_dev", "preview_urls"].includes(k)) out[k] = JSON.parse(JSON.stringify(s[k]));
  for (const d of out.d1_databases ?? []) if (d.migrations_dir) d.migrations_dir = "../" + d.migrations_dir;
  return out;
};
/** Render the three staging configs as FLAT, single-environment files (the deployed config contains no production section at all). */
export function renderStaging(inputs, root = new URL("../", import.meta.url)) {
  const errors = validateInputs(inputs, productionIdentifiers(root));
  if (errors.length) { const e = new Error("invalid staging inputs:\n - " + errors.join("\n - ")); e.errors = errors; throw e; }
  const hash = sha256(inputs.ownerEmail.toLowerCase());
  const sub = (obj) => JSON.parse(JSON.stringify(obj)
    .replaceAll("REPLACE_WITH_STAGING_DB_ID", inputs.d1Id).replaceAll("REPLACE_STAGING_RATELIMIT_NS", inputs.rateLimitNs).replaceAll("REPLACE_WITH_STAGING_ACCESS_AUD", inputs.accessAud)
    .replaceAll("REPLACE_WITH_SHA256_OF_OWNER_EMAIL", hash).replaceAll("REPLACE_WITH_VERIFIED_OWNER_ADDRESS", inputs.ownerEmail).replaceAll("REPLACE_WITH_SENDER_ADDRESS", inputs.notifyFrom));
  const admin = sub(flatten(read(root, "wrangler.orders.jsonc"), "staging")), pub = sub(flatten(read(root, "wrangler.orders-public.jsonc"), "staging"));
  const store = { ...read(root, "wrangler.staging-storefront.jsonc"), assets: { ...read(root, "wrangler.staging-storefront.jsonc").assets, directory: "../dist-staging" } };
  const configs = { "wrangler.orders.jsonc": admin, "wrangler.orders-public.jsonc": pub, "wrangler.staging-storefront.jsonc": store };
  const problems = checkRendered(configs, { d1Id: inputs.d1Id, ownerEmail: inputs.ownerEmail }, productionIdentifiers(root));
  if (problems.length) throw new Error("rendered staging config failed pre-flight:\n - " + problems.join("\n - "));
  return configs;
}

/** Offline pre-flight over rendered configs. Returns problems (empty = ok). */
export function checkRendered(configs, expect, prodIds) {
  const p = [], text = JSON.stringify(configs);
  if (/REPLACE_/.test(text)) p.push("unreplaced placeholder left in config");
  for (const id of prodIds) if (id && text.includes(String(id)) && !String(id).startsWith("norx-orders-staging")) p.push("production identifier present: " + id);
  if (/norx-events|norx-event-media|EVENTS_DB|MEDIA_BUCKET|r2_buckets|script\.google\.com/.test(text)) p.push("Events/Media/R2/Apps Script reference present");
  for (const [f, c] of Object.entries(configs)) {
    if (c.workers_dev !== false) p.push(f + ": workers_dev must be false");
    if (c.preview_urls !== false) p.push(f + ": preview_urls must be false");
    if ("routes" in c || "route" in c) p.push(f + ": routes must be configured by the owner in the dashboard, not here");
    if ("env" in c) p.push(f + ": rendered config must be flat (no env sections)");
    if (!/^norx-.*staging/.test(c.name)) p.push(f + ": worker name must be a staging name");
  }
  for (const f of ["wrangler.orders.jsonc", "wrangler.orders-public.jsonc"]) {
    const c = configs[f]; if (!c) continue;
    const d = c.d1_databases ?? []; if (d.length !== 1 || d[0].binding !== "ORDERS_DB" || d[0].database_name !== STAGING_DB || d[0].database_id !== expect.d1Id) p.push(f + ": D1 binding must be ORDERS_DB → " + STAGING_DB + " with the verified id");
    if (c.vars?.ENVIRONMENT !== "staging" || c.vars?.ORDERS_DB_LABEL !== "staging") p.push(f + ": ENVIRONMENT/ORDERS_DB_LABEL must be 'staging'");
    if (!/^[a-f0-9]{64}$/.test(c.vars?.MEDIA_ADMIN_EMAIL_HASH ?? "") || !/^[a-f0-9]{64}$/.test(c.vars?.MEDIA_ACCESS_AUD ?? "")) p.push(f + ": Access audience / owner hash not configured");
  }
  const a = configs["wrangler.orders.jsonc"]; if (a && a.vars?.ORDERS_ALLOWED_ORIGIN !== "https://" + STAGING_HOST) p.push("admin: ORDERS_ALLOWED_ORIGIN must be the staging host");
  const u = configs["wrangler.orders-public.jsonc"];
  if (u) {
    if (u.vars?.ORDERS_PUBLIC_ORIGINS !== "https://" + STAGING_HOST) p.push("public: ORDERS_PUBLIC_ORIGINS must be only the staging host");
    if (u.vars?.STAGING_REQUIRE_ACCESS !== "1") p.push("public: STAGING_REQUIRE_ACCESS must be '1'");
    if (!(u.ratelimits?.length === 1 && u.ratelimits[0].name === "ORDERS_LIMITER")) p.push("public: dedicated ORDERS_LIMITER rate-limit binding required");
    const se = u.send_email ?? []; if (se.length !== 1 || se[0].name !== "EMAIL" || se[0].destination_address !== expect.ownerEmail || "allowed_destination_addresses" in se[0]) p.push("public: send_email binding must be restricted to the single verified owner address");
    if (!(u.triggers?.crons?.length === 1)) p.push("public: one notification cron expected");
  }
  const s = configs["wrangler.staging-storefront.jsonc"]; if (s && !(Object.keys(s).every((k) => ["name", "compatibility_date", "workers_dev", "preview_urls", "assets"].includes(k)))) p.push("storefront: assets-only config expected");
  return p;
}

/** Parse `wrangler d1 list --json` output and confirm the staging database identity (name AND id). */
export function verifyD1List(json, { id, name = STAGING_DB }) {
  const list = Array.isArray(json) ? json : json?.result ?? [], hit = list.filter((d) => d.name === name || d.uuid === id || d.database_id === id);
  if (hit.length !== 1) return { ok: false, error: `expected exactly one database matching ${name}/${id}, found ${hit.length}` };
  const d = hit[0], gotId = d.uuid ?? d.database_id ?? d.id;
  if (d.name !== name) return { ok: false, error: `id ${id} belongs to database '${d.name}', not '${name}'` };
  if (gotId !== id) return { ok: false, error: `database '${name}' has id ${gotId}, expected ${id}` };
  return { ok: true, id: gotId, name: d.name };
}

/** The exact, ordered sequence. Every remote D1 operation carries --remote and a -c config that binds only the staging database.
 *  ORDER MATTERS: the Access application exists before anything is reachable; Workers are deployed WITHOUT routes (workers.dev and
 *  previews are off, so they are unreachable); the DNS record and routes come last; the gate must pass before any test or sharing. */
export function deploymentCommands() {
  const C = ".staging", D = STAGING_DB;
  return `#!/usr/bin/env bash
# NORX Orders V2 — STAGING deployment sequence (generated; review before running; needs owner approval).
# Nothing here deletes anything. Production, Events, Media and Orders V1 are not referenced.
set -euo pipefail
: "\${NORX_STAGING_D1_ID:?}" "\${NORX_STAGING_RATELIMIT_NS:?}" "\${NORX_STAGING_ACCESS_AUD:?}" "\${NORX_OWNER_EMAIL:?}" "\${NORX_NOTIFY_FROM:?}"

# 0. render configs (flat, staging-only) + offline pre-flight + guarded SQL files
node scripts/render-staging-config.mjs
node scripts/staging-preflight.mjs

# 1. verify the exact database identity (read-only): name AND id must match
npx wrangler d1 list --json | node scripts/staging-verify-d1.mjs --id "$NORX_STAGING_D1_ID" --name ${D}

# 2. schema (first write; only reachable after step 1 passed)
npx wrangler d1 migrations apply ${D} --remote -c ${C}/wrangler.orders.jsonc

# 3. environment marker, then verify it reads back as 'staging'
npx wrangler d1 execute ${D} --remote -c ${C}/wrangler.orders.jsonc --command "INSERT INTO meta(key,value) VALUES ('environment','staging') ON CONFLICT(key) DO NOTHING"
npx wrangler d1 execute ${D} --remote -c ${C}/wrangler.orders.jsonc --command "SELECT value FROM meta WHERE key='environment'" --json | grep -q '"value": "staging"'

# 4. synthetic seed (file starts with the environment guard; every INSERT is OR IGNORE, so it can be repeated)
npx wrangler d1 execute ${D} --remote -c ${C}/wrangler.orders.jsonc --file ${C}/seed.guarded.sql

# 5. build the storefront, dry-run every Worker, then deploy them. NO routes exist yet and workers.dev/previews are off:
#    the Workers are unreachable until step 7.
node scripts/build-staging-storefront.mjs
for c in orders orders-public staging-storefront; do npx wrangler deploy --dry-run -c ${C}/wrangler.$c.jsonc; done
npx wrangler deploy -c ${C}/wrangler.orders.jsonc
npx wrangler deploy -c ${C}/wrangler.orders-public.jsonc
npx wrangler deploy -c ${C}/wrangler.staging-storefront.jsonc

# 6. OWNER (dashboard) — Cloudflare Access is applied BEFORE the hostname exists: the self-hosted application for ${STAGING_HOST}
#    (whole hostname, no path) was created in the prerequisites (its AUD is needed by step 0). Re-check now: ONE policy, Allow, owner
#    e-mail only; no service-token, bypass, everyone or "public" policy; its AUD equals NORX_STAGING_ACCESS_AUD.
# 7. OWNER (dashboard) — only now make the hostname reachable: add the DNS record for "staging" ONLY (no other record changes) and the 3 routes:
#      ${STAGING_HOST}/api/orders*  -> norx-orders-public-staging
#      ${STAGING_HOST}/api/admin/*  and  ${STAGING_HOST}/admin*  -> norx-orders-staging
#      ${STAGING_HOST}/*            -> norx-staging-storefront
# 8. GATE — must pass before ANY other test or before the URL is shared. If it fails: remove the three routes (nothing else), fix, re-run.
node scripts/staging-gate.mjs --base https://${STAGING_HOST}

# 9. integration tests with the OWNER's authenticated session (see scripts/staging-session.mjs; run the capture on the owner's computer)
#    node scripts/staging-session.mjs capture --base https://${STAGING_HOST} --out ${C}/owner-session.json
#    node scripts/staging-smoke.mjs --base https://${STAGING_HOST} --session ${C}/owner-session.json --orders 30
#    node scripts/staging-smoke.mjs --base https://${STAGING_HOST} --session ${C}/owner-session.json --orders 0 --rate-limit-test   # rate limiting, separately
#    node scripts/staging-ui-check.mjs --base https://${STAGING_HOST} --session ${C}/owner-session.json
`;
}

