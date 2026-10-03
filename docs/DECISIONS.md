# Decision log: how Atlas got here (2026-10-02 → 2026-10-03)

The history of the chat that built Atlas: `457af068…`, started in `F:\LocalProj\ClaudeModsExperimentation`, earlier work in `283f7a43…`. Newest last. **Bold** marks a user decision. Read it with `AGENTS.md` (the invariants) and `docs/HANDOFF-ui-architecture.md` (the next work).

## 1. Product framing

- The user's idea: **Conversation Atlas**, a self-updating companion pane for long Claude Code sessions. It tracks the goal, where the work has gone, the current topic, deliberate and possible detours, returns, decisions, open questions, checkpoints, the files in play, activity, and what to resume next. **No constant management by commands.**
- The four concepts form one product. Atlas observes and maps. Trailhead handles explicit goals, detours and returns. Checkpoints preserve moments and evidence. The Context Ledger holds settled knowledge.
- **Core principle: Atlas may observe on its own. It must never silently rewrite intent.** It may say "Possible detour: X" but never changes the goal or declares a detour real. That became the hard invariant that observation never writes intent (see `AGENTS.md`).
- References studied: `data-goblin/claude-code-filetree` (docked live pane, shimmer on read/write, mouse, selection as context) and `zycck/claude-mods` plan-progress (live state from engine events, a model-called tool, `$.store` persistence, a richer desktop surface).

## 2. Architecture choices

- One hooks module (`register.tsx`) with pure modules: `model.ts` (reducers), `activity.ts`, `view.tsx`, and later `recall.ts` and `scan.ts`. `live.tsx` is a `Client` surface module for animation.
- Three observation feeds:
  - engine events: tool calls, files, tests, commits, agents, AskUserQuestion, ExitPlanMode
  - the person's wording: the first request becomes a goal suggestion; `btw`, `back to the main…` and `let's go with…` cues
  - Claude, via a registered `observe` tool and a cached rules section in the system prompt
- Intent changes only through a pane press or `/atlas …`.
- Trailhead semantics kept: one goal, one detour, departure snapshot, one-shot deterministic return packet, promote, marks, "not recorded".

## 3. Loading problems (lessons)

- A hot-reloaded mod lives only as long as its Claude Code process. A CLI auto-update (2.1.287 → 2.1.288) gave the session a new dev-mods folder, so Atlas silently stopped loading. Hence the private install.
- Registration moved into an idempotent `setup()` that runs on the first event, logs each failed step and retries.
- State kept from older builds can lack new fields. The Evidence tab crashed on `s.recall.length`, so `upgrade()` now fills missing fields on every read and write.

## 4. Trailhead → Atlas

- **The user committed to combining both products** and **chose the short name "ConversationAtlas (Atlas)"**.
- **All Trailhead commands moved under `/trailhead <subcommand>`** (no generic `/aim`, `/return`…). Then Atlas absorbed the features: Keep/Exclude for detour findings (exclusions in the return packet), `/atlas decision|outcome|exclude|recover`, `.claude/atlas/` project saves, and recovery of Atlas and Trailhead sessions.
- **The user retired Trailhead** (disabled, kept for reference) and **promoted Atlas to a working product** (with EnvVault), permitting a private user-level install at `~/.claude/skills/conversation-atlas`.

## 5. Readability and UX iterations (terminal)

- The user cannot tell what icons mean in a TUI. That led to a pinned bottom app bar, a Legend, and section explanations while the Legend is on.
- **No `^` markers.** **No brackets requirement for open menus** (dimming shows state).
- Centered `─── Conversation Atlas ───` title rule.
- Trail sort toggle; body scrollbar; expandable truncated items.
- **Nothing reaches Claude without a deliberate, visible transfer.** Auto-sending a selection was rejected. **Message chips** replaced it: Add to message inserts `[Atlas #n: …]` into the draft, and only chips still present are sent. It works like `[Pasted text #1]`.
- **Clicks only, no hover cards.**
- **Three UI paradigms, one rule ("if it can be hovered, it is interactive"):**
  - expansion: inline details, like Evidence → checkpoint
  - toggles: Legend, sort
  - popups/menus: bordered, EnvVault style
- **Popups must be small, anchored to where they open, and scrollable.** No full-pane popups. Fixed bottom clipping: newline-aware sizing, clamped placement.
- **Legend is a toggle, not a menu.** It sits above the bottom bar: "How to use" first, then LEGEND. The bottom bar holds Legend, ◇ decisions menu, ? open menu and + Mark (the checkpoints menu was dropped; Evidence has it).
- **Goal expands** to show who set it and the **detected goal** (observation), with an explicit "Use this as my goal".
- **Colours:** one primary action per group (accent), other actions in cyan `[ ]` chrome (buttons have no rest colour). The active tab is coloured text (Map yellowBright like the status line directory, Trail light green, Open pink, Evidence blue). Glyph colours come from one table shared with the Legend.
- Activity times right-aligned; working-set counts readable (`3 edits · 2 reads · 1m`).
- Decisions popup titled "DECISIONS MADE · N settled · N heard", with `▲ n/m ▼` together; scan progress bar.

## 6. Late joins and cost

- Atlas installed mid-thread replays earlier messages for free. `/atlas scan` maps topics through one `$.model.fork`. **User report (2026-10-03): scanning earlier threads produces little or no data.** Investigate this; it may be fork size or limits, or parse failures.
- A side agent flagged the observer's cost. Measured: **≈0.76% of usage on day one, Opus only; subagents 0%.** The extra round-trip after each `observe` dominates.
- **The user decided: consent before cost.** A first-run setup asks Claude observer vs Engine only (free). Nothing costs usage before the choice. Engine-only dims what it disables. `/atlas observer`, `/atlas setup`.

## 7. Process rules the user set

- **Visible agents only:** external agents (Codex) run interactively in a named Windows Terminal tab, never headless, so the user can watch and steer. Saved globally in `~/.claude/CLAUDE.md`.
- **For Atlas: Claude only delegates and reviews.** Codex `gpt-5.6-luna` at `xhigh` implements, and Claude briefs, verifies, installs and commits.
- **Answer style (global):** structured for multi-fact replies, prose for single judgements, the answer first, what needs the user last.
- **Usage-awareness:** when usage is low, push heavy work to Codex or cheaper subagents.

## 8. Repo moves

- **Atlas moved to its own repo** `F:\LocalProj\Claude-Mod-ConversationAtlas`, with history via `git subtree split`. Its chats were copied here, along with the `atlas-readme` worktree's README rewrite (ported). The `neo-prefix` worktree is not Atlas-related and stayed. Open question: `/atlas` → `/neo-atlas`?
- **Small commits now. On publication: a new single-commit repo** (a separate decision).
- **Desktop (GUI) is janky because one view serves both surfaces with terminal assumptions.** The user proposed, and Claude agreed, **engine + standardized TUI and GUI interfaces with a UI library**. See `docs/HANDOFF-ui-architecture.md`.
- **New rule: anything longer than 4 lines goes in a scrollable popup, except the Legend.** The Legend must get more compact.

## Open items

- The milestones in `docs/HANDOFF-ui-architecture.md`.
- Investigate `/atlas scan` producing little or no data.
- Whether `/atlas` should get the `neo-` prefix.
- Remove the old `atlas-readme` worktree in ClaudeModsExperimentation once its session closes.
- Publication (GitHub or marketplace): not decided.
