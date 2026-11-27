import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// scripts/session-stats.mjs is the yardstick for the workflow review. Its first version counted every repeated log line and overstated turns and tool calls ~3x,
// so the de-duplication is pinned here with a tiny synthetic log (no real session content).
const script = fileURLToPath(new URL("../scripts/session-stats.mjs", import.meta.url));
const t = (s) => `2026-11-28T00:00:${String(s).padStart(2, "0")}.000Z`;
const asst = (id, s, content, usage) => ({ type: "assistant", timestamp: t(s), message: { role: "assistant", id, content, usage } });
const use = (id, name) => ({ type: "tool_use", id, name, input: {} });

test("turns = unique assistant message ids, tool calls = unique tool_use ids, repeated lines change nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "norx-stats-")); mkdirSync(join(home, ".claude", "projects", "proj"), { recursive: true });
  try {
    const u1 = { type: "user", uuid: "u1", timestamp: t(0), message: { role: "user", content: "hello" } };
    const a1 = asst("m1", 1, [use("t1", "Bash")], { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 5 });
    const a1b = asst("m1", 1, [use("t2", "mcp__ccd_turn__update_plan")], { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 20 }); // same API message, second content block
    const r1 = { type: "user", uuid: "u2", timestamp: t(2), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "x" }] } };
    const a2 = asst("m2", 3, [use("t3", "mcp__ccd_turn__update_plan")], { input_tokens: 10, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0, output_tokens: 7 });
    const noise = { type: "api-request-blob", message: a1.message }; // replayed copy without a timestamp
    const lines = [u1, a1, a1b, a1, noise, r1, r1, a2, a2].map((o) => JSON.stringify(o)).join("\n");
    writeFileSync(join(home, ".claude", "projects", "proj", "s.jsonl"), lines);
    const r = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });
    assert.equal(r.status, 0, r.stderr); const o = JSON.parse(r.stdout.trim());
    assert.equal(o.turns, 2); assert.equal(o.toolCalls, 3); assert.equal(o.toolErrors, 1); assert.equal(o.ownerPrompts, 1);
    assert.equal(o.avgContextTokens, 2000, "(1000 + 3000) / 2 turns"); assert.equal(o.outputTokens, 27, "largest output per message id: 20 + 7");
    assert.equal(o.updatePlanCalls, 2); assert.equal(o.updatePlanTurnsAlone, 1, "m1 also ran Bash, m2 ran update_plan alone");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
