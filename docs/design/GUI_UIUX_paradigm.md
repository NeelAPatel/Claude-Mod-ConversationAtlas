# GUI UI/UX paradigm (desktop renderer)

Applies to `hooks/render-gui.tsx`. Shared principles: [README.md](README.md). Detail and the control-to-Action table: [docs/gui/DESIGN.md](../gui/DESIGN.md), [docs/gui/CONTRACT.md](../gui/CONTRACT.md).

## Rules for every GUI change
- Edit `hooks/render-gui.tsx` (plus desktop tests/goldens and these docs); keep every terminal golden byte-identical.
- The only file that names the GUI surface is `hooks/view.tsx` (seam check).
- Must mount and validate on every tab, with Legend open and the Setup screen, at `bodyColumns` 46 and 80; no hook failure or engine fallback.
- Presses by `Button` key reach the matching shared `Action` and update state.
- The live `Client` element stays mounted during a scan.
- No new animation (the live scan banner is the only moving element).
- Real look (pixels, fonts, spacing) is unverifiable by the sim: mark the PR `owner-eye`.

## Scrolling and layout
- The engine scrolls the whole tree, including the tab strip and Legend; there is no bottom app bar, custom scrollbar or scroll buttons.
- Renderer scroll maxima are 0 (`maxExpandedScroll` is always 0); desktop wheel hooks pass through without writing view state.
- Legend renders full length inline, right after the tab-strip spacer, before the body.
- Each detail line sits on its own row at every width; only the Legend icon list splits into two columns, at 64+ columns.

## Tabs
- Four equal native cells that never shrink below their padded content; NBSP padding equalizes widths; short labels below 40 columns.
- Full-width 2px SVG baseline in the active accent: Map yellow, Trail green, Open red, Evidence blue; no per-tab underline.
- Legend (L) and + Mark (K) follow the tabs in the same wrapping row at natural width; Legend is primary while open, + Mark stays secondary.

## Rows
- Fixed centered icon slot · flexible title · two-cell minimum gutter · trailing meta kept inside the pane.
- Title budget uses pane cells with a 1.15 proportional-font allowance; never applied to meta.
- Fewer than 24 title cells left: drop attribution first, then zero-valued counts; non-zero counts and age keep priority.
- File paths use middle truncation; prose wraps only in detail and help blocks.
- Non-interactive title Text takes one leading NBSP to align with the Button inset.

## Interaction
- **Expansion:** details render inline, one line per row; no close button (`✕` disabled behind one renderer switch); pressing the expanded row collapses it.
- **No popups:** no absolute-positioned Box and no `atlas-popup`; a popup left open by the terminal shows as an inline notice with a `popup-close` action ("Close it").
- **Settings** are native pressable labels with the current state in the label; Trail Settings are an always-visible wrapping toolbar (Story/Log, sort labelled `Newest ▼`/`Oldest ▲`, `✓`/dim `○` filters).
- **Section headings** pair tone and count with a small `?` button; explanations stay inline under the heading.
- **Goal rows** keep the Atlas icon and draw the focus modifier right after it (`◎ ✦ title`, `○ ✦ title`); suggestions show `auto`; actions are Switch to this and Dismiss.
- **Decision rows** draw the weight marker right after the icon (`!` major, `·` dim minor); the weight action changes only the person's weight.
