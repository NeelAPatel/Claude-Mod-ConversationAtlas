# Conversation Atlas (v0 prototype)

A self-updating companion pane for long Claude Code sessions. As you work normally, it maps
where the session is: your goal, the current path through topics, possible detours, decisions,
open questions, checkpoints, the files in play, live activity and what to resume next.

**Core rule: it observes on its own and never rewrites your intent on its own.** Claude and the engine
can *propose* a goal, a detour or a return. Only you turn a proposal into intent, by pressing a button in the pane or typing `/atlas …`.

Evolves [Trailhead](../trailhead/README.md). Trailhead's explicit goal → detour → return model, its departure
snapshot and its deterministic return packet are kept. Conversation Atlas adds an observation layer that fills itself in.

| Concept | In this prototype |
|---|---|
| Conversation Atlas: observes and maps | topics/path, activity, files, prompts trail, observed decisions/questions |
| Trailhead: explicit goals, detours, returns | confirmed goal, detour with departure snapshot, return packet, promote |
| Checkpoints: moments and evidence | commits, tests passing after edits, Claude-reported milestones, your marks |
| Context Ledger: settled knowledge | decisions you **Settle** (Evidence → Settled) |

## UX

- **Pane** (`Atlas`): opens unasked at session start. It docks beside the transcript in the fullscreen layout at ≥144 columns. Below that width it waits until you open it. The footer always shows an Atlas button (`● current topic · N`) that opens it at any width, inline if needed. `/atlas` does the same.
- **Tabs** (hotkeys `m t o e` while the pane is focused):
  - **Map**: ◎ goal, current path tree (current node pulses when it is new), ↳ possible detour / active detour, live activity (spinner and shimmer while a tool runs, ✓/✗ after), working set, latest decisions/questions, ▸ resume next.
  - **Trail**: the whole topic tree, then a chronological trail of prompts, topic shifts, decisions, detours, returns and checkpoints.
  - **Open**: everything waiting for a yes/no: suggestions (goal, detour, return, next step, resume), observed decisions (**Settle**/**Drop**), open questions (**Resolved**).
  - **Evidence**: checkpoints (click one to expand goal/topic/files at that moment), the settled ledger, resolved questions, past detours, files.
- **Selection → context**: click any decision, question, topic, checkpoint or file. Your next message carries it to Claude once ("this" refers to it), the same way filetree passes its selected file. `✕` clears it.
- **Glyphs**: ◎ confirmed goal · ○ suggestion · ● current topic · ↳ detour · ↩ return · ◇ observed decision · ◆ settled decision / checkpoint · ? open question · ✦ just observed.

## What updates itself vs. what needs you

| Automatic (observation) | Needs your confirmation (intent) |
|---|---|
| Topic path and possible detours (from Claude's `observe` calls) | Goal (Set as goal / type it / `/atlas goal`) |
| Activity: reads, searches, edits, Bash, tests, git, web, subagents (engine) | Taking a detour (Take detour / `/atlas detour`) |
| Working set: files read/written, counts (engine) | Returning: emits the return packet (Return / `/atlas return`) |
| Checkpoints: commits, passing tests after edits, milestones | Promoting a detour to the goal |
| Observed decisions and open questions (Claude, your wording, AskUserQuestion, a reply ending in "?") | Settling a decision into the ledger |
| Suggested next step, goal suggestion from your first request | Pinning a next step, adopting last session's goal (Resume) |

## Events and APIs

One hooks module (`hooks/register.tsx`) plus pure `model.ts` (reducers), `activity.ts` (tool classification), `view.tsx` (pane tree) and the surface module `live.tsx` (animation).

- `session.start`: bind/restore state, `$.tool.register` (`observe`), `$.command.register` (`atlas`), `$.ui.open`, `$.clock.every` for saving.
- `prompt.compose`: one static rules section (`scope: 'session'`) telling Claude when to call `observe`.
- `prompt.submit` (composer/bridge only): attaches the pending return packet and the pane selection once. While you have confirmed intent, it also adds one line: `Conversation Atlas, confirmed by the user: goal …; on a detour …`.
- `turn.start`: turn count, prompt trail, wording cues. `turn.complete`: a reply ending in a question that Claude did not report.
- `tool.call` (all tools): activity rows, files, test and commit checkpoints (`gitOperation.commit`), AskUserQuestion questions, ExitPlanMode decisions. `tool.call {observe}` answers Claude's report. `agent.spawn` names subagents.
- `ui.render` `Pane {atlas}` and `SessionMode` (footer button). `Client` module `live.tsx` for spinners and shimmer on terminal and desktop; plain text on vscode/mobile.
- State: `$.state` `conversation-atlas.snapshot` / `.view`, written with `update` (CAS). Durable: `$.store` `session:<id>` (restored on resume) and `project:<root>` (offered as **Resume** in the next new session of the same project). Keeps the last 12 sessions.

No network, no telemetry. The only model cost is Claude's own `observe` tool calls in the normal session, about a few dozen tokens per call. Its rules sit in the cached system prompt. The `engine only` setting turns that off.

## Run

```powershell
claude --plugin-dir .\MyMods\conversation-atlas
```

Or hot-reload it in a session that loaded the plugin-authoring skill, from the session's dev-mods folder. For a docked pane use `/tui fullscreen` and a terminal at least 144 columns wide, or click the footer Atlas button.

Configuration (`/config` → conversation-atlas, or `pluginConfigs` in settings):

- **Observer**: `claude and engine` (default) or `engine only` (no tool, no rules, no tokens; topics then stay empty).

## Validation

```powershell
claude plugin validate .\MyMods\conversation-atlas
claude plugin test .\MyMods\conversation-atlas
```

Last result (2026-10-02, Claude Code 2.1.287): validate passed. Runtime tests **5/5 passed**: model invariants (observation never sets goal/detour; detour departure snapshot; one-shot return packet; wording cues only suggest) and hooks (tool/command registration, engine events → pane on terminal and desktop, press-to-confirm goal and detour, return packet attached to exactly one prompt). `tsc --strict` clean against the build's generated declarations.

Live acceptance (2026-10-02): hot-reloaded into the authoring session. The engine loaded the module and generated its `.claude-plugin/types/`. Real Read/Edit/Bash/test calls in that session fed the pane. Claude's `observe` tool reaches the model from the prompt after a (re)load, not in the turn that loads it.

## Limitations and assumptions

- Topic quality depends on Claude calling `observe`. Engine-only mode has activity, files and checkpoints but no topic path.
- Wording cues (`btw`, `quick tangent`, `back to the main…`, `let's go with…`) are English regexes. They only ever create suggestions.
- One active detour (Trailhead's rule). Nested detours appear as topics inside the detour branch.
- Topic "return" matching is fuzzy (shared words). A wrong match moves the observed path only, never intent.
- The docked placement depends on the terminal's fullscreen layout and width. Runtime tests check tree validity, not paint or mouse behaviour. Hot-reload acceptance is manual.
- `$.store` is plugin-global, not project-scoped on disk. Trailhead's project-local `.claude/trailhead/` checkpoints are not read yet.

## Next

1. Import Trailhead checkpoints (`.claude/trailhead/*.json`) as Resume candidates. Then retire Trailhead's separate HUD.
2. Rich desktop surface: an `Svg` timeline of the session (topics as lanes, detours as branches, checkpoints as pins), the way plan-progress draws its track.
3. Checkpoints with evidence: attach the test output or commit diff stat, and offer "rewind context to here" packets.
4. Context Ledger: settled decisions exported to a project file Claude reads at session start, with an explicit review step.
5. A cheap end-of-session `$.model.fork` summary as a resume note, opt-in, shown before it is saved.
6. Transcript markers: hover-scope a pane topic and the transcript rows it covers.
