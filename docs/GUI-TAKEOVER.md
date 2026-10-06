# GUI takeover: rules and prompt for a GUI-only Atlas session

> **Historical (0.1 build phase).** This scheme is still enforced by `scripts/check-gui-scope.ps1` against the tag `tui-freeze-2026-10-04`, and may be retired.

Written 2026-10-04 after b11 carved the renderers apart. Read this whole file before touching anything. The paste-ready prompt is at the end.

## 1. What "GUI" means here (checked against the plugin API docs, build 2.1.289)

- **Desktop is a remote surface.** The engine runs our `ui.render` hook once per ask (`e.surface === 'desktop'`), validates the tree, sends it over the wire (`ui_render`), and **Claude Code Desktop draws it itself in its web page**. The terminal is different: Ink draws the whole tree in the TUI process. Same hook, same data, a different painter.
- **Element table (desktop):** `Box, Text, Button, Input, Select, Svg, Link, Code, Markdown, Client`. **Not on desktop:** `Raster`, `Image` (terminal only). `vscode` has no `Client`; `mobile` has no `Input`, `Select` or `Client`. Today Atlas sends `vscode` and `mobile` to the TUI renderer (`view.tsx` `rendererFor`); do not change that.
- **Native controls:** a desktop `Button` is a real button (no `[ ]` brackets; `plain` strips chrome; `variant="primary"` is the desktop's own primary look; `role="dismiss"` is its native close control). The terminal draws `[ label ]`.
- **`Svg`** exists on desktop and not on the terminal: rules, a real scrollbar, progress bars and small timelines are legitimate GUI-only upgrades.
- **`Client`** (our `hooks/live.tsx`): a surface module that runs on the drawing thread for terminal **and** desktop (spinners, shimmer). It is shared today.
- **Size is still in character cells.** `e.viewport` and `e.props.bodyColumns` give columns and rows even on desktop. There is no pixel API; pixel-level freedom comes only from `Svg` or a `Client` tree.
- **Validation:** a tree with an element the surface lacks, a prop it does not take, or a child where none goes is **not drawn**; the engine draws its own and logs `ui.render (Pane): a hook returned a tree that does not validate`. A throw while drawing unmounts that site. So a GUI change must always run on the `desktop` table in tests.
- **Tests run per surface:** `ui.drawn()` captures drawn text plus style annotations. It cannot see native look (button chrome, `Svg` shapes). **The desktop goldens do not fully protect the real look.** Before a visual GUI job, the owner supplies desktop screenshots; store them in `docs/gui/baseline/`.

## 2. Current GUI state

- `hooks/render-gui.tsx` is a fork of the TUI renderer: the same character-cell layout, text glyphs and bordered popups, with the desktop chrome of b10 (secondary-variant buttons, gap 0, short bar labels, bordered rule). It looks janky because it was never designed for the desktop.
- Desktop goldens `tests/golden/desktop-{46,80}-{map,trail,trail-expanded,open,evidence,legend,setup}.txt` pin its drawn text and style.
- Everything else (engine, screens, `register.tsx`, `live.tsx`) is shared with the TUI.

## 3. Hard restrictions

### Files a GUI session MAY change
| Path | Notes |
|---|---|
| `hooks/render-gui.tsx` | the desktop renderer, the only source file |
| `tests/gui-*.test.tsx` | new test files only (never edit `atlas.test.tsx` or `golden.test.tsx`) |
| `tests/golden/desktop-*.txt` and `tests/golden/manifest.ts` | **only** the `"desktop-..."` entries of the manifest |
| `docs/gui/**`, `docs/GUI-TAKEOVER.md` | notes, screenshots, decisions |

### Files a GUI session MUST NOT change (no exceptions)
- `hooks/render-tui.tsx`: the terminal renderer. Never edit it, never "sync" the two.
- `hooks/view.tsx`: the dispatcher (surface routing; `vscode` and `mobile` mapping).
- `hooks/register.tsx`: **shared** hooks, wheel and scroll handling, per-surface scroll bounds (`surfaceBounds`; wheel events carry no surface identity), `act`, `command`, the `Client` element. A change here moves both surfaces.
- `hooks/live.tsx`: the shared `Client` module (spinner glyphs are Braille; shimmer). Desktop-specific live behaviour needs an owner-approved split job (a `live-gui.tsx` plus a `register.tsx` change), not a GUI-session edit.
- `hooks/screens/*`, `hooks/model.ts`, `hooks/activity.ts`, `hooks/delegation.ts`, `hooks/recall.ts`, `hooks/scan.ts`, `hooks/ui/shared.tsx`, `types/*`: engine, data and neutral helpers shared with the TUI.
- `tests/atlas.test.tsx`, `tests/golden.test.tsx`, every `tests/golden/terminal-*.txt`, the `"terminal-..."` manifest entries, `tests/golden/update-goldens.ps1`.
- `AGENTS.md`, `scripts/*`, `.claude-plugin/*`, `hooks/hooks.json`.

### Content that is TUI-specific and stays out of reach
- All of `render-tui.tsx` (`[ label ]` buttons, `─ │` rules, Braille and box glyph choices, wheel-as-scroll assumptions, cell-count geometry tuned to the terminal).
- In shared files: `rowsOf` and popup cell math in `hooks/ui/shared.tsx`, which both renderers rely on.
- `register.tsx` per-surface bounds map and wheel routing (see above).

### If the GUI seems to need a forbidden file
Stop. Write `needs input:` with the exact file, line and reason. Never edit it, never work around it by copying behaviour into the TUI file. The owner decides whether a separate non-GUI job (new `feat/` branch, brief, goldens named) is warranted.

### Mechanical guards (all must pass before anything is called done)
1. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-gui-scope.ps1` (diffs against tag `tui-freeze-2026-10-04`): fails on any changed file or manifest line outside the allow list above.
2. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-seam.ps1`.
3. `claude plugin test .`: all existing tests plus every `terminal-*` golden pass **unchanged**; `claude plugin validate .`.
4. `tsc` with its **exit code** checked directly (never behind a pipe).
5. Only `desktop-*` goldens may differ from the tag, and the owner reviews each desktop golden diff.

## 4. Workflow (project rules still apply)
- Branch `feat/gui-<name>` from `dev`, one change per branch, one Codex job at a time (headless, `--sandbox workspace-write`). Codex never commits or switches branches; Claude commits, fast-forwards `dev`, installs, asks the owner to try, and moves `main` only on the owner's word. Never push unasked.
- The brief names the goldens it may change (desktop only) and lists every file it may touch from section 3.
- Visual changes need owner screenshots (section 1) or an explicit owner OK that goldens alone are enough.
- If `register.tsx`, `live.tsx` or any shared file must change for the GUI, that is a separate job, not this one.

## 5. Paste-ready takeover prompt

```
You are taking over GUI-only work on ConversationAtlas in F:\LocalProj\Claude-Mod-ConversationAtlas.
"GUI" means the Claude Code Desktop surface (e.surface === 'desktop'), drawn by hooks/render-gui.tsx.
The TUI is frozen and finished; the owner will not accept a single changed terminal character or property.

Before anything else: read docs/GUI-TAKEOVER.md, docs/ARCHITECTURE.md and AGENTS.md. Read memory notes
atlas-audit-progress, atlas-tui-freeze and atlas-trail-settings-pattern. Run git status and confirm you are
on a feat/gui-<name> branch cut from dev with a clean tree; if not, stop.

HARD RULES
1. You may change only: hooks/render-gui.tsx; new tests/gui-*.test.tsx files; tests/golden/desktop-*.txt and
   the "desktop-..." entries of tests/golden/manifest.ts; docs/gui/** . Nothing else, ever.
2. Never edit hooks/render-tui.tsx, hooks/view.tsx, hooks/register.tsx, hooks/live.tsx, hooks/screens/*,
   hooks/model.ts, hooks/ui/shared.tsx, types/*, tests/atlas.test.tsx, tests/golden.test.tsx, any
   terminal-* golden, AGENTS.md or scripts/*. register.tsx and live.tsx are shared by the terminal.
3. If the GUI seems to need a forbidden file, STOP and write "needs input:" naming the file and why. Do not
   work around it and do not copy GUI behaviour into the TUI file.
4. Desktop facts (verified in the plugin API types): desktop is a remote surface drawn by the Desktop web
   page; its elements are Box, Text, Button, Input, Select, Svg, Link, Code, Markdown, Client (no Raster, no
   Image). Size is still character cells (e.viewport, bodyColumns). A tree that does not validate is dropped
   and the engine draws its own, so test every change on the desktop element table.
5. Proof before done, in this order, each with its exit code reported: scripts/check-gui-scope.ps1,
   scripts/check-seam.ps1, claude plugin test . (every terminal-* golden unchanged), claude plugin validate .,
   tsc (exit code, no pipe). Any failure means the change is rejected, not worked around.
6. One change per branch. Delegate implementation to Codex (headless, workspace-write) with a brief that lists
   the exact files and desktop goldens it may touch; Claude reviews the diff and desktop golden diff, commits,
   fast-forwards dev, installs, and asks the owner to try. Never push, never move main, unasked.

First task: ask the owner for (a) desktop screenshots of every tab, the Legend, a popup and the Setup screen
(save under docs/gui/baseline/), and (b) the GUI design brief. Then propose one small, reversible first change.
```
