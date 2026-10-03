# Handoff: standardized UI architecture (engine · TUI · GUI)

Start here. Read `AGENTS.md` and `README.md` first, then this file. It supersedes `docs/HANDOFF-desktop-ui.md`, which is now folded into milestone 1.

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
- **Both:** the Legend is too crowded (rule 3).

## Milestones

1. **Library + both renderers for the broken parts:** Tabs, Bar, ActionGroup, Popup (opaque), ScrollBox, Glyph sets. Also fix the GUI `live.tsx` load and the Trail prompt noise. Tests on terminal and desktop at many widths.
2. **Move each tab onto Screens + library:** Map, Trail, Open, Evidence, one per commit. Includes the compact Legend.
3. **GUI extras:** Svg progress bar and rules, then perhaps a timeline (topics as lanes, detours as branches).

## State at handoff

- `main` at `133f89c`. 33/33 tests pass, validate and tsc are clean. Installed at `~/.claude/skills/conversation-atlas`.
- Map accent is `yellowBright`, matching the status line's directory colour. Tab accents: Trail `#b9f27c`, Open pink, Evidence blue.
- Cost: the Claude observer used about 0.8% of usage on day one (Opus only). A first-run setup asks before any cost.
- The chats that built this were copied into this project's transcript folder, so `claude --resume` here lists them. The original `457af068…` chat lives in `F:\LocalProj\ClaudeModsExperimentation`.
