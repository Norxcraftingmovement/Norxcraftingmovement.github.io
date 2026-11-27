// Pre-cutover check that a V1 Apps Script export is the code V2 was verified against.
// Usage: node scripts/v1-verify-source.mjs /path/to/exported-code.txt
// Prints only hashes and pass/fail (never the source). Export the code from the DEPLOYED version in Apps Script
// (Deploy > Manage deployments > the live deployment's version > view code) and run this on that export.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadV1Core, build } from "./gen-v1-golden.mjs";
const path = process.argv[2]; if (!path) { console.error("usage: node scripts/v1-verify-source.mjs <export>"); process.exit(2); }
const src = readFileSync(path, "utf8"), sha = (s) => createHash("sha256").update(s).digest("hex");
const a = src.indexOf("NorxCore=(()=>{"), b = src.indexOf("})();", a) + 5;
console.log("file sha256      :", sha(src));
console.log("NorxCore sha256  :", a >= 0 ? sha(src.slice(a, b)) : "NOT FOUND");
const golden = JSON.parse(readFileSync(new URL("../tests/fixtures/v1-golden.json", import.meta.url), "utf8"));
const got = JSON.parse(JSON.stringify(build(loadV1Core(path))));
let bad = 0;
for (const k of Object.keys(golden.cases)) { const same = JSON.stringify(got.cases[k]) === JSON.stringify(golden.cases[k]); if (!same) bad++; console.log("behaviour", k.padEnd(12), same ? "MATCH" : "DIFFERENT"); }
console.log(bad ? "RESULT: this export behaves DIFFERENTLY from the verified V1 — do not cut over; re-audit." : "RESULT: pure business logic identical to the verified V1.");
console.log("Note: this covers the pure logic (pricing, rounds, validation, summary). Review Apps Script-only code (sheets, admin, triggers) by diff against the version recorded in docs/MIGRATION_PLAN.md.");
process.exit(bad ? 1 : 0);
