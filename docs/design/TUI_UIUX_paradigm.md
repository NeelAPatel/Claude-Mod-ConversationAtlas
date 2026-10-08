# TUI UI/UX paradigm (terminal renderer)

Applies to `hooks/render-tui.tsx`. Shared principles: [README.md](README.md). Reference implementation for rows: Map > Working set.
Verified against the code on 2026-10-08 (audit: 92 claims). Rules marked **target** are intended behaviour the code does not fully meet yet.

## Pane and scrolling
- The pane is sized to `bodyRows` and scrolls its own body via `ui.scroll` → `view.scroll`; the app bar stays pinned.
- `rowsOf` estimates the body height.
- Built elements keep children on `el.children` (use `childrenOf`).

## Row anatomy
- `icon · title · gutter · meta`.
- icon: the entry's Legend icon at the start of the row, after the depth indent.
  - the focus marker follows the icon (`◎ ✦`); a fresh `✦` ("just changed") comes before it.
  - prompts use the source mark `›`; markers and `▾` add cells around the icon.
- title: when the row is too narrow, meta tags minimise first, then the title truncates (event rows keep their counts and truncate the title first). Minimum title width and the full rule: issue #15.
- gutter: always at least 1 blank cell between title and meta. The age is always reserved.
- meta: right-justified.
  - counts via `metaParts`: number + letter, each in its tone: `e` edits, `r` reads, `t` topics, `d` decisions, `q` questions, `h` hand-offs, `b` report-backs (listed in the Legend).
  - below 60 cells the TUI shows the number only (no letter).
  - then age via `right`, e.g. `1m`.
  - never hand-build meta strings.

## Interaction paradigms
- **EXPANSION**
  - inline structured detail under a row; pressing the expanded row collapses it.
  - no close button: the `✕` is disabled behind one switch per renderer.
  - frozen: the guide column and the blank row after an expansion.
  - event expansion uses a 6-row scroll window.
- **TOGGLES** flip state in place (Legend, Trail sort).
- **POPUPS/MENUS**
  - bordered, over-body panels. Two kinds exist: Trail Settings, and long decision/question text (over 120 characters or 4+ lines).
  - Trail events expand inline; they do not use a popup.
  - close with the header control (`✕` on Trail Settings, `Close` on item popups); key `popup-close`.
  - one popup open at a time; a navigation action (tab, Legend, expand, …) dismisses it.
  - settings actions inside the popup (page, filter, sort, view) keep it open.
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
- While Legend is on, headings show `EXPLAIN` notes; every new section should have an `EXPLAIN` entry (not enforced: a missing entry falls back to the heading text).
- Frozen: section heading tones.

## Proof
- Goldens: `tests/golden/terminal-*` at body widths 46 and 80; a TUI change updates only the terminal goldens its brief names.
- Replay: `pwsh scripts/control-atlas.ps1 --surface tui ...` (checks layout, meta dropping, expansion, scroll window; not wrapping or the real wheel).
