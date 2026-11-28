# NORX Website (Orders V2) — rules for AI sessions
The owner speaks Thai and is not a coder: answer in plain Thai. Code and docs may be English.

## Session start — one checklist for every AI
1. Read this file and `STATE.md` only; verify `git status`, `git log -1`, `git fetch origin` and compare the intended branch/remote. Check applicable open PRs and the Trello status header/latest comment only. Git, approved decisions and code win over stale notes.
2. Report in at most 5 plain-Thai lines: branch/HEAD, sync, verified/unverified, next action, approvals. If the owner only says "ต่อ", report and wait for direction. If an explicit task is already authorized and no conflict/approval gate applies, proceed without asking again.
3. Missing rules, behind/diverged checkout, conflicting work/PR or unavailable remote: warn first and stop writing until resolved. A known unrelated PR is not a reason to restart the whole project.
4. One writer per task/scope. Claim scope in the status header before editing; use one task branch/PR. No parallel edits to overlapping files; Trello is coordination, not a guaranteed atomic lock. Release only after a durable checkpoint or clearly report unsynced work.

## Boundaries (owner-approved, unchanged)
- Work on `feature/orders-v2`; single writer. Never touch `feature/cloudflare-migration`, never force-push, never merge into production.
- Staging + synthetic/masked data only until the owner approves cutover. No Production, V1 (Apps Script/Sheet), Events, Media, real DNS, Billing, production Access.
- Every Cloudflare write (deploy, migration, D1 write, route, DNS, Access, Email) needs the owner's yes in chat for that action. Approval already given for a scope is not asked again inside that scope.
- No secrets, PII, real ids, owner e-mail or bank numbers in repo, Trello or chat. V1 source is never committed. Private data lives only in git-ignored `private/` and `.staging/`.
- Before every push: `node scripts/preflight.mjs` (add `--full` for the whole suite). Keep Security Gate, independent QA, approval boundary and rollback plan exactly as documented.

## Tiers — choose by trigger, not by feeling
- **FAST**: docs, comments, tests, read-only investigation. Run only affected tests. No Trello write until the end; one short summary.
- **STANDARD**: code on the branch, not deployed. Filtered tests while working, full suite once before push, preflight, one short Trello comment per milestone (≤10 lines + commit link).
- **CRITICAL**: anything that writes staging/production/Cloudflare/DNS/Access/Email/D1, touches V1 or the Sheets, money/QR/PII, migrations, deploys. Full process: identity check, backup, guard, per-command approval, post-check, independent retest, rollback note, Trello + GitHub evidence.
- UI/UX changes are at least STANDARD and need visual + functional QA (look at the real pages and flows). Console-error checks are an extra, never a substitute.
- Label results "developer-reported" or "independent retest".

## Owner direction (2026-11-27)
- Carry authorized routine fixes, tests and merges into development branches through without asking at every step. Ask for decisions with material risk to availability, real data, security, cost or how the owner uses the app. Do not infer production/cutover authorization from routine development approval.
- Keep the Cloudflare scope approval boundary above; do not ask again for steps already authorized inside that scope.
- The owner assigned Codex to work solo while Claude is rate-limited. For this workflow fix, do a separate self-review and label it "solo self-review", not "independent QA"; do not block on Claude. Other go-live gates remain in place.
- Explain outcomes, impact and next actions in plain Thai for a non-coder. Update Trello for material milestones and changed decisions, linking GitHub evidence.

## Checkpoint and reporting — once, not everywhere
GitHub = technical truth and test evidence; Trello = owner-facing status (writer, current task, last result, next action, approval, links). Read only the status header and latest comment. Keep detailed evidence in its existing canonical document/PR; do not duplicate it into HANDOVER, GO_LIVE, TEST_REPORT and Trello. HANDOVER is history: grep relevant sections.
At each meaningful safe milestone, before switching tools/machines or nearing the usage cap: commit/push the authorized task branch after preflight; replace the short `STATE.md` summary with status, evidence links, next action and remaining gates. Use a WIP checkpoint when appropriate, never force-push or expose secrets. If push fails, report that local work is NOT recoverable from GitHub; do not claim a handoff. Update the Trello header and one ≤10-line milestone comment, then release the writer after a verified checkpoint. No need to paste conversation history.

## Windows tooling facts
- Run wrangler as `node scripts/wrangler.mjs …` (`npx.cmd` mangles SQL/quotes; PowerShell blocks `npx.ps1`). `--mask` hides uuids and presigned URLs when output will be shown.
- Stale `.wrangler/cache/wrangler-account.json` gives error 10000 after an account switch: delete it. `wrangler login` is done by the owner in their own browser.
- System `core.autocrlf=true`: use `-c core.autocrlf=false` for byte-exact tests and commits. Do not use `python3 -` heredocs (they hang); use the Edit/Write tools.
- After any Admin deploy open every Admin page and look at it (console and visuals): an inline `//` comment inside a one-line `admin-ui` statement once shipped a SyntaxError.

## Context and resource discipline
- One objective per session. Read relevant files/ranges/diffs, not raw histories; reuse verified facts and batch independent checks. Return counts/verdicts rather than raw logs. Scripts first; browser for visual/functional UI or inbox evidence.
- Use the simplest sufficient skill, model and tool. One AI by default; use Codex plugin/delegation or independent reviewers only when they materially reduce risk/time, including mandatory critical gates. No parallel writers. Do not repeat a passing check without changed input/new evidence.
- Watch context pressure and usage limits; checkpoint before compacting or switching, and use a new session for a new objective. No model-independent token cutoff. When limits hit, use the other authorized tool only after handoff; if both are unavailable, stop safely. No automatic billing, quota bypass or installation.
- Choose FAST/STANDARD/CRITICAL by existing triggers, not by the amount of documentation. All security, quality, rollback and approval boundaries above remain unchanged.
