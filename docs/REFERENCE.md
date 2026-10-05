# Conversation Atlas reference

Detail that used to live in the README. For install and the 2-minute tour, see the
[README](../README.md).

## The pane

The pane (`Atlas`) opens unasked at session start. It docks beside the transcript in the
fullscreen layout at 144 columns or more. Below that width it waits until you open it. The
footer always shows an Atlas button (`● current topic · N`) that opens it at any width, inline
if needed, and so does `/atlas`.

The layout is a centered `─── Conversation Atlas ───` rule (just `Atlas` under 34 columns), a
tab bar, a self-scrolling body (wheel, PgUp/PgDn or the ▲▼ buttons), small popups anchored to
their source, and a bottom bar pinned to the pane bottom. If fewer than 4 body rows fit, the
pane stops pinning and lets Claude Code scroll it.

| Tab | Hotkey | Accent | What it shows |
|---|---|---|---|
| **Map** | `m` | light yellow (`yellowBright`) | ◎ goal, current topic path (the current node pulses when new), ↳ possible or active detour, live activity (spinner and shimmer while a tool runs, ✓ or ✗ after), working set, latest decisions and questions, ▸ resume next |
| **Trail** | `t` | light green | The full topic tree, then a timeline of prompts, topic shifts, decisions, detours, returns and checkpoints |
| **Open** | `o` | pink | Everything waiting on you: suggestions (goal, detour, return, next step, resume), observed decisions (**Confirm** / **Drop**; ones observed during a detour get **Keep** / **Exclude**) and open questions (**Confirm** = answered / **Drop**; Claude can also report them answered) |
| **Evidence** | `e` | blue | Checkpoints (click one to see the goal, topic and files at that moment), the settled-decision ledger, resolved questions, past detours, files and earlier sessions (**Resume this**) |

The active tab is bold coloured text and does not press. Inactive tabs are dim plain buttons.

The bottom bar holds **Legend** (`l`), **◇ decisions** (`d`), **? open questions** (`q`) and
**+ Mark** (`k`). Its labels adapt through full, mid and tiny tiers and wrap to a second row
when even the tiny labels do not fit. **Mark** is always visible. The tab bar adapts the same
way, and their keys stay present at 26, 34, 48 and 72 body columns.

### Three interaction patterns

- **Expansion.** Rows (goal, topics, decisions, questions, checkpoints, files) expand inline
  with indented dim `│` detail lines. The details show metadata, not a repeat of the row. Expansions end with a right-justified **✕**, with other actions on the left
  wrapping when needed. Each
  action group has one primary action where it makes sense, and the other actions are cyan
  `[ label ]` controls whose label lights up on hover.
- **Toggles.** Flip state in place.
  - **Legend** shows a panel pinned above the bottom bar, with **HOW TO USE** first and then
    the **LEGEND** glyph table. Under section headings, `EXPLAIN` notes describe each part. The
    panel also holds the **Observer: Claude / Engine only** toggle.
  - **Trail sort** flips the order of the timeline.
- **Popups.** Every Trail event opens a small rounded popup anchored below or above its row.
  Prompt events also show the full text, bullets and **Chat ⇒**. ◇ decisions and
  ? open questions open one small popup above their bottom-bar button, with each row
  expandable and showing its actions. Popups are at most 52 columns wide and 10 rows tall,
  measure each row at the popup's inner width, and put the scroll controls together at the
  bottom as `▲ n/m ▼`; **Close** stays at the top right. `✕ Close` or any other action
  dismisses a popup.

### Glyphs and colours

Rows, the Legend and the pane share one glyph-colour table.

◎ goal (cyan) · ○ suggestion · ● current topic (violet) · ↳ detour / ↩ return (amber) ·
◇ observed decision (green) · ◆ settled decision / checkpoint (blue) · ? open question (pink) ·
✓ success (green) · ✗ failure (pink) · ✎ edited file (orange) · · read file (violet) ·
✦ just changed

### Engine-only dimming

In engine-only mode, the Claude-sourced sections are dimmed with a `/atlas observer claude`
note: the current path, possible detours, detected-goal text, topic map and the
Claude-suggested **RESUME NEXT**. Cue-sourced detours and engine observations stay normal.
**Map earlier conversation** stays available as an explicit one-request action and is labelled
as such. While it runs, Atlas pins an animated indeterminate bar above the bottom bar with
the elapsed seconds; on completion it shows the mapping result for about four seconds.

### What updates itself, and what needs you

| Automatic (observation) | Needs your confirmation (intent) |
|---|---|
| Topic path and possible detours (from Claude's `observe` calls, after setup) | Setting the goal (**Use this as my goal**, `/atlas goal`) |
| Activity: reads, searches, edits, Bash, tests, git, web, subagents | Taking a detour |
| Working set, file counts | Returning (sends the return packet) |
| Checkpoints: commits, passing tests after edits, milestones | Promoting a detour to the goal |
| Observed decisions and open questions (Claude after setup, your wording, `AskUserQuestion`, a reply ending in "?") | Settling a decision into the ledger |
| Suggested next step, detected goal and goal suggestion from your first request | Pinning a next step, adopting last session's goal (**Resume**) |
| Earlier sessions found on disk | Resuming one (**Resume this**, `/atlas recover n`) |
| | Keeping or excluding detour findings |

### Where data is stored

| Location | Contents |
|---|---|
| Claude Code plugin store (`$.store`) | `setup` (your plugin-wide observer choice), `session:<id>` (the current session, restored on resume) and `project:<root>` (offered as **Resume** in the next new session of the same project). It keeps the last 12 sessions. |
| `<project>/.claude/atlas/<session>.json` | A project-local save file, written on a 2 s timer once there is a goal, topic or decision |

Add `.claude/atlas/` to your `.gitignore` if you don't want session maps committed.

## How it works

Atlas is a single Claude Code plugin with one hooks module and pure, testable helpers:

| File | Role |
|---|---|
| `hooks/register.tsx` | All hooks and side effects: events, the `/atlas` command, the `observe` tool, storage |
| `hooks/model.ts` | Pure reducers for the session map, holding the "observation never writes intent" rule |
| `hooks/activity.ts` | Classifies tool calls into activity, files, tests and commits |
| `hooks/view.tsx` | Pure render tree for the pane |
| `hooks/recall.ts` | Save-file format and readers for earlier sessions |
| `hooks/live.tsx` | Client module for spinners and shimmer (terminal and desktop; plain text on vscode and mobile) |
| `hooks/scan.ts` | Replay and one-request mapping of earlier conversation |

**Events and APIs used:**

- `session.start`: binds or restores state, reads the plugin-wide `setup` choice, sets the
  render-readable `conversation-atlas.mode`, registers the inert `observe` tool, the `atlas`
  command (`$.command.register`), `$.ui.open`, and `$.clock.every` for saving.
- `prompt.compose`: adds one static rules section (`scope: 'session'`) only while the stored
  mode is Claude. Before setup and in engine-only mode it adds nothing.
- `prompt.submit` (composer and bridge only): attaches the pending return packet and the
  `[Atlas #n: …]` chips still present in your message. While you have confirmed intent and
  Claude mode is on, it also adds the one-line confirmed-goal note.
- `turn.start`: turn count, prompt trail, wording cues. `turn.complete`: a reply ending in a
  question that Claude did not report.
- `tool.call` (all tools): activity rows, files, test and commit checkpoints
  (`gitOperation.commit`), `AskUserQuestion` questions and `ExitPlanMode` decisions.
  `tool.call {observe}` answers Claude's report. `agent.spawn` names subagents.
- `ui.render` on `Pane {atlas}` and `SessionMode` (the footer button).
- `ui.scroll` on `Pane {atlas}`: with no popup open, the pane scrolls its own body
  (`view.scroll`, clamped to an estimate of the body's rows) so the bottom bar stays pinned.
  With a popup open, the same event adjusts `view.popupScroll` and leaves the body offset
  unchanged. Body scrolling is a fixed-height column with an overflow-hidden window and a
  negative `marginTop`. Popup content is windowed independently.
- State: `$.state` `conversation-atlas.snapshot` via `update` (CAS), plus the render-readable
  `.view` and `.mode` keys. Render hooks only read it. Durable data is in `$.store` (`setup`,
  `session:<id>`, `project:<root>`) and the project-local save file. Earlier sessions are read
  from `.claude/atlas/`.

Every hook observes with `await next(e)` and returns the engine's result unchanged. The only
things Atlas answers itself are its own `observe` tool and the `/atlas` command.
