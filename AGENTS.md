# Conversation Atlas (Atlas) agent instructions

Read by Claude Code and by Codex. Keep this file short: detail lives in the linked docs.

## Where things live
- Repo: `F:\LocalProj\Claude-Mod-ConversationAtlas`. It moved out of `ClaudeModsExperimentation`; never re-add it there (`docs/HISTORY.md`).
- Install: private user-level copy at `~/.claude/skills/conversation-atlas`.
  - update with `scripts/install-atlas.ps1` after `claude plugin test .` and `claude plugin validate .` pass, then `/reload-plugins`.
- Docs:
  - `docs/ARCHITECTURE.md` (surfaces and seam), `docs/REFERENCE.md`
  - `docs/process/` (brief template, model roles), `docs/decisions/`
  - `docs/RELEASING.md`, `CHANGELOG.md`
- **UI work: read `docs/design/README.md` plus `TUI_UIUX_paradigm.md` and/or `GUI_UIUX_paradigm.md` first** (GUI also `docs/gui/DESIGN.md`, `CONTRACT.md`). Briefs for UI jobs list the file(s) to read.

## Branches and flow
- `main`: known good. Fast-forwards from `dev` only after the owner confirms the installed build.
- `dev`: integration. Work lands only by PR from `feat|fix|chore/<name>` cut from `dev`; the owner merges by button; Claude then installs from `dev` for the owner to try.
- One job's branch is checked out in this folder at a time. No worktrees, except one sibling folder (`../Claude-Mod-ConversationAtlas-<task>`) the owner allows for a specific parallel job, landed through `dev` and removed right after.
- Claude commits, merges and switches branches; Codex never does. Commit, push, tag, install and merge only on the owner's explicit word.
- Tracking: GitHub Issues and milestones, no task file.
  - each PR says `Closes #n` (into `dev` it does not auto-close; close the issue after the merge).
  - implementer chats are `Imp-<slug>`, managed by the Task Master.
  - patch = fix without new capability; minor = one capability with a one-line theme.
- **Dev flow:** issue → `atlas-triage` → `atlas-brief` → Codex → `node scripts/check.mjs --brief <brief>` → `atlas-ship` → owner merges → `atlas-land` (skills in `.claude/skills/`).
- The owner eye-tests only PRs marked `owner-eye`; everything else relies on the gate.

## Delegated agents (Codex etc.)
- May run headless (`codex exec`, background) with `--sandbox workspace-write`, never full access.
- May run `claude plugin test`, `claude plugin validate`, `scripts/check-seam.ps1` and `node scripts/check.mjs`.
- Never run the golden updater, an install or any git write unless the brief says so.
- Last step: write `.claude/atlas/handoffs/<brief-slug>.md` (status, summary, branch, tests, files). Claude watches for it and Atlas turns it into a report-back row.
- One change per brief, with an explicit list of files that may be touched.

## Golden snapshots guard the look
- `tests/golden/` holds the drawn terminal and desktop text of every tab, the Legend and a popup, from one fixed sample state at fixed widths.
- Any change to drawn output fails until the goldens are updated (run `tests/golden/update-goldens.ps1` under `pwsh`).
- Each brief names the goldens it may change; `node scripts/check.mjs --brief` rejects any other golden change.
- Claude reviews the golden diff, not just the test count, before installing.

## Engine invariants
- Atlas is the combined product; new intent features go here.
- **Observation never writes intent.**
  - `goal`, `detour`, `nextStep` and `marked` checkpoints change only in `setGoal`, `setNextStep`, `startDetour`, `returnFromDetour`, `promoteDetour`, `mark`, `confirmSuggestion`.
  - those are called only from a pane press (`act`) or `/atlas`.
  - `observe`, `startTurn` and the activity/file reducers may add only topics, suggestions, observed items, files, activity and evidence checkpoints (commit, tests, milestone).
  - enforced by `tests/atlas.test.tsx`.
- **Intent semantics:**
  - one active goal; one active detour.
  - a detour departs from the latest marked checkpoint, or makes one; the departure snapshot freezes goal, topic, next step and settled decisions.
  - decisions settled during a detour are its outcomes.
  - return emits one deterministic packet ("not recorded" for missing facts) that rides exactly one composer prompt.
  - promote replaces the goal and keeps history.
- **Context Claude reads** comes only from: the static rules section (`prompt.compose`), the one-line confirmed-intent note, a pending return packet, and Atlas chips the user left in the prompt (`Add to message` puts `[Atlas #n: …]` in the draft; a deleted chip sends nothing). Nothing observed is sent back as if settled.
- **Purity:** `model.ts`, `activity.ts` and `view.tsx` stay pure (no `$`). `register.tsx` is the only file with hooks and side effects, and creates the `Client` element (module path literal `./live.tsx`).
- Client props must be plain JSON: run them through `plain()` (an undefined field makes the engine refuse the tree).
- **State:** `$.state` `conversation-atlas.snapshot|view` via `update` (CAS); render hooks never write. Durable copies go to `$.store` on a 2 s timer; keep bounded lists in `LIMITS`.
- **Narrow interception:** hooks observe with `await next(e)` and return the engine's result unchanged; the only answers are the plugin's own tool and command.
- Before changing APIs, read the generated declarations (`.claude-plugin/types/` once loaded) and run `claude plugin validate` + `claude plugin test`.
- Recovery reads `<root>/.claude/atlas/*.json` (`saveFile` format); adopting one is always an explicit press or `/atlas recover n`.
- No Claude-usage-costing behaviour before the user's setup choice.

## Surface seam
- The engine and `hooks/screens/*` (ScreenModel + Action) are surface-blind.
- `hooks/render-tui.tsx` and `hooks/render-gui.tsx` are complete, independent renderers; only neutral measuring helpers stay in `hooks/ui/shared.tsx`; `view.tsx` dispatches to one renderer.
- Enforced by `scripts/check-seam.ps1`. Diagram: `docs/ARCHITECTURE.md`.
- A GUI change edits `render-gui.tsx` and keeps every terminal golden byte-identical.
- Shared files (`register.tsx`, `live.tsx`, `screens/*`, `view.tsx`) need an explicit owner-approved job.

## Releases
- The version lives only in `.claude-plugin/plugin.json`; the marketplace entry is `.claude-plugin/marketplace.json`.
- Releases follow `docs/RELEASING.md` and are recorded in `CHANGELOG.md`.
