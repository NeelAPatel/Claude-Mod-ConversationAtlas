# User feedback on the b2 build (`6bb4119`), 2026-10-03

The user tried the installed `dev` build in the terminal. **Everything not listed below works**, including the b1 fixes (Resume-next actions, read/write colours, recovery list) and the b2 wheel routing. Screenshots are in this folder. These TUI changes are **explicitly requested by the user**, so they are authorised exceptions to the TUI freeze (scope them per item and name the goldens).

## F1 — Wrapped expansion text runs under the guide bar (defect, from b2/U3) — `33.png`, `35.png`
Wrapped continuation lines of an expansion start at the `│` guide column, so the text "cuts into the bar". Fix with a hanging indent: the guide is its own column and the text wraps inside the column beside it. Never crop words. This applies to **every** expansion (section help, Trail event detail, recovery items, etc.).

## F2 — Expansions get a blank row after them — `37.png`
Add one empty row after every expansion, for breathing room. Applies to all expansions. Now that scrolling works, the pane can use the space it has.

## F3 — ACTIVITY and WORKING SET headings lost their colour again — `33.png` context, goldens
They render as plain bold (`{0:bold}` in the goldens). Restore their section colours, as `5d642de` did for the other headings.

## F4 — One compact, coloured meta schema everywhere — `34.png`
In a narrow pane, right-aligned Trail summaries ("2 edits · 3 reads · 1 topic · 2 decisions") crowd out the title ("resum…"). Use the compact form from the Map/Evidence tabs everywhere: number plus letter, each in its colour (orange `2e` edits, purple `3r` reads, and a letter plus colour for topics, decisions, questions, reports and events), then the time. Use the same schema and colours across all tabs. The expansion explains what each one means, and the Legend should list the letters.

## F5 — Trail's left column shows the Legend icon; Claude gets its own glyph — `34.png`, `35.png`
The Trail iconography is cramped (`C ⚑ ▾`; `⚙️←` draws as a wide emoji). The leftmost column should be the icon the Legend shows for that entry. Replace the letter `C` (Claude) with a centred, many-spoked asterisk-like glyph (for example `✻`) in **Claude orange**. Avoid emoji-presentation glyphs such as `⚙️`.

## F6 — Filter entry types (proposal; design and confirm with the user first)
- An `/atlas` subcommand that hides entry types across Atlas and lists the current filters. Example: background-command notices such as the keep-warm timer.
- Possibly a **Trail Settings** entry on the bottom bar for finer Trail control.

## F7 — Trail View popup feels off — `36.png`
- Close sits after the title (`TRAIL VIEW[Close]`). Put it **top-right, always, as `[✕]`**. Avoid words as button names where an icon will do.
- Idea: one function per page, paged `1/3`.
- The Trail View options feel cramped. Moving them into a bottom-bar **Trail Settings** (F6) may be better than a popup.

## Suggested jobs (cheapest sensible grouping)
1. **F1 + F2**: expansion structure. This overlaps audit job 7, "U6 + expansion structure"; fold it in.
2. **F3**: heading colours (tiny).
3. **F4 + F5**: Trail row meta schema and icon column (shared meta helper; the deferred U5 extraction).
4. **F6 + F7**: Trail Settings and filters. Needs a short design agreed with the user first.
