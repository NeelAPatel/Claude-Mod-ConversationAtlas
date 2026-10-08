---
name: atlas-brief
description: Write, check and launch a Codex job for a triaged Conversation Atlas issue using the brief template and the model-role table. Use for /atlas-brief <issue number>.
---

# Atlas brief

Input: a triaged issue. Output: a checked brief, a running headless Codex job, and a one-line launch note to the owner.

1. Read the issue and its triage comment (`gh issue view <n> --comments`). If there is no triage, run `atlas-triage` first.
2. Pick the model and effort from `docs/process/models.md`. If two open issues touch the same files, batch them in one brief with a combined GOLDENS line.
3. Cut the branch from `dev`: `git switch dev && git pull --ff-only && git switch -c <feat|fix|chore>/<slug>`. One job at a time in the main folder.
4. Copy `docs/process/brief-template.md` to `.claude/atlas/handoffs/<slug>-brief.md` and fill every section. Name exact files and lines so the agent does not explore. RESTATE the issue in your own words. SCOPE is an allow-list; tag shared files `(shared)`. GOLDENS is `none` or basenames. VERIFY includes `node scripts/check.mjs --brief .claude/atlas/handoffs/<slug>-brief.md`. Tell Codex it may run `claude plugin test .`, validate and the checker, but never commits, merges, switches branches, installs, or runs the golden updater unless the brief says so.
5. `node scripts/check-brief.mjs .claude/atlas/handoffs/<slug>-brief.md` must pass. Fix the brief, not the checker.
6. Create `.claude/atlas/handoffs/<slug>.progress.md` with one `[ ]` line per stage, and start the live bar (`mcp__plan-progress__plan_progress`).
7. Launch in the background (so the harness notifies on exit):
   `echo "Read <brief path> and follow it exactly. Read AGENTS.md first." | codex exec -m <model> -c model_reasoning_effort='"<effort>"' --sandbox workspace-write -C <repo> - > .claude/atlas/handoffs/<slug>.log 2>&1`
8. Tell the owner in one line: working folder, brief path, report/log path, and model plus effort with the reason. Do not poll; wait for the exit notification.

Then use `atlas-ship`. The repo is public: no secrets or personal paths in briefs that become PR text.
