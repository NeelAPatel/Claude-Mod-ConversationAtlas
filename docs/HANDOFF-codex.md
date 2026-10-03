# Handoff to Codex: Atlas, from 2026-10-03

Claude (the orchestrator and reviewer) hit its usage limit. **Codex now plays both roles**: you implement, and you also do the review, commit and install steps Claude did, under the same rules. The user steers. Ask the user before anything outward-facing.

Read first: `AGENTS.md` (the invariants; they still apply in full), then this file. Background: `docs/DECISIONS.md` and `docs/HANDOFF-ui-architecture.md`.

## 1. State right now
- Repo `F:\LocalProj\Claude-Mod-ConversationAtlas`, branch **`dev` at `a027890`**, clean. **Installed** at `~/.claude/skills/conversation-atlas`, matching `dev` exactly.
- `main` = `f9fa782` (the MIT LICENSE). `dev` already contains it (merge `d055508`), so promoting `dev` to `main` is a fast-forward. **Promote only when the user confirms the installed build looks right.**
- Checks on `dev`: `claude plugin test .` 57/57 (incl. the golden snapshots), `claude plugin validate .` ✓, tsc ✓.
- **GitHub:** public at https://github.com/NeelAPatel/Claude-Mod-ConversationAtlas. **DO NOT PUSH.** User rule: commit only, and push only when the user explicitly asks. Everything after `f9fa782` is local only.
- No worktrees open. Only `../Claude-Mod-ConversationAtlas-t2` was ever used, and it's removed.

## 2. What landed in this session (newest last)
M1 UI library and renderers → bars as a responsive grid (4 → 2 → 1 columns, the pane asks for 46 columns) → M2 Screens layer (`hooks/screens/`, a per-surface render) → M2 regression fixes → **golden snapshots** (`tests/golden/`) → T4 sort glyph → T1 actions inside expansions → T3 heading help → T5 `[Edit]` goal, `[x]` buttons, suggested goals → T6 clearer detours → T2 Trail events expand inline → J1 one line everywhere and smart truncation → J2 plain clickable headings → J3 Trail View menu (Story/Log, source marks; `›` = the person) → J4 cheaper observe (rides along with other tool calls).

## 3. Workflow (keep it)
1. **One change per job.** `git switch -c feat/<name> dev`.
2. Implement. Regenerate goldens with `tests/golden/update-goldens.ps1` **only for the screens your change should affect**. Decide which goldens may change before you start.
3. Checks:
   - `claude plugin test .`
   - `claude plugin validate .`
   - `npx -y --cache F:\LocalProj\Claude-Mod-ConversationAtlas\.tmp-npm-cache -p typescript@5.6 tsc -p C:/Users/Neel/AppData/Local/Temp/claude/tc-atlas`
4. **Golden scope check:** `git diff --name-only tests/golden | grep txt`. Use `git diff`, **not** `git status`: status lists files whose only change is CRLF/LF line endings. Any golden outside your allowed list means the change leaked. Fix the code, don't regenerate.
5. Read the golden diff yourself (`git diff tests/golden/terminal-80-*.txt`). Does it show only what the user asked for?
6. Commit on the feature branch (end the message with `Co-Authored-By` lines as the repo history shows), then `git switch dev && git merge --ff-only feat/<name>`.
7. Install: `powershell -NoProfile -Command "Set-Location F:\LocalProj\Claude-Mod-ConversationAtlas; .\scripts\install-atlas.ps1"` (don't pipe it through `Select-Object -First`, which kills it). Verify with `diff -rq hooks ~/.claude/skills/conversation-atlas/hooks`.
8. Tell the user to run `/reload-plugins` and what to look at. Ask for screenshots.

Style: no line over 160 characters, no `any`, no `@ts-ignore`, one statement per line, comments for the why. Engine files (`model.ts`, `activity.ts`, `recall.ts`, `scan.ts`, `delegation.ts`) stay pure; `register.tsx` is the only file with side effects. **Observation never writes intent.**

## 4. Waiting on the user
- **Review the installed build** (one-line rows, plain headings, the Trail View menu, expanded rows), then **promote `dev` → `main`** (fast-forward, no push).
- The README rewrite: the user has a prompt that writes drafts to `C:\Users\Neel\AppData\Local\Temp\claude\readme-draft\`. When the drafts exist, commit them (README.md, and optionally `docs/DETAILS.md`) as one change.
- `/atlas` → `/neo-atlas` rename? Still unanswered. Don't do it unasked.

## 5. Backlog (agreed, not started)
In this order, one job each:
1. **Observer health:** a status line "Claude observer on · last report 2h ago", with a warning when the observer is on but silent. Investigate why `mcp__conversation-atlas__observe` drops off Claude's tool list after a reload or install.
2. **Engine-derived items:** commit messages → milestones; plan approvals and AskUserQuestion answers → **heard** decisions (never settled). No working-set clusters as topics.
3. **`/atlas scan`** yields little or no data on real earlier threads. Find out why: fork size or limits, the reply not parsing as JSON, or the replay missing user text.
4. **Richer Story view:** the full typed prompt is already free (it comes with `turn.start`); show it in the Story expansion. Claude's full output is *not* stored for free, so leave that out.
5. **Desktop:** check in the real desktop app that the live animation (`hooks/live.tsx`) loads, then GUI-side polish. Milestone 3: Svg progress bars and rules, maybe a timeline.
6. **Re-measure observe cost** after a few long sessions, using the method in memory note `atlas-observe-cost`: the extra round-trip after a standalone observe call. Target: far below the old ≈10%.

Decided **not** to do: a progress-bar feature (the user decided against it); filter toggles in the Trail View; per-turn Claude summaries.

## 6. Pitfalls learned (save yourself the time)
- **Golden false positives:** use `git diff --name-only`, not `git status` (line endings).
- **npm in the sandbox:** the default cache gives EPERM; use `--cache F:\LocalProj\Claude-Mod-ConversationAtlas\.tmp-npm-cache` (gitignored).
- **`codex exec -i a.png -i b.png "prompt"`**: `-i` swallows the prompt as an image. Pipe the prompt on stdin instead.
- **Bash and PowerShell paths:** PowerShell can't use `/c/...` paths, and `\\$var` inside bash double quotes turns into a literal `$var`. Use forward-slash Windows paths (`C:/Users/...`).
- **Detecting your own processes:** don't match any `codex exec`. The user may have others running; process 18280 from 00:23 looked like an orphan. Wait on the job's report file or its own PID.
- **Worktrees:** a sandboxed agent in a worktree can't `git add` (the git dir is in the main repo). Rebase conflicts in generated goldens: take `dev`'s side and regenerate. Never hand-merge them.
- **Desktop `Client`:** desktop's element table includes `Client`. The static fallback is only for surfaces without it (`'Client' in t`).
- **Hand-off detection:** only commands that *run* an agent count, not ones that mention "codex" in a path, grep or log name.

## 7. Paths
- Briefs written this session: `C:\Users\Neel\AppData\Local\Temp\claude\atlas-*.md` (`atlas-t-common.md` has the shared job rules).
- Job runner scripts and logs: `C:\Users\Neel\.claude\jobs\ffcc4887\tmp\` (`run-jobs.sh`, `codex-*.log`, `cost.py`). These may be cleaned up with Claude's job; copy anything you need.
- Agent reports: `.claude/atlas/handoffs/<slug>.md` (gitignored).
- Claude's memory for this project: `C:\Users\Neel\.claude\projects\F--LocalProj-Claude-Mod-ConversationAtlas\memory\` (branching, GitHub/no-push, observe cost, work location).
