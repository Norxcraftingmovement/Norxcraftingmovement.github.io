import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("../scripts/preflight.mjs", import.meta.url));
function fixture(t) {
  const prefix = join(tmpdir(), "norx-preflight-review-");
  const root = mkdtempSync(prefix);
  t.after(() => {
    if (!resolve(root).startsWith(resolve(prefix))) throw new Error("unsafe cleanup target");
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "scripts")); mkdirSync(join(root, "tests"));
  copyFileSync(script, join(root, "scripts/preflight.mjs"));
  // Keep the CLI integration independent of application data and the full hygiene suite.
  writeFileSync(join(root, "tests/repo-hygiene.test.mjs"), 'import test from "node:test"; test("synthetic hygiene",()=>{});');
  const env = { ...process.env, GIT_CONFIG_COUNT: "4",
    GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: "Synthetic Review",
    GIT_CONFIG_KEY_1: "user.email", GIT_CONFIG_VALUE_1: "review@example.test",
    GIT_CONFIG_KEY_2: "core.autocrlf", GIT_CONFIG_VALUE_2: "false",
    GIT_CONFIG_KEY_3: "commit.gpgsign", GIT_CONFIG_VALUE_3: "false" };
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git("init", "-b", "feature/review"); git("add", "."); git("commit", "-m", "baseline");
  const base = git("rev-parse", "HEAD");
  const run = (...args) => spawnSync(process.execPath, ["scripts/preflight.mjs", ...args], { cwd: root, env, encoding: "utf8" });
  return { root, git, base, run };
}

test("a clean repository with a valid base passes", t => {
  const f = fixture(t), r = f.run("--base", f.base);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /PREFLIGHT OK/);
});

test("invalid or missing explicit base fails closed", t => {
  const f = fixture(t);
  for (const args of [["--base", "does-not-exist"], ["--base"], ["--base", "--full"]]) {
    const r = f.run(...args); assert.equal(r.status, 1); assert.doesNotMatch(r.stdout, /PREFLIGHT OK/);
  }
});

test("no upstream or known fallback requires an explicit base", t => {
  const r = fixture(t).run(); assert.equal(r.status, 1); assert.match(r.stderr, /comparison base/);
});

test("a sensitive value added then removed still blocks publishing its history", t => {
  const f = fixture(t), value = "synthetic".repeat(4);
  writeFileSync(join(f.root, "example.txt"), `token = "${value}"\n`);
  f.git("add", "."); f.git("commit", "-m", "add synthetic value");
  writeFileSync(join(f.root, "example.txt"), "removed\n");
  f.git("add", "."); f.git("commit", "-m", "remove synthetic value");
  const r = f.run("--base", f.base);
  assert.equal(r.status, 1); assert.match(r.stdout, /secretAssignment/);
  assert.ok(!r.stdout.includes(value), "gate must not print the matched value");
});

test("uncommitted sensitive additions still block the gate", t => {
  const f = fixture(t), value = "synthetic".repeat(4);
  writeFileSync(join(f.root, "new.txt"), `token = "${value}"\n`);
  const r = f.run("--base", f.base);
  assert.equal(r.status, 1); assert.match(r.stdout, /secretAssignment/); assert.ok(!r.stdout.includes(value));
});
