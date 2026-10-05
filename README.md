<div align="center">

# 🗺️ Conversation Atlas

**A live map of your Claude Code session: where you started, where you are, and how to get back.**

[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.287%2B-d97757)
![Telemetry](https://img.shields.io/badge/telemetry-none-brightgreen)
![Status](https://img.shields.io/badge/status-early%20release-orange)

</div>

<div align="center">
  <video src="https://github.com/user-attachments/assets/112dd1f4-972a-4970-9733-741a9e0cf5d2" width="720" controls muted></video>
</div>

**Tame your Claude's conversation history.** Long Claude Code sessions drift: a quick tangent turns
into an hour, a decision made early gets lost in scrollback, and after a break nobody remembers
what "next" was. Conversation Atlas is a mod that hooks into your chats and adds a **side pane**
that detects and helps you manage your goals, decisions and even detours while you work:

- 🎯 **your goal**, and the path of topics that led here
- ↳ **detours** you took, with a snapshot of where you left off
- ◆ **decisions and open questions** you would otherwise lose
- 📍 **checkpoints** (commits, passing tests, your own marks) and the files in play
- ▸ **what to resume next**

> **Observation never becomes intent without you.** Atlas can *suggest* a goal, a detour or a
> return. Only you turn a suggestion into intent, with a button press or an `/atlas` command.

## Installation

**From the marketplace** (once v0.1.0 is on `main`):

```bash
claude plugin marketplace add NeelAPatel/Claude-Mod-ConversationAtlas
claude plugin install conversation-atlas@neel-cc-mods
```

Requires **Claude Code 2.1.287+** (terminal or desktop Code tab). To dock the pane beside the
transcript, use `/tui fullscreen` in a terminal at least 144 columns wide; otherwise open it from
the footer button or with `/atlas`.

**Try it from source** (the repository root is the plugin):

```bash
git clone https://github.com/NeelAPatel/Claude-Mod-ConversationAtlas.git
cd Claude-Mod-ConversationAtlas
claude --plugin-dir .
```

**Install for your user (Windows):** `.\scripts\install-atlas.ps1` validates the plugin and copies it
to `~/.claude/skills/conversation-atlas`. Run `/reload-plugins` in a session that is already open.
Don't combine this with `--plugin-dir` in the same session, or two copies load.

## Feature tour

### 1. Set up

On first launch the pane asks how Atlas should observe. Nothing costs Claude usage until you choose.

- **Claude observer** *(minimal usage cost, [read below](#privacy-and-cost))*: Claude reports topic
  shifts, decisions and questions through a tiny tool.
- **Engine only** *(free, no usage cost)*: Atlas uses just files, activity, tests, commits and your
  own wording.

Change it any time with `/atlas observer [claude|engine]`.

### 2. Goal, detour, return

- `/atlas goal ship the login refactor` sets the goal. Atlas also shows the goal it *detected*;
  **Use this as my goal** makes it yours.
- Goal suggestions and observed alternatives carry **auto**: picked by Atlas until you confirm
  or drop it. **✦** after a goal icon marks what this turn is about. It stays on your confirmed
  goal for one diverging turn and moves to an alternative after two consecutive observed turns
  on that topic; a matching topic returns it to your goal. **Switch to this** confirms an
  alternative. Observation never changes your goal or adds a focus event to Trail.
  **✦** before an icon still means just changed.
- `/atlas detour check the flaky test` snapshots where you left off and starts a side trip.
  Decisions made during it are kept as its outcomes.
- `/atlas return` ends the detour and sends Claude **one short packet**: the goal, topic, next step
  and settled decisions from the moment you left. `/atlas promote` makes the detour the new goal.

### 3. The pane

| Tab | Key | What it shows |
|---|---|---|
| **Map** | `m` | Goal, current topic path, detours, live activity, working set, resume next |
| **Trail** | `t` | Topic tree and a timeline of prompts, shifts, decisions, detours, checkpoints |
| **Open** | `o` | Everything waiting on you: suggestions, decisions to settle, open questions |
| **Evidence** | `e` | Checkpoints, settled-decision ledger, past detours, files, earlier sessions |

The bottom bar holds **Legend** (`l`), **decisions** (`d`), **open questions** (`q`) and **+ Mark**
(`k`). **Chat ⇒** on any item puts an `[Atlas #n: …]` chip in your draft; only chips still
there when you send reach Claude. Details: [docs/REFERENCE.md](docs/REFERENCE.md).

Open decisions use **Confirm** / **Drop** (detour findings keep **Keep** / **Exclude**).
Open questions take **Confirm** (answered) and **Drop**; resolved questions keep **Reopen**. Claude can also report them answered.
Inline expansions end with a right-justified **✕**; their other actions wrap on the left.

Decisions show `!` for major choices and a dim `·` for minor ones after their icon.
Atlas assigns weight from deterministic text cues; expand a decision and press
**Make minor** or **Make major** to override it. The detail shows `auto` or `you`.
Weight changes preserve confirmation status and add no Trail event or intent.


### 4. Recovering and scanning earlier conversations

Atlas can pick up a chat it wasn't watching, or one you left yesterday.

| Situation | What happens | Cost |
|---|---|---|
| **Atlas installed or reloaded mid-chat**, or you resume an old chat | Atlas replays the earlier messages: your prompts, files read and edited, test and commit checkpoints, a goal suggestion, and a question left open | Free |
| **You want topics and decisions for that history** | `/atlas scan` (or **Map earlier conversation** in Trail) asks Claude once over the session's own transcript. Results are observations; confirm what is true in the Open tab | One mostly cached request |
| **A new session in the same project** | Atlas offers to **Resume** the last goal | Free |
| **Older sessions** | `/atlas recover` lists them; `/atlas recover 2` resumes number 2. **Evidence → Earlier sessions** does the same with buttons | Free |

Two ways to resume an earlier session:

- **Resume this** brings back its goal, next step and settled decisions and keeps your current map.
- **Resume full** (Atlas saves only) *replaces* the current map with the saved one, after a confirm:
  `/atlas recover <n> full confirm`.

Nothing is adopted automatically; every resume is an explicit press or command. Set
`scanOnLaunch` to `claude` to also run the one-request scan whenever Atlas joins a chat that
already has history.

## Commands and configuration

Everything is under `/atlas` (`/atlas help` lists them).

| Command | Description |
|---|---|
| `/atlas` | Open the pane |
| `/atlas goal <text>` | Set your goal |
| `/atlas next <step>` | Pin the next step |
| `/atlas mark [name]` | Add a marked checkpoint |
| `/atlas decision <text> [--reason <why>]` | Record a settled decision |
| `/atlas detour <reason>` | Take a detour |
| `/atlas outcome <finding>` / `/atlas exclude <material>` | Keep or set aside a finding made during a detour |
| `/atlas return` | End the detour and send the return packet |
| `/atlas promote` | Promote the detour to the goal |
| `/atlas scan` | Map the conversation so far (one cached Claude request) |
| `/atlas recover [n]` / `/atlas recover <n> full [confirm]` | List earlier sessions, resume one, or replace the map with one |
| `/atlas observer [claude\|engine]` | Show or change the observer mode |
| `/atlas hide <b\|h>` / `show <b\|h>` / `filters` | Hide, show or list report-backs (b) and hand-offs (h) in Trail |
| `/atlas setup` | Show the setup screen again |
| `/atlas reset` | Clear this session's map (saved files are kept) |

Settings live in `/config` → **conversation-atlas**, or `pluginConfigs` in your settings:

| Setting | Values | Default | Effect |
|---|---|---|---|
| `observer` | `claude and engine`, `engine only` | `claude and engine` | Preselected choice on the setup screen. After setup, your stored choice wins |
| `scanOnLaunch` | `engine`, `claude`, `off` | `engine` | What Atlas does when it joins a chat that already has history |

## Privacy and cost

- **Local only.** Atlas makes no network calls and has no telemetry. It saves to Claude Code's plugin
  store and to `<project>/.claude/atlas/` (add that to `.gitignore` if you don't want session maps
  committed).
- **Engine-only mode costs nothing**, and neither does anything before you pick a mode.
- **Claude observer mode has a small usage cost.** It adds one cached rules section to the system
  prompt and a short `observe` tool call on turns where something changed. Each call re-reads the
  cached context, so the cost grows with chat length: in one long-session measurement it came to
  roughly 10% of that session's tokens. That is a known rough edge, and some hooks and updates
  will be optimized in future releases to bring it down. Until then, engine-only mode is the free
  option, and the observer is worth it when topic and decision tracking matters to you.
- **`/atlas scan`** is always an explicit action: one forked, mostly cached request.
- **What reaches Claude:** the rules section (Claude mode), a one-line note of your *confirmed* goal
  and detour (Claude mode), a pending return packet, and chips you left in your message. Observed
  items are never presented as settled facts.

## Limitations

- Engine-only mode has no topic path; topic quality depends on Claude calling `observe`.
- Wording cues like "btw" or "quick tangent" are English-only and only create suggestions.
- One detour at a time; nested tangents show as topics inside it.
- Matching a return to an earlier topic is fuzzy. A wrong match moves the observed path, never your intent.
- Docking needs the fullscreen layout and a wide terminal; scroll limits are estimates.
- Recovery reads at most 80 files per folder and lists 12 sessions.

## Roadmap

Ideas that build directly on what Atlas already captures:

- [ ] **End-of-session recap**: an opt-in summary of goal, decisions and next step, shown before it is saved as a resume note
- [ ] **Smarter resume**: open a new session with the recap and return packet ready to review
- [ ] **Prompt and output summaries** when you open an event in Trail (desktop first)
- [ ] **Decision ledger export** to a project file Claude can read at session start
- [ ] **Checkpoint detail**: attach test output or a diff stat to a checkpoint
- [ ] **Topic to transcript links**: jump from a pane topic to the messages it covers

## Contributing

Contributions are welcome: bug reports, ideas and pull requests. Read [CONTRIBUTING.md](CONTRIBUTING.md)
first; architecture and invariants live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[AGENTS.md](AGENTS.md), and security reports go through [SECURITY.md](SECURITY.md). Everyone
participating follows the [Code of Conduct](CODE_OF_CONDUCT.md).

*This is my first open-source project, so ideas, feedback and discussions are very welcome.*

## License

[MIT](LICENSE) © 2026 NeelAPatel.
