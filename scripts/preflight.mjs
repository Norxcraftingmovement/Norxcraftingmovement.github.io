// Pre-push check, replacing the hand-typed greps: where am I, what am I about to push, does any ADDED line look like a secret/PII/real id, is repo hygiene green.
//   node scripts/preflight.mjs [--base <ref>] [--full]
// --full also runs the whole test suite (summary lines only). Exit 1 on any problem. Prints verdicts and file:line only — never the matched text.
// An added line that is a deliberate fake can end with `preflight-allow`.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const RULES = {
  email: /[A-Za-z0-9._%+-]+@(?!example\.(?:test|com)\b)[A-Za-z0-9-]+\.[A-Za-z]{2,}/,
  uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  longHex: /\b[0-9a-f]{32,}\b/i,
  bankLike: /\b(?!000-0-00000-0\b)\d{3}-\d-\d{5}-\d\b/,
  presignedUrl: /X-Amz-(?:Signature|Credential)/,
  appsScriptOrSheet: /AKfycb[\w-]{10,}|spreadsheets\/d\/[\w-]{20,}|script\.google\.com\/macros\/s\/[\w-]{10,}/,
  secretAssignment: /\b(?:api[_-]?key|secret|token|password)\b["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i,
};
const SKIP_FILE = /^(tests\/fixtures\/|src\/generated\/|tests\/repo-hygiene\.test\.mjs$|scripts\/preflight\.mjs$|tests\/preflight\.test\.mjs$|tests\/wrangler-wrapper\.test\.mjs$|scripts\/wrangler\.mjs$)/;

/** [{file, line, rule}] for the added lines of a unified diff produced with -U0 (new files included). */
export function scanDiff(diff) {
  const out = []; let file = null, line = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ ")) { file = l.slice(4).replace(/^b\//, ""); continue; }
    const h = l.match(/^@@ -\S+ \+(\d+)/); if (h) { line = Number(h[1]); continue; }
    if (l.startsWith("+") && !l.startsWith("+++")) {
      if (file && file !== "/dev/null" && !SKIP_FILE.test(file) && !/preflight-allow\s*$/.test(l)) for (const [rule, re] of Object.entries(RULES)) if (re.test(l)) out.push({ file, line, rule });
      line++;
    }
  }
  return out;
}

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).trim(); // git's own "fatal:" noise (no upstream yet) stays out of the output
const tryGit = (...a) => { try { return git(...a); } catch { return ""; } };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), arg = (n) => { const i = args.indexOf("--" + n); return i < 0 ? null : args[i + 1]; };
  const problems = [], branch = git("rev-parse", "--abbrev-ref", "HEAD"), head = git("rev-parse", "--short", "HEAD");
  if (branch === "feature/cloudflare-migration" || branch === "main" || branch === "master") problems.push(`on protected/production branch ${branch} — do not push from here`);
  const upstream = tryGit("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
  const requestedBase = arg("base");
  if (args.includes("--base") && (!requestedBase || requestedBase.startsWith("--"))) {
    console.error("PREFLIGHT FAILED: --base requires an existing commit/ref"); process.exit(1);
  }
  const base = requestedBase || upstream || (tryGit("rev-parse", "--verify", `origin/${branch}`) && `origin/${branch}`) || tryGit("merge-base", "HEAD", "origin/feature/orders-v2");
  const baseSha = base && tryGit("rev-parse", "--verify", "--end-of-options", `${base}^{commit}`);
  if (!baseSha) { console.error("PREFLIGHT FAILED: cannot resolve comparison base; supply --base <existing-ref>"); process.exit(1); }
  // Once a base is selected, Git failures must stop the gate rather than become empty, passing results.
  const [behind, ahead] = git("rev-list", "--left-right", "--count", `${baseSha}...HEAD`).split(/\s+/).map(Number);
  const dirty = git("status", "--porcelain").split("\n").filter(Boolean);
  console.log(`branch ${branch} @ ${head} · base ${base.slice(0, 12)} · ahead ${ahead}, behind ${behind} · uncommitted ${dirty.length}`);
  if (behind > 0) problems.push(`branch is ${behind} commit(s) behind ${base} — a push would need a merge/rebase (never force-push)`);

  // Every outgoing commit is published, including secrets removed by a later commit.
  let diff = git("log", "-m", "--format=", "-p", "-U0", "--no-color", "--no-renames", `${baseSha}..HEAD`) + "\n" + git("diff", "-U0", "--no-color", "--no-renames", "HEAD");
  for (const f of git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)) { const t = readFileSync(f, "utf8"); diff += `\n+++ b/${f}\n@@ -0,0 +1 @@\n` + t.split("\n").map((x) => "+" + x).join("\n"); }
  const hits = scanDiff(diff);
  console.log(hits.length ? `sensitive-value scan: ${hits.length} hit(s)\n` + hits.slice(0, 20).map((h) => `  ${h.file}:${h.line} ${h.rule}`).join("\n") : "sensitive-value scan: 0 hits in added lines");
  if (hits.length) problems.push("added lines look like secrets/PII/real ids (see file:line above; add `preflight-allow` at the end of a line only for a deliberate fake)");

  const hyg = spawnSync(process.execPath, ["--test", "tests/repo-hygiene.test.mjs"], { encoding: "utf8" });
  console.log("repo hygiene: " + (hyg.status === 0 ? "pass" : "FAIL")); if (hyg.status !== 0) problems.push("tests/repo-hygiene.test.mjs failed");
  if (args.includes("--full")) {
    const t = spawnSync(process.execPath, ["--test"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const sum = (t.stdout + t.stderr).split("\n").filter((l) => /^ℹ (tests|pass|fail|skipped)\b/.test(l)).join(" · ");
    console.log("full suite: " + (sum || "no summary") + (t.status === 0 ? "" : " — FAIL")); if (t.status !== 0) problems.push("test suite failed");
  }
  console.log(problems.length ? "PREFLIGHT FAILED:\n - " + problems.join("\n - ") : "PREFLIGHT OK");
  process.exit(problems.length ? 1 : 0);
}
