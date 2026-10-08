# Atlas design system

- Two surfaces, two independent renderers:
  - **TUI** = the terminal renderer, `hooks/render-tui.tsx` → [TUI_UIUX_paradigm.md](TUI_UIUX_paradigm.md)
  - **GUI** = the desktop renderer, `hooks/render-gui.tsx` → [GUI_UIUX_paradigm.md](GUI_UIUX_paradigm.md)
- Shared above both: the engine and `hooks/screens/*` (surface-blind ScreenModel + typed Action). See `docs/ARCHITECTURE.md`.
- Read the matching paradigm file before any UI change. A UI PR updates that file in the same PR when it changes a rule.

## Principles shared by both surfaces
- **Row anatomy:** every row is `icon · title · gutter · meta` (surface details in each paradigm file).
  - icon = the entry's Legend icon (GUI: a fixed slot; TUI: at the row start after the indent).
  - title = stays readable: meta tags minimise before the title is cut (issue #15 defines the minimum width).
  - gutter = at least one blank cell between title and meta.
  - meta = counts (`metaParts`: number + letter, e.g. `1e 0r`) then age. Reuse `metaParts`; never hand-build meta strings.
- **Every Button is an action; every interactive row is a Button.**
- **Three interaction paradigms:**
  - EXPANSION: inline structured detail under a row; pressing the expanded row collapses it; no close button.
  - TOGGLE: flips state in place (Legend, Trail sort).
  - POPUP/MENU: a surface-specific panel (TUI popups; the GUI shows an inline notice instead).
- **Legend and EXPLAIN:** while Legend is on, section headings show `EXPLAIN` notes. Every new section should have an `EXPLAIN` entry (not enforced yet: a missing one falls back to the heading text).
- **Observed vs confirmed:** drawn text keeps observed facts visibly distinct from confirmed intent (e.g. goal suggestions show `auto`).
- **Proof:** goldens in `tests/golden/` cover both renderers; `scripts/control-atlas.ps1 --surface tui|gui` replays steps (it does not check wrapping or real pixels).
- **No new animation.** The only moving element is the live scan banner (`hooks/live.tsx`: ticker, scan bar, seconds counter), mounted by both renderers; do not add others.
