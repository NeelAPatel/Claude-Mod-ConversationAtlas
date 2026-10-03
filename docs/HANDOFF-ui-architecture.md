# Handoff: standardized UI architecture (engine · TUI · GUI)

Start here. Read `AGENTS.md` and `README.md` first, then `docs/DECISIONS.md` (the full decision log of the chat that built Atlas), then this file. It supersedes `docs/HANDOFF-desktop-ui.md`, which is now folded into milestone 1.

## Working rules (from the user)

- **Delegate and review only.** Every change is implemented by Codex `gpt-5.6-luna` at `model_reasoning_effort=xhigh`. It runs **interactively in a visible Windows Terminal tab, never headless**:
  `wt -w 0 new-tab --title "Codex: <task>" -d F:\LocalProj\Claude-Mod-ConversationAtlas codex -m gpt-5.6-luna -c model_reasoning_effort=xhigh --sandbox danger-full-access -a never "Read <brief.md> and do exactly what it says."`
  Tell the user the tab title, folder and brief path in one line.
- **What Claude does:**
  1. Write the brief to `%TEMP%\claude\<name>.md`.
  2. Review: `claude plugin test .`, `claude plugin validate .`, and `npx -y -p typescript@5.6 tsc -p C:/Users/Neel/AppData/Local/Temp/claude/tc-atlas`. Check the intent and consent invariants.
  3. Install with `.\scripts\install-atlas.ps1`.
  4. Commit.
- **Run one Codex job at a time.** They share `hooks/view.tsx`.
- **Commits:** small ones are fine. On publication the repo will become a new single-commit repo, which is a separate user decision.
- **Answers:** structured when there are several facts, prose for a single judgement. Say last what still needs the user.

## Why a refactor

`hooks/view.tsx` (~1,300 lines) mixes *what* to show with *how to draw it on a terminal*. Desktop (the GUI) inherits terminal assumptions: monospace cells, text-drawn buttons, widths counted in characters. So it crops, wraps and mixes button styles. The terminal shows the same problems, more mildly.

## Target layers

| Layer | Role |
|---|---|
| **Engine**: `model.ts`, `activity.ts`, `recall.ts`, `scan.ts` | State, observation vs intent, persistence. Already pure; keep it. |
| **Screens** (new) | What each tab shows (sections, rows, actions, popups, counts) as plain data, with no layout. |
| **UI library** (new) | `Tabs`, `Bar`, `Section`, `Row`, `ActionGroup`, `Popup`, `ScrollBox`, `Badge`, `Glyph`, `Progress`. Each enforces the shared rules below. |
| **Renderers** (new) | **TUI**: cells, measured widths, cyan `[ ]` chrome for secondary actions, no-wrap bars. **GUI** (Desktop, `e.surface === 'desktop'`): native button styles (`variant` primary/secondary, no ASCII brackets), border lines instead of `─` text, layout-driven truncation, `Svg` where text draws badly. |

The library starts inside this repo. Sharing it with EnvVault is a later, deliberate decision.

## Shared rules the library must enforce

1. **Bars (tabs and bottom bar)** never crop, wrap or drop items. They collapse labels by priority: full → short → icon+count. The active tab and **+ Mark** are always visible. GUI always uses the compact form, because its key-chip badges and proportional font are wide. A test sweeps widths (e.g. 20 to 100) and fails on wrap or crop.
2. **Anything longer than 4 lines goes in a scrollable popup** (ScrollBox), except the Legend.
3. **Legend stays inline but compact:** the glyph grid plus at most 2 "how to use" lines, with the long explanation behind a "More" popup. Today it is too crowded.
4. **Popups are opaque:** fill every cell (spaces with background), so the rows beneath never show through. Today they bleed through in the Trail.
5. **One primary action per group.** Secondary actions: cyan `[ ]` on TUI, native secondary on GUI.
6. **Text truncates through layout** (`wrap="truncate-end"` in a shrinking box), not through a precomputed `fit()` count.
7. **Glyph sets per surface**, from one table shared with the Legend.
8. **Anything hoverable is interactive.** Existing invariant; keep it.

## Known bugs (screenshots from the user, 2026-10-03)

- **GUI:** `Client hooks/live.tsx: did not load`. Current Path and Activity show this error text. Fix the module load on desktop, or fall back to static text there.
- **GUI:** tabs crop (`Eviden…`) or wrap (`Open` / `1` on two lines); the bottom bar crops (`0 ope…`); the `────` rule wraps to a second line.
- **GUI:** mixed button styles (native `Set as goal` next to ASCII `[ Not my goal ]`).
- **GUI:** in the expanded file detail, `·1 7m` floats mid-row next to the `│` lines.
- **TUI:** Trail popups bleed through to the rows beneath (rule 4).
- **Both:** the Trail records engine noise as prompts: `<task-notification>`, `<agent-message …>`, `[Image #n]`, `<pasted_content>` markers, and duplicated "Tests passed: Tests passed". Only text the person typed should be a prompt event. Strip markers and keep the typed remainder.
- **Both:** the Claude observer goes silent. In the original chat, after Atlas was reinstalled or reloaded, the `mcp__conversation-atlas__observe` tool never returned to Claude's tool list, though setup was Claude. For hours the Trail held only engine events (prompts, `Tests passed`) and no topics, decisions or questions. Find out why: tool registration after reload or install, deferred-tool surfacing, or the mode gate. Make it visible in the pane: a status line such as "Claude observer: on · last report 2h ago" with a warning when there are no reports while on.
- **Both:** Trail checkpoint rows read `Tests passed: Tests passed`. The event text repeats the checkpoint name. Show `Tests passed · <command>`.
- **Both:** checkpoints share ◆ with settled decisions. **The user wants a distinct checkpoint icon.** Proposed: ⚑ (a return point) for checkpoints, ◆ for settled decisions only. Update the GLYPH table, the Legend and the tests.
- **Both:** the Legend is too crowded (rule 3).
- **Both:** `/atlas scan` (map earlier conversation) seems to produce little or no data on real earlier threads. Find out why (fork size or limits, the reply not parsing as JSON, or the replay missing user text) and fix it.

## Discussion point: making the Trail "correct"

The user feels the Trail is not right yet. Today it is a flat, mixed log: engine noise, repeated `Tests passed` rows, and prompts cut mid-sentence, with almost no topics or decisions while the observer is silent. **Discuss these options with the user before briefing Codex.**

1. **A story, not a log: group by turn.** Each turn is one row: the person's typed prompt (first sentence). Under it, collapsed, sits what happened in that turn: "4 edits · 2 reads · tests ✓ · commit abc123", plus any topic shift, decision or question. Expanding a turn shows the details; the popup shows the full prompt and its bullets.
2. **Only real things.** Typed text only (strip `<task-notification>`, `<agent-message>`, `<pasted_content>` and `[Image #n]`; for pasted content say "pasted N lines"). Collapse repeats ("Tests passed ×3"). No echo of the checkpoint name.
3. **Structure from intent.** Indent detour segments under their departure and close them with a ↩ return row. Pin the confirmed goal at the top. Use time-bucket headers (Now · Last hour · Earlier · Yesterday).
4. **Engine-only semantics, so the Trail is useful without Claude.**
   - Commit messages become milestones.
   - Plan approvals and AskUserQuestion answers become decisions.
   - A cluster of the working set (a run of edits in one folder) becomes a candidate topic ("hooks/: view.tsx, register.tsx").
5. **Say where each row came from:** a small source mark (you / Claude / engine). A row that is a guess should look like one.
6. **Filters:** toggles for Prompts · Topics · Decisions · Checkpoints · Detours. Default: all except raw prompts once topics exist.
7. **Observer health,** shown on the Trail: "Claude observer on · last report 2h ago" with a warning when silent. Without it the Trail looks broken when the cause is a missing tool.
8. **Optional, costs usage:** a per-turn one-line summary from Claude (folded into `observe` or a cheap fork), shown instead of the raw first sentence. Off by default; part of the observer consent.

**User idea (2026-10-03): put this behind a Trail "View" menu instead of choosing one design.** A `[ View ]` button on the TRAIL heading opens a small popup (the standard popup paradigm) with two separate choices:
- **How to show (layout, pick one):** `Story` (grouped by turn, the default once built) · `Log` (today's flat chronological list) · `Compact` (milestones only: goal, topics, decisions, checkpoints, returns).
- **What to show (filters, toggles):** Prompts · Topics · Decisions · Questions · Checkpoints · Detours · Activity summaries · Source marks.
- The sort toggle (newest/oldest first) moves into this menu too.

Keep it from getting complex:
- Ship **presets first**, with filters as an "Advanced" section of the same popup.
- Remember the choice plugin-wide in `$.store`, as setup does.
- Show the active view in the heading ("TRAIL · Story").
- Make every layout a pure function over the same event list, so a new layout adds no new state.
- Test each layout at narrow and wide widths, on TUI and GUI.

Suggested order: 2 and 7 (fixes) → 1 (turn grouping) → 4 (engine semantics) → the View menu with the Log and Story layouts → 3, 5, 6 as filters and options inside it → 8 (only if the user wants it).

## Settled with the user (2026-10-03)

The Trail discussion above is closed:
- **View menu: two layouts only, `Story` (default) and `Log`.** No `Compact`, because the Map already covers it. The sort toggle moves into the menu. **No filter toggles yet**; add one only when the user misses it.
- **Source marks (you / Claude / engine) are on by default,** not a filter.
- **Engine-derived decisions** (plan approvals, AskUserQuestion answers) are **heard, not settled**. Commit messages become milestones. **No working-set clusters as topics.**
- **No per-turn Claude summaries** for now.
- **Observer health and silence** is its own Codex job, right after milestone 1.
- **Delegation must be visible (user ask).** When work is handed off (a Codex tab, a background shell, an Agent subagent), the Trail shows it so it never reads "prompt → ??? → tests run":
  - a **hand-off row** (→ agent, title, brief path), open while the work runs;
  - a **report-back row** (←) built from the `<task-notification>` or `<agent-message>` that is today mislogged as a prompt;
  - where it can be measured, **what changed while it was away** (files changed that Claude did not edit).

## Milestones

1. **Library + both renderers for the broken parts:** Tabs, Bar, ActionGroup, Popup (opaque), ScrollBox, Glyph sets. Also fix the GUI `live.tsx` load and the Trail prompt noise. Tests on terminal and desktop at many widths.
2. **Move each tab onto Screens + library:** Map, Trail, Open, Evidence, one per commit. Includes the compact Legend.
3. **GUI extras:** Svg progress bar and rules, then perhaps a timeline (topics as lanes, detours as branches).

## State at handoff

- `main` at `133f89c`. 33/33 tests pass, validate and tsc are clean. Installed at `~/.claude/skills/conversation-atlas`.
- Map accent is `yellowBright`, matching the status line's directory colour. Tab accents: Trail `#b9f27c`, Open pink, Evidence blue.
- Cost: the Claude observer used about 0.8% of usage on day one (Opus only). A first-run setup asks before any cost.
- The chats that built this were copied into this project's transcript folder, so `claude --resume` here lists them. The original `457af068…` chat lives in `F:\LocalProj\ClaudeModsExperimentation`.
