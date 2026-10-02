# ConversationAtlas (Atlas), v0 prototype

A self-updating companion pane for long Claude Code sessions. As you work normally, it maps
where the session is: your goal, the current path through topics, possible detours, decisions,
open questions, checkpoints, the files in play, live activity and what to resume next.

**Core rule: it observes on its own and never rewrites your intent on its own.** Claude and the engine
can *propose* a goal, a detour or a return. Only you turn a proposal into intent, by pressing a button in the pane or typing `/atlas …`.

Atlas is the combined product and absorbs [Trailhead](../trailhead/README.md) (decided 2026-10-02). Kept from Trailhead: explicit goal → detour → return, departure snapshot, one-shot return packet, promote, marks, detour outcomes and exclusions, explicit decisions, project-folder save files, and recovery from earlier sessions including Trailhead's own checkpoints. Trailhead stays installed until the user retires it.

| Concept | In this prototype |
|---|---|
| Conversation Atlas: observes and maps | topics/path, activity, files, prompts trail, observed decisions/questions |
| Trailhead: explicit goals, detours, returns | confirmed goal, detour with departure snapshot, return packet, promote |
| Checkpoints: moments and evidence | commits, tests passing after edits, Claude-reported milestones, your marks |
| Context Ledger: settled knowledge | decisions you **Settle** (Evidence → Settled) |

## UX

- **Pane** (`Atlas`): opens unasked at session start. It docks beside the transcript in the fullscreen layout at ≥144 columns. Below that width it waits until you open it. The footer always shows an Atlas button (`● current topic · N`) that opens it at any width, inline if needed. `/atlas` does the same.
- **Layout**: a centered `─── Conversation Atlas ───` rule (just `Atlas` under 34 columns) · tab bar · self-scrolling body (wheel, PgUp/PgDn, or ▲▼ buttons) · menu drawer · app bar pinned to the pane bottom.
- **App bar menus**: hotkeys Legend `l`, ◇ decisions `d`, ? open questions `q`, ◆ checkpoints `c`, + Mark `k`. A menu opens in a drawer above the bar, its button shows ` ^` while open, press again to close, one menu at a time. The Legend explains every glyph and colour. While it is open every section heading shows a one-line note on what the section is for, and the tab bar says what the current tab answers.
- **Resize-friendly**: the bar has full (`◇ 3 decisions`), mid (`◇3 dec`) and tiny (`◇3`, `≡` for Legend, no hotkey labels; under 40 cols) widths. Tab names shorten under 46 columns. If fewer than 4 body rows fit, the pane stops pinning and lets Claude Code scroll it.
- **Tabs** (hotkeys `m t o e` while the pane is focused):
  - **Map**: ◎ goal, current path tree (current node pulses when it is new), ↳ possible detour / active detour, live activity (spinner and shimmer while a tool runs, ✓/✗ after), working set, latest decisions/questions, ▸ resume next.
  - **Trail**: the whole topic tree, then a chronological trail of prompts, topic shifts, decisions, detours, returns and checkpoints.
  - **Open**: everything waiting for a yes/no: suggestions (goal, detour, return, next step, resume), observed decisions (**Settle**/**Drop**; decisions observed during a detour get **Keep**/**Exclude** instead), open questions (**Resolved**).
  - **Evidence**: checkpoints (click one to expand goal/topic/files at that moment), the settled ledger, resolved questions, past detours, files, and earlier sessions (Atlas or Trailhead) with a **Resume this** button.
- **Selection → context**: click any decision, question, topic, checkpoint or file. Your next message carries it to Claude once ("this" refers to it), the same way filetree passes its selected file. `✕` clears it.
- **Glyphs**: ◎ confirmed goal · ○ suggestion · ● current topic · ↳ detour · ↩ return · ◇ observed decision · ◆ settled decision / checkpoint · ? open question · ✦ just observed.

## Joining a conversation late

Atlas is installed for your user, so it loads in every new session, and in a running one after `/reload-plugins`. When it joins a session that already has history (a pre-existing thread, a resume with no save, an install mid-session):

- **On launch, free:** it replays the earlier messages (`$.session.messages()`): your prompts and their wording cues, the goal suggestion, files read and edited, test and commit checkpoints, and a question left open at the end.
- **On request, one cached request:** `/atlas scan`, or **Map earlier conversation** in the Trail tab, asks Claude once over the session's own transcript (`$.model.fork`, mostly served from the prompt cache) for topics, decisions, open questions and a next step. Everything it returns is an observation, so confirm what is true in the Open tab.
- **Setting `scanOnLaunch`:** `engine` (default, free replay), `claude` (replay plus the one-request map on launch) or `off`.

## Commands

Everything is under `/atlas`. `/atlas help` lists them.

| Command | Does |
|---|---|
| `/atlas` | open the pane |
| `goal <text>` (alias `aim`) | set your goal |
| `next <step>` | pin the next step |
| `mark [name]` | add a marked checkpoint |
| `decision <text> [--reason <why>]` | record a settled decision |
| `detour <reason>` | take a detour |
| `outcome <finding>` / `exclude <material>` | record a detour finding (detour only) |
| `return` | return from the detour, emit the return packet |
| `promote` | promote the detour to the goal |
| `scan` | map the conversation so far with Claude (one cached request) |
| `/atlas recover [n]` | list earlier Atlas + Trailhead sessions, or resume number n |
| `reset` | clear this session's map (saved files and earlier sessions are kept) |

## What updates itself vs. what needs you

| Automatic (observation) | Needs your confirmation (intent) |
|---|---|
| Topic path and possible detours (from Claude's `observe` calls) | Goal (Set as goal / type it / `/atlas goal`) |
| Activity: reads, searches, edits, Bash, tests, git, web, subagents (engine) | Taking a detour (Take detour / `/atlas detour`) |
| Working set: files read/written, counts (engine) | Returning: emits the return packet (Return / `/atlas return`) |
| Checkpoints: commits, passing tests after edits, milestones | Promoting a detour to the goal |
| Observed decisions and open questions (Claude, your wording, AskUserQuestion, a reply ending in "?") | Settling a decision into the ledger |
| Suggested next step, goal suggestion from your first request | Pinning a next step, adopting last session's goal (Resume) |
| Earlier sessions found on disk | Resuming one (Resume this / `/atlas recover n`) |
| | Keep / Exclude for detour findings |

## Events and APIs

One hooks module (`hooks/register.tsx`) plus pure `model.ts` (reducers), `activity.ts` (tool classification), `view.tsx` (pane tree), `recall.ts` (save-file format, Atlas/Trailhead readers) and the surface module `live.tsx` (animation).

- `session.start`: bind/restore state, `$.tool.register` (`observe`), `$.command.register` (`atlas`), `$.ui.open`, `$.clock.every` for saving.
- `prompt.compose`: one static rules section (`scope: 'session'`) telling Claude when to call `observe`.
- `prompt.submit` (composer/bridge only): attaches the pending return packet and the pane selection once. While you have confirmed intent, it also adds one line: `Conversation Atlas, confirmed by the user: goal …; on a detour …`.
- `turn.start`: turn count, prompt trail, wording cues. `turn.complete`: a reply ending in a question that Claude did not report.
- `tool.call` (all tools): activity rows, files, test and commit checkpoints (`gitOperation.commit`), AskUserQuestion questions, ExitPlanMode decisions. `tool.call {observe}` answers Claude's report. `agent.spawn` names subagents.
- `ui.render` `Pane {atlas}` and `SessionMode` (footer button). `Client` module `live.tsx` for spinners and shimmer on terminal and desktop; plain text on vscode/mobile.
- `ui.scroll` on `Pane {atlas}`: the pane scrolls its own body (`view.scroll`, clamped to an estimate of the body's rows from `rowsOf`) so the app bar stays pinned. Implemented as a height=bodyRows column with an overflow-hidden window and negative `marginTop`.
- State: `$.state` `conversation-atlas.snapshot` / `.view`, written with `update` (CAS). Durable: `$.store` `session:<id>` (restored on resume) and `project:<root>` (offered as **Resume** in the next new session of the same project). Keeps the last 12 sessions. Project-local copy `<project>/.claude/atlas/<session>.json`, written on the 2 s save timer when there is a goal, topics or decisions. Earlier sessions are read from there and from Trailhead's `.claude/trailhead/*.json` (highest checkpoint per session).

No network, no telemetry. The only model cost is Claude's own `observe` tool calls in the normal session, about a few dozen tokens per call. Its rules sit in the cached system prompt. The `engine only` setting turns that off.

## Install and run

Atlas is a **working product** (promoted 2026-10-02) with a private, user-level install. Every new Claude Code session loads it as `conversation-atlas@skills-dir`. Nothing is published. After changing the source, update the installed copy and reload:

```powershell
.\scripts\install-atlas.ps1     # validates, backs up the old copy, installs, validates again
```

Then `/reload-plugins` in a running session. To try a change without installing it, use `claude --plugin-dir .\MyMods\conversation-atlas`, or hot reload from a plugin-authoring session. Never use either while the installed copy is enabled in that session: two copies of one plugin would both load. For a docked pane use `/tui fullscreen` and a terminal at least 144 columns wide, or click the footer Atlas button.

Configuration (`/config` → conversation-atlas, or `pluginConfigs` in settings):

- **Observer**: `claude and engine` (default) or `engine only` (no tool, no rules, no tokens; topics then stay empty).

## Validation

```powershell
claude plugin validate .\MyMods\conversation-atlas
claude plugin test .\MyMods\conversation-atlas
```

Last result (2026-10-02, Claude Code 2.1.288): validate passed. Runtime tests **11/11 passed**, grouped as model invariants, hooks, merge (exclusions in the return packet; a Trailhead checkpoint listed and resumed via `/atlas recover`) and late join (free replay on launch, `/atlas scan` through one fork) and readability (title rule at two widths, Legend opens and shows ` ^`, section notes, one menu at a time, tiny-width bar, pinned bar with body scrolling). `tsc --strict` clean against the build's generated declarations.

Live acceptance (2026-10-02): hot-reloaded into the authoring session. The engine loaded the module and generated its `.claude-plugin/types/`. Real Read/Edit/Bash/test calls in that session fed the pane. Claude's `observe` tool reaches the model from the prompt after a (re)load, not in the turn that loads it. On 2.1.288 the observe tool, `/atlas` and pane selection → prompt context were seen working live.

## Limitations and assumptions

- Topic quality depends on Claude calling `observe`. Engine-only mode has activity, files and checkpoints but no topic path.
- Wording cues (`btw`, `quick tangent`, `back to the main…`, `let's go with…`) are English regexes. They only ever create suggestions.
- One active detour (Trailhead's rule). Nested detours appear as topics inside the detour branch.
- Topic "return" matching is fuzzy (shared words). A wrong match moves the observed path only, never intent.
- The docked placement depends on the terminal's fullscreen layout and width. Runtime tests check tree validity, not paint or mouse behaviour. Hot-reload acceptance is manual.
- The scroll limit is an estimate (wrapped text is approximated), so the end may sit a row off.
- Recovery reads at most 80 files per folder and lists 12 sessions. Resuming a Trailhead trail restores goal, next step and main-goal decisions; an active detour comes back only as a suggestion.

## Next

1. Retire Trailhead (disable `trailhead@skills-dir`) once Atlas has replaced it in daily use, then decide whether Atlas gets a private install like Trailhead had.
2. Rich desktop surface: an `Svg` timeline of the session (topics as lanes, detours as branches, checkpoints as pins), the way plan-progress draws its track.
3. Checkpoints with evidence: attach the test output or commit diff stat, and offer "rewind context to here" packets.
4. Context Ledger: settled decisions exported to a project file Claude reads at session start, with an explicit review step.
5. A cheap end-of-session `$.model.fork` summary as a resume note, opt-in, shown before it is saved.
6. Transcript markers: hover-scope a pane topic and the transcript rows it covers.
