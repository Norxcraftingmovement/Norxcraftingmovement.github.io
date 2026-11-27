// Offline pre-flight over the rendered .staging/ configs. Exit code 1 on any problem.
import { readFileSync } from "node:fs";
import { checkRendered, productionIdentifiers } from "./staging-lib.mjs";
const root = new URL("../", import.meta.url), names = ["wrangler.orders.jsonc", "wrangler.orders-public.jsonc", "wrangler.staging-storefront.jsonc"];
const configs = Object.fromEntries(names.map((n) => [n, JSON.parse(readFileSync(new URL(".staging/" + n, root), "utf8"))]));
const d1Id = configs["wrangler.orders.jsonc"].d1_databases[0].database_id, ownerEmail = configs["wrangler.orders-public.jsonc"].send_email?.[0]?.destination_address;
const problems = checkRendered(configs, { d1Id, ownerEmail }, productionIdentifiers(root));
if (problems.length) { console.error("PRE-FLIGHT FAILED:\n - " + problems.join("\n - ")); process.exit(1); }
console.log("pre-flight ok: staging-only bindings, no workers.dev/previews, Access vars set, send_email restricted to one address");
