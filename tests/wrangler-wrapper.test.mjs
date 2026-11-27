import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { maskSecrets, findWrangler, WANTED } from "../scripts/wrangler.mjs";
// scripts/wrangler.mjs exists because npx.cmd mangles SQL arguments on Windows; masking exists because wrangler prints database ids and presigned URLs.
const root = fileURLToPath(new URL("../", import.meta.url));
const uuid = ["19220102", "8afe", "48d3", "8c41", "48cd7975f2df"].join("-");

test("maskSecrets hides uuids, presigned URLs, bearer tokens and 32-hex ids but keeps the rest", () => {
  const out = maskSecrets(`db ${uuid} (${"a1".repeat(16)}) see https://h.example/f.sql?X-Amz-Expires=3600&X-Amz-Signature=abc123 Authorization: Bearer abcdefghijklmnop done`);
  assert.equal(out, "db <uuid> (<hex32>) see <presigned-url> Authorization: Bearer <token> done");
  assert.equal(maskSecrets("Total queries executed: 88"), "Total queries executed: 88");
});

test("findWrangler honours WRANGLER_JS first", () => {
  assert.equal(findWrangler(root, { WRANGLER_JS: fileURLToPath(import.meta.url) }), fileURLToPath(import.meta.url));
});

test("runs the pinned wrangler through node when it is installed (skipped otherwise)", (t) => {
  if (!findWrangler(root)) return t.skip("wrangler " + WANTED + " not in the npx cache on this machine");
  const r = spawnSync(process.execPath, ["scripts/wrangler.mjs", "--version"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, new RegExp(WANTED.replace(/\./g, "\\.")));
});

test("without a wrangler it fails with an instruction instead of a stack trace", () => {
  const r = spawnSync(process.execPath, ["scripts/wrangler.mjs", "--version"], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, HOME: "/nonexistent", USERPROFILE: "/nonexistent", LOCALAPPDATA: "/nonexistent", WRANGLER_JS: "" } });
  if (r.status === 0) return; // a repo-local node_modules/wrangler exists: nothing to assert
  assert.equal(r.status, 127); assert.match(r.stderr, /not found/);
});
