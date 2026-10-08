# TUI UI/UX paradigm (terminal renderer)

Applies to `hooks/render-tui.tsx`. Shared principles: [README.md](README.md). Reference implementation for rows: Map > Working set.

## Pane and scrolling
- The pane is sized to `bodyRows` and scrolls its own body via `ui.scroll` → `view.scroll`; the app bar stays pinned.
- `rowsOf` estimates the body height.
- Built elements keep children on `el.children` (use `childrenOf`).

## Row anatomy
- `icon · title · gutter · meta`.
- icon: one fixed column, the entry's Legend icon. Prompts use the source mark `›`. Modifiers such as `✦` follow the icon.
- title: truncates first.
- gutter: always at least 1 blank cell between title and meta.
- meta: right-justified.
  - counts via `metaParts`, number + letter, each in its tone: `e` edits, `r` reads, `t` topics, `d` decisions, `q` questions, `h` hand-offs, `b` report-backs (listed in the Legend).
  - then age via `right`, e.g. `1m`.
  - never hand-build meta strings.

## Interaction paradigms
- **EXPANSION**
  - inline structured detail under a row; pressing the expanded row collapses it.
  - no close button: the `✕` is disabled behind one switch per renderer.
  - frozen: F1–F3 guide column, blank row after an expansion.
- **TOGGLES** flip state in place (Legend, Trail sort).
- **POPUPS/MENUS**
  - bordered, over-body panels for Trail events, Decisions and Open questions.
  - close with the header `✕ Close`.
  - one popup open at a time; any other action dismisses it.
- Every Button is an action; every interactive row is a Button.

## Settings and menu pattern (reference: Trail Settings, `trailViewPopup`, `popupShell`)
- Header line 1: title, pager `‹ n/N ›` beside it, `✕` pinned to the right edge.
- Line 2: `» PAGE NAME` in uppercase white; then one blank row; then the body.
- One function per page; the pager buttons and the wheel (up = previous, down = next) change pages.
- Every setting is one line: `[x]`/`[ ]` checkbox (or `▲`/`▼` for a direction toggle) · title · gutter · current state on the right (`shown`, `hidden`, `newest first`, …).
- The whole line is one Button; pressing flips it in place and the popup stays open.
- The popup shrinks to its content with no scroll control when it fits.
- New settings or menus copy this shape; do not invent another.

## Legend and headings
- While Legend is on, headings show `EXPLAIN` notes; every new section needs an `EXPLAIN` entry.
- Frozen: section heading tones.

## Proof
- Goldens: `tests/golden/terminal-*` at body widths 46 and 80; a TUI change updates only the terminal goldens its brief names.
- Replay: `pwsh scripts/control-atlas.ps1 --surface tui ...` (checks layout, meta dropping, expansion, scroll window; not wrapping or the real wheel).
