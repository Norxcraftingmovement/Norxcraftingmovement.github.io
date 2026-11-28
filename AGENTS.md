# AGENTS.md — start here (any AI tool: Codex, GPT, Claude)

The rules live in ONE place: `CLAUDE.md`. They apply to every tool and are not repeated here. Read it first.

## Start (in this order, nothing more)
1. `CLAUDE.md` (rules, tiers, approval boundaries, Windows facts).
2. `STATE.md` (where the work is; it can be stale).
3. `git log -1` and `git status` (git and the code win over any file).
4. Trello status card: description + latest comment only. Never read the whole old card.
Then say in one or two sentences where the work stands and wait for the owner's go-ahead before changing anything.

## Stop / hand over (the owner may switch tools or machines at any moment)
- Work that is not pushed does not exist for the next tool. Push the branch (a `wip:` commit is fine); never force-push.
- Replace `STATE.md`: branch + HEAD, what is done and verified, what is not verified, the next exact action, approvals still needed.
- One short Trello comment per milestone (see CLAUDE.md). Do not copy results into several documents.
- If the push is refused (for example HTTP 403 = this machine's GitHub login has no write access), say so at once, in plain words. Do not work around it.

## Keep the context small
One session per milestone; start a new one when the context passes about 200K tokens. A new tool continues from `STATE.md` and the branch, not from a pasted chat history.
