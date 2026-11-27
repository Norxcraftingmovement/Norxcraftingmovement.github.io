// Anonymise a PRIVATE V1 orders export (CSV from the "ติดตามออเดอร์" sheet) so it can be used on staging / in fixtures.
// Usage: node scripts/anonymize-v1-export.mjs private/orders.csv private/orders.anon.csv
// Names, phones, addresses, notes and editor e-mails are replaced; ids, statuses, money, items, dates and rounds are kept.
// Output stays under /private/ (git-ignored) unless you deliberately move it. Review it before sharing.
import { readFileSync, writeFileSync } from "node:fs";
import { anonymizeOrders, readOrdersCsv, ordersToCsv } from "../src/v1-import.mjs";
const [inp, out] = process.argv.slice(2);
if (!inp || !out) { console.error("usage: node scripts/anonymize-v1-export.mjs <in.csv> <out.csv>"); process.exit(2); }
const rows = readOrdersCsv(readFileSync(inp, "utf8")), anon = await anonymizeOrders(rows, process.env.ANON_SALT || "norx-staging");
writeFileSync(out, ordersToCsv(anon)); console.log("anonymised", anon.length, "orders ->", out);
