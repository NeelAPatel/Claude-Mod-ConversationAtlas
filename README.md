<div align="center">

# 🗺️ Conversation Atlas

**A live map of your Claude Code session: where you started, where you are, and how to get back.**

[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.287%2B-d97757)
![Telemetry](https://img.shields.io/badge/telemetry-none-brightgreen)
![Status](https://img.shields.io/badge/status-early%20release-orange)

</div>

<!--
  DEMO VIDEO: on GitHub, edit this file in the web editor (or open any issue), drag
  "readme media/Video Project 1.mp4" into the text box, and paste the generated
  https://github.com/user-attachments/assets/... URL on its own line right below this comment.
  GitHub turns a bare asset URL into an inline player. Keep the 60 MB file out of git history.
-->

Long Claude Code sessions drift. A quick tangent turns into an hour, a decision made early gets
lost in scrollback, and after a break nobody remembers what "next" was.

Atlas is a Claude Code plugin that adds a **side pane** which maps the session while you work:

- 🎯 **your goal**, and the path of topics that led here
- ↳ **detours** you took, with a snapshot of where you left off
- ◆ **decisions and open questions** you would otherwise lose
- 📍 **checkpoints** (commits, passing tests, your own marks) and the files in play
- ▸ **what to resume next**

> **Observation never becomes intent without you.** Atlas can *suggest* a goal, a detour or a
> return. Only you turn a suggestion into intent, with a button press or an `/atlas` command.

## Why you might want it

| Without Atlas | With Atlas |
|---|---|
| "Wait, what were we doing?" | The goal and current topic are always on screen |
| A tangent swallows the session | `/atlas detour` marks where you left; `/atlas return` brings Claude back up to speed in one packet |
| Decisions buried in scrollback | A ledger of settled decisions and who is still waiting on an answer |
| Starting cold after lunch | Sessions are saved per project and offer **Resume** |

## Install

Requires **Claude Code 2.1.287+** (terminal or desktop Code tab). To dock the pane beside the
transcript, use `/tui fullscreen` in a terminal at least 144 columns wide; otherwise open it from
the footer button.

```bash
git clone https://github.com/NeelAPatel/Claude-Mod-ConversationAtlas.git
cd Claude-Mod-ConversationAtlas
claude --plugin-dir .
```

**Install for your user (Windows):** `.\scripts\install-atlas.ps1` validates the plugin and
installs it to `~/.claude/skills/conversation-atlas`; then run `/reload-plugins` in a running
session. Don't combine this with `--plugin-dir` in the same session, or two copies load.

## 60-second tour

1. **Start a session.** The Atlas pane opens and asks you to choose an observer mode:
   - **Claude observer**: Claude reports topic shifts, decisions and questions through a tiny
     tool. Costs a little usage on turns where something changed.
   - **Engine only (free)**: Atlas uses just files, activity, tests, commits and your wording.
2. **Set a goal:** `/atlas goal ship the login refactor`
3. **Wander:** `/atlas detour check the flaky test`
4. **Come back:** `/atlas return`. Claude gets a short packet describing exactly where you were.

Joining mid-session? Atlas replays the earlier conversation for free, and `/atlas scan` can map
it with a single, mostly cached Claude request.

### The four tabs

| Tab | Key | What it shows |
|---|---|---|
| **Map** | `m` | Goal, current topic path, detours, live activity, working set, resume next |
| **Trail** | `t` | Full topic tree and a timeline of prompts, shifts, decisions, detours, checkpoints |
| **Open** | `o` | Everything waiting on you: suggestions, decisions to settle, open questions |
| **Evidence** | `e` | Checkpoints, settled-decision ledger, past detours, files, earlier sessions |

The bottom bar holds **Legend** (`l`), **◇ decisions** (`d`), **? questions** (`q`) and
**+ Mark** (`k`). **Add to message** on any item drops an `[Atlas #n: …]` chip into your draft;
only chips still in the text when you send are passed to Claude.

Full pane behaviour, glyphs and internals: [docs/REFERENCE.md](docs/REFERENCE.md).

## Commands

Everything is under `/atlas` (`/atlas help` lists them).

| Command | Description |
|---|---|
| `/atlas` | Open the pane |
| `/atlas goal <text>` | Set your goal |
| `/atlas next <step>` | Pin the next step |
| `/atlas mark [name]` | Add a marked checkpoint |
| `/atlas decision <text> [--reason <why>]` | Record a settled decision |
| `/atlas detour <reason>` | Take a detour |
| `/atlas outcome <finding>` / `/atlas exclude <material>` | Record or exclude a finding made during a detour |
| `/atlas return` | Return from the detour and send the return packet |
| `/atlas promote` | Promote the current detour to the goal |
| `/atlas scan` | Map the conversation so far (one cached Claude request) |
| `/atlas observer [claude\|engine]` | Show or change the observer mode |
| `/atlas setup` | Show the setup screen again |
| `/atlas recover [n]` | List earlier sessions, or resume number *n* |
| `/atlas reset` | Clear this session's map (saved files are kept) |

## Configuration

Open `/config` → **conversation-atlas**, or set `pluginConfigs` in your settings.

| Setting | Values | Default | Effect |
|---|---|---|---|
| `observer` | `claude and engine`, `engine only` | `claude and engine` | Preselected choice on the first-run setup screen. After setup, the stored choice wins (`/atlas observer`). |
| `scanOnLaunch` | `engine`, `claude`, `off` | `engine` | What happens when Atlas joins a session that already has history. |

## Privacy and cost

- **No network calls, no telemetry.** All data stays on your machine.
- **Nothing costs Claude usage before you choose a mode.** Engine-only mode is free.
- **Claude observer mode** adds one cached rules section to the system prompt, plus a small
  `observe` call (a few dozen tokens) on turns where something changed. Measured at about 0.8% of
  usage on day one, Opus only.
- **What Atlas sends to Claude:** the rules section (Claude mode only), a one-line note of your
  *confirmed* goal and detour, a pending return packet, and any chips you left in your message.
  Observed items are never presented to Claude as settled facts.
- **Where it saves:** Claude Code's plugin store, plus `<project>/.claude/atlas/<session>.json`.
  Add `.claude/atlas/` to your `.gitignore` if you don't want session maps committed.

## Limitations

- In engine-only mode there is no topic path; topic quality depends on Claude calling `observe`.
- Wording cues such as "btw" or "quick tangent" are English-only, and only ever create suggestions.
- One detour at a time. Nested tangents appear as topics inside the detour.
- Matching a return to an earlier topic is fuzzy; a wrong match moves only the observed path,
  never your intent.
- Docking depends on the fullscreen layout and terminal width.

## Roadmap

- [ ] Graphical timeline on desktop: topics as lanes, detours as branches, checkpoints as pins
- [ ] Checkpoints that attach test output or a diff stat, with "rewind context to here"
- [ ] Export the settled-decision ledger to a project file Claude reads at session start
- [ ] Opt-in end-of-session summary as a resume note, shown before it is saved
- [ ] Link pane topics to the transcript rows they cover

## Contributing

Bug reports, ideas and PRs are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); security
issues go through [SECURITY.md](SECURITY.md). Architecture and invariants live in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) © 2026 NeelAPatel. Atlas replaces the earlier Trailhead plugin and keeps its
goal → detour → return model; `/atlas recover` still reads Trailhead checkpoints.
