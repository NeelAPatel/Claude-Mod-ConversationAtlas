# History

ConversationAtlas (Atlas) started on 2026-10-02 in `F:\LocalProj\ClaudeModsExperimentation` as `MyMods/conversation-atlas`, branch `feature/conversation-atlas`. It evolved the Trailhead mod (explicit goals, detours, returns) into a self-updating session observatory, then absorbed Trailhead entirely. Trailhead was retired and disabled the same day. Its source stays in the experimentation repo for reference, and Atlas reads its saved trails through `/atlas recover`.

On 2026-10-02 the user promoted Atlas to a working product, with a private user-level install (`~/.claude/skills/conversation-atlas`), and moved it into this standalone repo. `git subtree split` kept the commit history of the mod folder; nothing in the source repo was rewritten.

Milestones, oldest first:

- v0 pane: goal, current path, activity, files, decisions, questions, checkpoints. The rule "observation never writes intent" dates from here.
- Hot-reload robustness: registration on first event, upgrades for old snapshots.
- Trailhead merge: Keep/Exclude for detour findings, `/atlas` subcommands, `.claude/atlas/` saves, recovery of Trailhead checkpoints.
- Readability: pinned app bar, Legend, section notes, title rule, scrollbar, trail sort.
- Joining late: free replay of earlier messages, `/atlas scan` through one `$.model.fork`.
- Deliberate transfer: message chips (`[Atlas #n: …]`) replaced auto-send.
- UI paradigms: expansion, toggles, small anchored popups; responsive bars; detected goal.
- Consent before cost: a first-run setup chooses the Claude observer or engine only, and engine-only dims what it disables. A measured cost of about 0.8% of usage (Opus only) on day one prompted this.
- Colours: primary and secondary action styles, tab accents, glyph colours from one table.

The conversations that built it are the Claude Code sessions `283f7a43…`, `457af068…` and `c8190330…`. They were copied into this project's transcript folder, so `claude --resume` here lists them.
