import test from "node:test";
import assert from "node:assert/strict";
import { scanDiff, RULES } from "../scripts/preflight.mjs";
// The pre-push scan replaces hand-typed greps. Every "bad" sample below is assembled from pieces so this file itself holds nothing that looks real.
const diffOf = (file, ...added) => `+++ b/${file}\n@@ -0,0 +1,${added.length} @@\n` + added.map((l) => "+" + l).join("\n");
const mail = ["someone", "@", "gmail", ".com"].join(""), uuid = ["19220102", "8afe", "48d3", "8c41", "48cd7975f2df"].join("-"), bank = ["147", "3", "27057", "5"].join("-");

test("flags e-mail, uuid, bank-like number, long hex, presigned URL and Apps Script ids on added lines, with file:line and no text", () => {
  const hits = scanDiff(diffOf("docs/x.md", "ok line", "owner " + mail, "id " + uuid, "acct " + bank, "h " + "a".repeat(40), "u https://h.example/x?X-Amz-Signature=abc", "s AKfycb" + "x".repeat(20)));
  assert.deepEqual(hits.map((h) => h.rule + "@" + h.line), ["email@2", "uuid@3", "bankLike@4", "longHex@5", "presignedUrl@6", "appsScriptOrSheet@7"]);
  assert.ok(hits.every((h) => h.file === "docs/x.md" && Object.keys(h).join() === "file,line,rule"));
});

test("clean lines, fake values, allow-marker, skipped files and removed lines are not flagged", () => {
  assert.deepEqual(scanDiff(diffOf("docs/x.md", "just text", "owner@example.test", "acct 000-0-00000-0", "short hash a9f9b78a", "id " + uuid + " preflight-allow")), []);
  assert.deepEqual(scanDiff(diffOf("tests/fixtures/v1-anonymized/a.csv", mail)), []);
  assert.deepEqual(scanDiff(`+++ b/docs/x.md\n@@ -1 +0,0 @@\n-removed ${mail}`), [], "only added lines count");
});

test("line numbers follow the hunk header", () => {
  const d = "+++ b/a.md\n@@ -10,0 +21,2 @@\n+fine\n+" + mail;
  assert.deepEqual(scanDiff(d), [{ file: "a.md", line: 22, rule: "email" }]);
});

test("every rule has a pattern", () => { assert.ok(Object.values(RULES).every((r) => r instanceof RegExp)); });
