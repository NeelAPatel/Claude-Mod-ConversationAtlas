# Handoff: Atlas on Claude Desktop (Code tab)

Start here when working on how Atlas looks in Claude Desktop. The terminal UI is being polished in a separate chat, which is the source of truth for layout and behaviour. This thread makes the **desktop surface** look right without breaking the terminal.

## State on 2026-10-03

- Atlas works in Desktop's Code tab. It is installed for the user (`~/.claude/skills/conversation-atlas`), and every behaviour works there.
- It looks janky there: some characters that render in the terminal do not render, or render oddly, in Desktop.
- The user will share Desktop screenshots in this thread.

## How rendering works

- One render hook draws every surface: `hooks/register.tsx` → `ui.render` `Pane {atlas}` → `hooks/view.tsx` `pane()`.
- `e.surface` is `'terminal' | 'desktop' | 'vscode' | 'mobile'`. `$.ui.resolve(e)` gives that surface's element table.
- Desktop has `Svg` and `Client` but no `Raster`/`Image`. Check `Elements` in the API types: `C:/Users/Neel/AppData/Local/Temp/claude/bundled-skills/<version>/…/plugin-authoring/types/claude-code.d.ts`. Grep only, the file is huge. After a restart, the next load of the plugin-authoring skill writes a fresh copy and names it.
- Glyphs and colours come from one table, `GLYPH` in `view.tsx`, shared with the Legend. Box-drawing (`─ │ ┃`), Braille spinners (`live.tsx`), `◆ ◇ ◎ ↳ ↩ ✎ ✦` and the bordered popups are the likely suspects on Desktop.
- `live.tsx` is a `Client` surface module: animation runs on the drawing thread.

## Suggested approach

1. Collect the user's screenshots, and list each broken glyph or layout next to the element that drew it.
2. Add per-surface fallbacks rather than forking the UI. For example `const g = glyphsFor(e.surface)` returns a desktop-safe set, where a desktop row draws a dot or a simple shape instead of a Braille spinner. Keep the terminal set unchanged.
3. Consider `Svg` on desktop for things text draws badly: rules, the scrollbar, the scan progress bar, maybe a timeline. The terminal keeps its text version.
4. Tests: `tests/atlas.test.tsx` already mounts on `terminal` and `desktop`. Add desktop assertions for each fallback.

## Rules that apply here too

- Delegate every change to Codex `gpt-5.6-luna` at `xhigh`, running interactively in a visible Windows Terminal tab (never headless). Claude writes the brief, reviews, installs (`scripts\install-atlas.ps1`) and commits.
- Keep the invariants in `AGENTS.md`, especially: anything hoverable is interactive; one primary action per group with cyan `[ ]` secondary actions; nothing reaches Claude except chips, the return packet, or the intent line in Claude mode.
- Verify with `claude plugin test .`, `claude plugin validate .` and the strict tsc check.
