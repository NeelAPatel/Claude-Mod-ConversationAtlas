# ConversationAtlas (Atlas) implementation invariants

- Atlas is the combined product and absorbs Trailhead (user decision 2026-10-02). New intent features go here, not in `MyMods/trailhead`.
- Standalone local v0 plugin. Do not publish, package or install globally without a new explicit user decision.
- **Observation never writes intent.** `goal`, `detour`, `nextStep` and `marked` checkpoints change only in `setGoal`, `setNextStep`, `startDetour`, `returnFromDetour`, `promoteDetour`, `mark`, `confirmSuggestion`. These are called only from a pane press (`act`) or `/atlas`. `observe`, `startTurn` and the activity/file reducers may add topics, suggestions, observed items, files, activity and evidence checkpoints (commit, tests, milestone) only. Tests in `tests/atlas.test.tsx` hold this.
- Trailhead semantics kept: one active goal; one active detour; a detour departs from the latest marked checkpoint, or makes one; the departure snapshot freezes goal, topic, next step, settled decisions; decisions settled during a detour are its outcomes; return emits one deterministic packet ("not recorded" for missing facts) that rides exactly one composer prompt; promote replaces the goal and keeps history.
- Context Claude reads comes only from: the static rules section (`prompt.compose`), the one-line confirmed-intent note, a pending return packet, the pane selection. Nothing observed is sent back as if it were settled.
- `model.ts`, `activity.ts` and `view.tsx` stay pure (no `$`). `register.tsx` is the only file with hooks and side effects. The `Client` element (module path literal `./live.tsx`) is created in `register.tsx`.
- Client props must be plain JSON. Run them through `plain()`, since an undefined field makes the engine refuse the tree.
- State: `$.state` `conversation-atlas.snapshot|view` via `update` (CAS); render hooks never write. Durable copies go to `$.store` on a 2 s timer; keep the bounded lists in `LIMITS`.
- Narrow interception: hooks observe with `await next(e)` and return the engine's result unchanged. The only answers are the plugin's own tool and command.
- Before changing APIs, read the build's generated declarations (`.claude-plugin/types/` once loaded) and run `claude plugin validate` + `claude plugin test`.
- The pane is sized to `bodyRows` and scrolls its own body via `ui.scroll` → `view.scroll`, so the app bar stays pinned. `rowsOf` estimates the body height. Built elements keep children on `el.children` (see `childrenOf`).
- The app bar opens one drawer at a time, an open menu's label ends in ` ^`, and while the Legend is open headings show `EXPLAIN` notes. Any new section needs an `EXPLAIN` entry.
- Recovery reads `<root>/.claude/atlas/*.json` (`saveFile` format) and Trailhead envelopes in `.claude/trailhead/`. Adopting one is always an explicit press or `/atlas recover n`.
