# Contributing to Conversation Atlas

Thanks for helping. Atlas is a small Claude Code plugin; most changes are one focused PR.

## Quick start

```bash
git clone https://github.com/NeelAPatel/Claude-Mod-ConversationAtlas.git
cd Claude-Mod-ConversationAtlas
claude plugin validate .
claude plugin test .
claude --plugin-dir .      # try it live (don't also enable an installed copy)
```

Types for your Claude Code build are generated into `.claude-plugin/types/` once the plugin has
loaded. They take precedence over web docs.

## Workflow

1. Open an issue first for anything bigger than a small fix, so we agree on the shape.
2. Branch from `dev` (`feat/<name>` or `fix/<name>`). `main` only moves when `dev` is confirmed good.
3. Keep the PR to **one change**.
4. Make sure `claude plugin validate .` and `claude plugin test .` pass.
5. Open the PR against `dev`.

## Rules that keep Atlas trustworthy

These are enforced by tests; the full list is in [AGENTS.md](AGENTS.md).

- **Observation never writes intent.** Goal, detour, next step and marked checkpoints change only
  through explicit user actions (`setGoal`, `startDetour`, `mark`, … called from a pane press or
  `/atlas`). Observers may only add topics, suggestions, files, activity and evidence.
- **Nothing observed is sent back to Claude as settled.** Claude sees only the static rules, the
  one-line confirmed-intent note, a pending return packet and chips the user left in the prompt.
- **No cost before consent.** Nothing that spends Claude usage runs before the setup choice.
- **Hooks only observe** (`await next(e)`, return the engine's result unchanged).
- **Pure files stay pure:** `model.ts`, `activity.ts`, `view.tsx` have no hooks or side effects;
  `register.tsx` is the only side-effect file. Client props must be plain JSON.

## How work is tracked

- Tasks are GitHub issues, grouped into milestones; the milestone says which release they belong to.
- Say what blocks an issue with a `Blocked by #n` line or link.
- One change per PR, kept small, branched from `dev`, with `Closes #n` in the description.
- The owner merges by button after testing by eye.

## Visual changes and golden snapshots

`tests/golden/` holds the drawn text of every tab at fixed sizes. Any change to drawn output fails
the golden test until the snapshots are updated, so **include the golden diff in your PR** and say
why each changed. Terminal (`terminal-*`) and desktop (`desktop-*`) goldens are separate; a desktop
change in `hooks/render-gui.tsx` must keep every terminal golden byte-identical. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the renderer seam.

## Style

Match the surrounding code: naming, comment density, idiom. New UI rows follow the row anatomy
(`icon · title · gutter · meta`) and reuse `metaParts`. New sections need an `EXPLAIN` entry in
the Legend.

## Reporting bugs

Use the issue template. Include your Claude Code version, terminal or desktop, the observer mode,
and the output of `claude plugin validate .` if the plugin fails to load.

By contributing you agree your work is licensed under the [MIT License](LICENSE).
