# NORX Website (Orders V2) — rules for AI sessions
The owner speaks Thai and is not a coder: answer in plain Thai. Code and docs may be English.

## Start of a session (nothing more than this)
1. Read `STATE.md` — a start point only, it can be stale. 2. `git log -1`, `git status`; git and the code win over the file.
3. Trello: status card description + latest comment only (`list_comments` with `limit 1`); never read the whole old card.
4. **Your FIRST reply is a status report of at most 5 plain-Thai lines, then stop and wait for the owner's go-ahead. Do not start any work before it.** Lines: (1) branch + HEAD; (2) in sync with GitHub? run `git fetch origin` (read-only) and compare; (3) done and verified / not verified; (4) next exact action; (5) approvals still needed.
5. **Wrong or stale folder = the FIRST line, as a warning, before anything else**: `AGENTS.md`, `CLAUDE.md` or `STATE.md` missing, or the branch is behind/diverged from its GitHub branch, or an open PR exists for newer work. Say "this folder is out of date: do not work here" and stop. Never infer the project state from old docs (`docs/HANDOVER.md`) when this happens.

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

## Reporting without duplicates
GitHub = technical evidence. Trello = status only (state, next action, approvals needed, links). Write a result once and link to it; do not copy it into Trello + HANDOVER + GO_LIVE + TEST_REPORT. `docs/HANDOVER.md` is append-only history: grep it, do not read it whole. At the end of a session replace `STATE.md`.

## Windows tooling facts
- Run wrangler as `node scripts/wrangler.mjs …` (`npx.cmd` mangles SQL/quotes; PowerShell blocks `npx.ps1`). `--mask` hides uuids and presigned URLs when output will be shown.
- Stale `.wrangler/cache/wrangler-account.json` gives error 10000 after an account switch: delete it. `wrangler login` is done by the owner in their own browser.
- System `core.autocrlf=true`: use `-c core.autocrlf=false` for byte-exact tests and commits. Do not use `python3 -` heredocs (they hang); use the Edit/Write tools.
- After any Admin deploy open every Admin page and look at it (console and visuals): an inline `//` comment inside a one-line `admin-ui` statement once shipped a SyntaxError.

## Efficiency
Batch independent tool calls; send `update_plan` together with another call; read big files by range or grep; keep tool output to counts and verdicts. One session per milestone — start a new one when context passes ~200K tokens.

## Token budget (owner direction, 2026-11-27)
Read relevant ranges/diffs, reuse verified facts and tool handles, batch independent checks and return counts/verdicts. Keep raw logs private. Scripts first, browser for UI/inbox proof. Do not repeat passing checks without a new reason. Keep one GitHub evidence record and one linked Trello milestone. Security and approval gates remain unchanged.
