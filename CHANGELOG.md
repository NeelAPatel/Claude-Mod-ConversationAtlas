# Changelog

Versions follow [semver](https://semver.org). The version lives in `.claude-plugin/plugin.json`
only. Each release is a git tag `vX.Y.Z` on `main`.

## v0.1.0 — first release

First public release of Conversation Atlas: a live map of a Claude Code session in a side pane, in the terminal and in the desktop Code tab.

- **Four tabs:** Map (goal, current path, detours, activity, working set, resume next), Trail (topic tree and a timeline), Open (everything waiting on you), Evidence (checkpoints, settled decisions, past detours, files, earlier sessions). Every section is always shown, with a one-line text when empty.
- **Intent stays yours:** one goal and one detour at a time, changed only by a press in the pane or an `/atlas` command. Atlas suggests goals and detours; nothing is confirmed until you press Confirm, Switch back, Take detour or Return.
- **Detours and returns:** taking a detour freezes the goal, topic, next step and settled decisions; Return sends one packet to Claude with your next message.
- **Decisions and questions:** observed decisions are weighted major or minor (you can override); Confirm, Drop, Reopen and Chat ⇒ buttons; `Chat ⇒` puts an `[Atlas #n: …]` chip in your draft.
- **Prompts that arrive wrapped** (quote replies, system notices) are read by their real text for cues and titles.
- **Legend** with a collapsible How to use, Observer mode and a `pane: N columns` line.
- **Recovery:** earlier sessions listed in Evidence or with `/atlas recover`.
- **Desktop pane:** native scrolling; Legend and + Mark on the tab strip. **Terminal:** wheel, keys and in-expansion scrolling.
- Atlas absorbed Trailhead's intent model (goal, detour, return packet). Trailhead checkpoint recovery, labels and wording were removed. Atlas save files are the only recovery source.
