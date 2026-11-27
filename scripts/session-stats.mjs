// Before/after numbers for the workflow review, from Claude Code session logs (~/.claude/projects/*/*.jsonl). Aggregates only — no message text is printed.
//   node scripts/session-stats.mjs [part-of-project-folder-name] [--since 2026-11-28]
// The logs repeat lines (one line per content block, request blobs, replays after a compaction), so everything is de-duplicated: a TURN is one assistant API message id,
// a TOOL CALL is one tool_use id, an ERROR is one failed tool_result. Cache-read tokens ÷ turns = the context carried on an average turn.
// Compare sessions of similar complexity (one milestone each), not whole-day totals.
import { createReadStream, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2), since = args.includes("--since") ? Date.parse(args[args.indexOf("--since") + 1]) : 0;
const part = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--since") || "";
const base = join(homedir(), ".claude", "projects"), short = (n) => n.replace(/^mcp__[0-9a-f-]+__/, "mcp:");
const num = (v) => Number(v) || 0;
for (const proj of readdirSync(base).filter((p) => p.includes(part))) for (const f of readdirSync(join(base, proj)).filter((x) => x.endsWith(".jsonl"))) {
  const turns = new Map(), calls = new Map(), errors = new Set(), prompts = new Set(); let first = null, last = null, prev = null, idle = 0, compactions = 0;
  for await (const line of createInterface({ input: createReadStream(join(base, proj, f)), crlfDelay: Infinity })) {
    let o; try { o = JSON.parse(line); } catch { continue; } const m = o.message, ts = Date.parse(o.timestamp); if (!m || !ts || ts < since) continue;
    first ??= ts; last = ts; const c = Array.isArray(m.content) ? m.content : [];
    if (m.role === "assistant" && m.id) {
      const u = m.usage || {}, t = turns.get(m.id) || { cacheRead: 0, ctx: 0, out: 0, tools: new Set() };
      t.cacheRead = Math.max(t.cacheRead, num(u.cache_read_input_tokens)); t.out = Math.max(t.out, num(u.output_tokens));
      t.ctx = Math.max(t.ctx, num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens));
      for (const x of c) if (x.type === "tool_use") { t.tools.add(x.id); calls.set(x.id, x.name); }
      turns.set(m.id, t);
    } else if (m.role === "user") {
      const results = c.filter((x) => x.type === "tool_result");
      for (const x of results) if (x.is_error) errors.add(x.tool_use_id);
      const key = o.uuid || line.length + ":" + ts;
      if (!results.length && !prompts.has(key)) { prompts.add(key); if (prev && (ts - prev) / 1000 > 120) idle += (ts - prev) / 1000; }
      if (typeof m.content === "string" && /^This session is being continued/.test(m.content)) compactions++;
    }
    prev = ts;
  }
  if (!turns.size) continue;
  const T = [...turns.values()], by = {}; for (const n of calls.values()) by[short(n)] = (by[short(n)] || 0) + 1;
  const plan = T.filter((t) => [...t.tools].some((id) => /update_plan$/.test(calls.get(id) || ""))), trello = [...calls.values()].filter((n) => /trello(Write|Read)Card$/.test(n)).length;
  console.log(JSON.stringify({ project: proj.slice(-40), session: f.slice(0, 8), wallHours: +((last - first) / 36e5).toFixed(1), ownerIdleHours: +(idle / 3600).toFixed(1), ownerPrompts: prompts.size,
    turns: T.length, toolCalls: calls.size, toolErrors: errors.size, avgContextTokens: Math.round(T.reduce((a, t) => a + t.cacheRead, 0) / T.length), peakContextTokens: Math.max(...T.map((t) => t.ctx)),
    outputTokens: T.reduce((a, t) => a + t.out, 0), compactions, trelloCalls: trello, updatePlanCalls: [...calls.values()].filter((n) => /update_plan$/.test(n)).length, updatePlanTurnsAlone: plan.filter((t) => t.tools.size === 1).length,
    topTools: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + "=" + v).join(", ") }));
}
