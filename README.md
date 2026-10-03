# Conversation Atlas

**A live map of your Claude Code session: where you started, where you are, and how to get back.**

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.287%2B-d97757)
![Status](https://img.shields.io/badge/status-early%20release-orange)
![Telemetry](https://img.shields.io/badge/telemetry-none-brightgreen)

Long Claude Code sessions drift. A quick tangent turns into an hour, a decision made early gets
lost in scrollback, and after a break nobody remembers what "next" was. Conversation Atlas
is a Claude Code plugin that adds a side pane. While you work normally, the pane maps the
session: your goal, the current path through topics, detours, decisions, open questions,
checkpoints, the files in play, and what to resume next.

<!-- Screenshot: replace with a capture of the docked pane, e.g. docs/atlas-pane.png -->

> **Observation never becomes intent without you.** Atlas observes with Claude only after you
> choose that setup, and it never rewrites your intent on its own. Until you choose, it runs
> engine-only. Atlas and Claude can *suggest* a goal, a detour or a return. Only you turn a
> suggestion into intent, by pressing a button in the pane or typing an `/atlas` command.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Using the pane](#using-the-pane)
- [Commands](#commands)
- [Configuration](#configuration)
- [Privacy and cost](#privacy-and-cost)
- [How it works](#how-it-works)
- [Development](#development)
- [Limitations](#limitations)
- [Roadmap](#roadmap)
- [License](#license)

## Features

- **Goal, detour, return.** Set a goal, take a detour with a snapshot of where you left off,
  then return. On return, a one-shot packet tells Claude where you were. You can also promote
  a detour that turned out to be the real work.
- **Live topic path.** A tree of the topics the conversation has covered. The current topic is
  highlighted, and possible detours are flagged as suggestions.
- **Detected goal.** Atlas shows the aim it detected next to your confirmed goal. It is always
  an observation, and **Use this as my goal** is the explicit step that makes it intent.
- **Decisions and open questions.** Decisions and questions are captured from Claude's reports
  (after setup), your own wording, `AskUserQuestion` prompts and replies that end in a
  question. Settle a decision to move it into a durable ledger.
- **Evidence checkpoints.** Commits, test runs that pass after edits, milestones and your own
  marks, each with the goal, topic and files at that moment.
- **Activity and working set.** Reads, searches, edits, shell commands, tests, git, web calls and
  subagents, with the files that were read or written.
- **Message chips.** **Add to message** on an item inserts an `[Atlas #n: …]` chip into your
  draft. Only the chips still in the text when you send are passed to Claude.
- **Resume anywhere.** Each session is saved to the project folder. New sessions in the same
  project offer to resume the last goal, and `/atlas recover` lists earlier sessions.
- **Joins late.** If you install Atlas or open it mid-session, it replays the earlier
  conversation for free. It can also map the history with a single, mostly cached Claude request.

## Requirements

- **Claude Code 2.1.287 or later**, in the terminal or the desktop Code tab
- To dock the pane beside the transcript: the fullscreen layout (`/tui fullscreen`) and a
  terminal at least **144 columns** wide. At narrower widths, open the pane from the footer
  button.

## Installation

### Try it from source

Clone the repository and start Claude Code with the plugin directory. The repository root is
the plugin:

```bash
claude --plugin-dir .
```

### Install for your user (Windows)

The included script validates the plugin and backs up any earlier copy. It then installs the
plugin to `~/.claude/skills/conversation-atlas` and validates again:

```powershell
.\scripts\install-atlas.ps1
```

Every new Claude Code session then loads it as `conversation-atlas@skills-dir`. In a session
that is already running, use `/reload-plugins`.

> Don't combine the two methods. If the installed copy is enabled, don't also pass
> `--plugin-dir` in the same session, or two copies of the plugin will load.

## Quick start

1. Start a session. The **Atlas** pane opens and shows **Set up Atlas**. Until you choose,
   Atlas runs engine-only: no observer rules are added, no intent line is sent, and `observe`
   answers "off".
2. Choose an observer mode:
   - **Use Claude observer**: Claude reports topic shifts, decisions and questions through a
     small tool. This costs a little Claude usage on turns where something changed.
   - **Engine only (free)**: Atlas uses only files, activity, tests, commits and your wording.

   The choice is stored plugin-wide in `$.store` under `setup`, so it applies to every project
   and session. You can change it later with `/atlas observer [claude|engine]`, show the
   screen again with `/atlas setup`, or flip the **Observer** toggle in the Legend panel.
3. Set a goal: `/atlas goal ship the login refactor`, or accept the suggested or detected goal
   in the **Open** or **Map** tab.
4. Work as usual. When you start a tangent, use `/atlas detour check the flaky test`. When
   you're done with it, use `/atlas return`.

### Joining a session late

- **On launch, free:** Atlas replays the earlier messages (`$.session.messages()`): your
  prompts and their wording cues, the goal suggestion, files read and edited, test and commit
  checkpoints, and a question left open at the end.
- **On request, one cached request:** `/atlas scan`, or **Map earlier conversation (1 Claude
  request)** in the Trail tab, asks Claude once over the session's own transcript
  (`$.model.fork`, mostly served from the prompt cache) for topics, decisions, open questions
  and a next step. This deliberate action is also available in engine-only mode. Everything it
  returns is an observation, so confirm what is true in the Open tab.
- **`scanOnLaunch`:** `engine` (default, free replay), `claude` (replay plus the one-request
  map on launch, after Claude observer setup) or `off`.

## Using the pane

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
| **Map** | `m` | violet | ◎ goal, current topic path (the current node pulses when new), ↳ possible or active detour, live activity (spinner and shimmer while a tool runs, ✓ or ✗ after), working set, latest decisions and questions, ▸ resume next |
| **Trail** | `t` | light green | The full topic tree, then a timeline of prompts, topic shifts, decisions, detours, returns and checkpoints |
| **Open** | `o` | pink | Everything waiting on you: suggestions (goal, detour, return, next step, resume), observed decisions (**Settle** / **Drop**; ones observed during a detour get **Keep** / **Exclude**) and open questions (**Resolved**) |
| **Evidence** | `e` | blue | Checkpoints (click one to see the goal, topic and files at that moment), the settled-decision ledger, resolved questions, past detours, files and earlier sessions (**Resume this**) |

The active tab is bold coloured text and does not press. Inactive tabs are dim plain buttons.

The bottom bar holds **Legend** (`l`), **◇ decisions** (`d`), **? open questions** (`q`) and
**+ Mark** (`k`). Its labels adapt through full, mid and tiny tiers and wrap to a second row
when even the tiny labels do not fit. **Mark** is always visible. The tab bar adapts the same
way, and their keys stay present at 26, 34, 48 and 72 body columns.

### Three interaction patterns

- **Expansion.** Rows (goal, topics, decisions, questions, checkpoints, files) expand inline
  with indented dim `│` detail lines. The details show metadata, not a repeat of the row. Each
  action group has one primary action where it makes sense, and the other actions are cyan
  `[ label ]` controls.
- **Toggles.** Flip state in place.
  - **Legend** shows a panel pinned above the bottom bar, with **HOW TO USE** first and then
    the **LEGEND** glyph table. Under section headings, `EXPLAIN` notes describe each part. The
    panel also holds the **Observer: Claude / Engine only** toggle.
  - **Trail sort** flips the order of the timeline.
- **Popups.** Every Trail event opens a small rounded popup anchored below or above its row.
  Prompt events also show the full text, bullets and **Add to message**. ◇ decisions and
  ? open questions open one small popup above their bottom-bar button, with each row
  expandable and showing its actions. Popups are at most 52 columns wide and 10 rows tall,
  scroll their own content with ▲▼ or the mouse wheel, and show an `n/m` position. `✕ Close`
  or any other action dismisses a popup.

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
as such.

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

## Commands

Every command is under `/atlas`. To list them, use `/atlas help`.

| Command | Description |
|---|---|
| `/atlas` | Open the pane |
| `/atlas goal <text>` (alias `aim`) | Set your goal |
| `/atlas next <step>` | Pin the next step |
| `/atlas mark [name]` | Add a marked checkpoint |
| `/atlas decision <text> [--reason <why>]` | Record a settled decision |
| `/atlas detour <reason>` | Take a detour |
| `/atlas outcome <finding>` | Record a finding during a detour |
| `/atlas exclude <material>` | Exclude material found during a detour |
| `/atlas return` | Return from the detour and send the return packet |
| `/atlas promote` | Promote the current detour to the goal |
| `/atlas scan` | Map the conversation so far with Claude (one cached request) |
| `/atlas observer [claude\|engine]` | Show or change the observer mode. The stored setup choice is authoritative |
| `/atlas setup` | Show the setup screen again |
| `/atlas recover [n]` | List earlier Atlas and Trailhead sessions, or resume number *n* |
| `/atlas reset` | Clear this session's map (saved files and earlier sessions are kept) |

## Configuration

To configure Atlas, open `/config` → **conversation-atlas**, or set `pluginConfigs` in your
settings.

| Setting | Values | Default | Effect |
|---|---|---|---|
| `observer` | `claude and engine`, `engine only` | `claude and engine` | Only sets the default preselected on the first-run setup screen. After you choose in setup, the stored `setup` choice is authoritative (change it with `/atlas observer`). |
| `scanOnLaunch` | `engine`, `claude`, `off` | `engine` | Applies when Atlas joins a session that already has history. `engine` replays it for free. `claude` also asks Claude once to map topics and decisions (only after Claude observer setup). `off` does neither. |

The setup choice is stored as `{ observer: 'claude' | 'engine', at }` in `$.store` under
`setup`. It is saved plugin-wide, so it applies to every project and session.

## Privacy and cost

- **No network calls and no telemetry.** All data stays on your machine.
- **Nothing costs Claude usage before you choose a mode.** Until you choose in setup, Atlas
  runs engine-only: no rules section, no intent line, and `observe` answers "off".
- **Engine-only mode is free.** It adds no rules to the prompt and records no Claude
  observations.
- **Claude observer mode** adds one cached rules section to the system prompt. On turns where
  something changed, Claude makes one small `observe` tool call, about a few dozen tokens. The
  cost measured ≈0.8% of usage on day one, Opus only, in Claude mode.
- **`/atlas scan`** is always an explicit action. It sends one forked request over the
  session's own transcript, mostly served from the prompt cache.
- **What Atlas sends to Claude:** the rules section (Claude mode only), a one-line note of your
  confirmed goal and detour (`Conversation Atlas, confirmed by the user: goal …; on a detour
  …`, Claude mode only), a pending return packet, and any `[Atlas #n: …]` chips you left in
  your message. Observed items are never presented to Claude as settled facts.

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
  from `.claude/atlas/` and from Trailhead's `.claude/trailhead/*.json` (highest checkpoint per
  session).

Every hook observes with `await next(e)` and returns the engine's result unchanged. The only
things Atlas answers itself are its own `observe` tool and the `/atlas` command.

### Migrating from Trailhead

Atlas replaces the earlier Trailhead plugin and keeps its goal → detour → return model.
`/atlas recover` also lists Trailhead checkpoints from `.claude/trailhead/`. Resuming one
restores the goal, the next step and the main-goal decisions.

## Development

```powershell
claude plugin validate .
claude plugin test .
```

Then run `/reload-plugins` in a running session. To try a change without installing it, use
`claude --plugin-dir .`, or hot reload from a plugin-authoring session. Never use either while
the installed copy is enabled in that session, because two copies of one plugin would both
load. For a docked pane, use `/tui fullscreen` and a terminal at least 144 columns wide, or
click the footer Atlas button.

The runtime tests in `tests/atlas.test.tsx` cover the following:

- model invariants, first-run consent and observer mode switching
- detected-goal observation and upgrade
- hooks, merge, recovery and late join
- inline expansion, primary and bracketed action controls, active-tab accents and shared glyph
  colours
- small anchored popups, scrollable decision menus and popup-versus-body `ui.scroll`
- Legend and Trail toggles
- responsive bars at 26, 34, 48 and 72 columns, and pinned scrolling
- message-chip boundaries

**Last result (Claude Code 2.1.288):** validation passed and **30/30** runtime tests passed.
`tsc --strict` was clean against the build's generated declarations.

The API reference for your installed build is in the generated declarations in
`.claude-plugin/types/`. They appear once the plugin has loaded, and they take precedence over
web documentation. For contributor rules, see [`AGENTS.md`](AGENTS.md).

## Limitations

- In engine-only mode there is no topic path; topic quality depends on Claude calling
  `observe`.
- Wording cues such as "btw", "quick tangent" and "back to the main…" are English-only. They
  only ever create suggestions.
- Only one detour can be active at a time. Nested tangents appear as topics inside the detour.
- Matching a return to an earlier topic is fuzzy. A wrong match moves only the observed path,
  never your intent.
- Docking depends on the fullscreen layout and terminal width. Scroll limits are estimates, so
  a list can stop a row early or late.
- Recovery reads at most 80 files per folder and lists 12 sessions.

## Roadmap

- [ ] Graphical timeline on desktop: topics as lanes, detours as branches, checkpoints as pins
- [ ] Checkpoints that attach test output or a diff stat, with "rewind context to here"
- [ ] Export the settled-decision ledger to a project file that Claude reads at session start
- [ ] Opt-in end-of-session summary as a resume note, shown before it is saved
- [ ] Link pane topics to the transcript rows they cover

## License

<!-- TODO: choose a license (e.g. MIT) and add a LICENSE file before publishing. -->
No license has been chosen yet. All rights reserved until one is added.
