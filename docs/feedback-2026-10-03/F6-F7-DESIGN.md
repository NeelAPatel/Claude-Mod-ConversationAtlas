# F6 + F7 design (decided in the design session, 2026-10-03)

- One shared display-only filter set in `view` state (not snapshot, never touches intent). Hides rows in all tabs; data and counts unchanged. Show an "N hidden" marker when non-empty.
- F6 surfaces: `/atlas hide <type>`, `/atlas show <type>`, `/atlas filters` (list) AND a toggle page in Trail Settings. Both edit the same set. First hideable type: background-command notices (keep-warm timer). Type names = Legend letters.
- F7: replace Trail's `[View]` with a `[⚙]` icon button (no emoji glyph) opening a "Trail Settings" popup. Close is `[✕]` top-right, always. Pages (1/3): 1 View (Story/Log), 2 Order (Sort), 3 Hide types. One function per page.
- No new bottom-bar slot. Popup rules unchanged (one at a time, dismissed by any other action). Add an EXPLAIN entry.
- Goldens: Trail tab (heading button), Trail popup, and Legend only. Brief must list the exact files it may touch.

Note (b5 review chat): `⚙` draws as a colour emoji in the user's terminal (screenshot 41) and was read as "Codex". The settings button needs a non-emoji glyph; pick it with the user.
