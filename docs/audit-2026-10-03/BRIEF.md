# ConversationAtlas self-audit: brief (2026-10-03)

**Read-only audit.** Do not change implementation, configuration, goldens, branches, git state or the installation. Do not regenerate goldens, install, reload or fix anything. Your sandbox is read-only. Your **final message is your report**: the CLI saves it to `docs/audit-2026-10-03/reports/<slice>.md`. Write it as that Markdown file.

## Context
- Repo `F:\LocalProj\Claude-Mod-ConversationAtlas`, branch `audit/self-audit`. Its last commit (`89885dc`) is an empty freeze commit on top of `5d642de` (== `main` == `dev`, pushed). Tag: `tui-freeze-2026-10-03`. **The TUI is frozen**: audit it, don't change it.
- **Out-of-band divergence:** the installed copy (`~/.claude/skills/conversation-atlas`) was edited directly at 09:06–09:17, likely by a forked session. It was captured verbatim as branch **`snapshot/installed-2026-10-03`** (`a70e975`, +299/-17 lines: an `adopt-full` action and changes in `recall.ts`, `register.tsx`, `model.ts`, `live.tsx`, `screens/evidence.ts`, tests). Unreviewed. State which version each finding concerns: **checkout (5d642de)** or **installed snapshot (a70e975)**.
- Read first: `AGENTS.md` (current rules), `docs/HANDOFF-codex.md` (latest state), `docs/DECISIONS.md`, `docs/HANDOFF-ui-architecture.md`, `docs/HANDOFF-desktop-ui.md`, `docs/HISTORY.md`, `README.md`, `tests/golden/README.md`.
- Mod SDK: `C:/Users/Neel/AppData/Local/Temp/claude/bundled-skills/2.1.288/e2323dea88c2d2300b9f0cb877eb1ee1/plugin-authoring/types/claude-code.d.ts` and `reference.md` next to it. When old handoffs conflict with current rules, report the conflict. Don't follow obsolete workflows.

## The user's end goal (frame every architecture finding against it)
**Decouple four layers:** the **engine** (state, observation vs intent, persistence), a **UI base** (shared semantic screen data: which sections, rows, headings such as "EARLIER SESSIONS", actions, counts, observed vs settled, semantic style roles), and **two consumers, TUI and GUI**, each with its own rendering code and syntax. Both consumers read the same UI base, so the content stays in sync while each looks native on its surface. The GUI should not inherit terminal assumptions. The user expects this separation to make both apps more consistent. Assess how far the current code is from that, and what the smallest steps are.

## Screenshots (in `docs/audit-2026-10-03/screens/`)
Pairs from the same moment, desktop GUI (odd numbers) vs terminal TUI (even). **The GUI pane was showing the forked session, so its data differs slightly (counts, an extra checkpoint). Compare layout and rendering, not data.**
01/02 Evidence · 03/04 Evidence with the Legend on · 05/06 Open · 07/08 Trail with an expanded Story turn · 09/10 the Trail View popup · 11/12 Map with the Goal expanded.

**Claude's preliminary observations.** Verify each, mark it confirmed, refuted or unverified, find the root cause in code (file:line), and extend the list:
- **G1, the "weird blue boxes":** on GUI the title rule draws as two empty rounded bordered boxes either side of "Conversation Atlas", where the TUI has a `────` text rule. The rule's border-line replacement creates boxes.
- **G2, tabs cropped:** GUI tabs collapse to key chips plus 1–2 letters (`M`, `T T.`, `O O…`, `▸ Evid`, `E |`) despite ~800px of width. The forced "GUI compact" tier plus cell-based width maths are the suspects.
- **G3, bottom bar clipped:** GUI `Legenc` and `+ Mark` are cut off. Fixed cell widths are applied to native buttons.
- **G4, the "weird purple boxes":** on GUI a large empty purple-bordered box always sits above the bottom bar (about 1/5 of the pane), even with the Legend off. With the Legend on (03), a thin empty blue box overlaps the FILES rows, the Legend box sits over the body, and the Legend's last rows are clipped. The TUI has none of these. Suspects: popup or legend shell geometry, the reserved Legend height, live Client regions.
- **G5, Legend glyph spacing:** `↩returned`, `×failed`, `✏file edited` lack a space (GUI and TUI). The GUI Legend clips "hand-off running" and "report back". The TUI Legend is one 16-row column.
- **G6, expansion bodies:** wrapped continuation lines lose the `│` bar and indentation (the `summary:` in 07/08, "Atlas currently reads your aim as:" in 11/12). `summary` repeats fields already shown (kind, topic, files).
- **G7, Trail View popup:** a popup, against the direction "everything expands inline". GUI (09): mis-anchored over the body, bottom clipped (`Log` cut, `Sort` missing), `Grouped by turnactive · default` missing a space, a white primary `Story` button. TUI (10): `TRAIL VIEW[Close]` missing a space, `[ Story ]` with inner spaces next to `[Log]`, and a `▲ 1/3 ▼` scroller for three items.
- **G8, meta collisions:** text and meta touch with no gap. TUI: `…1 topic · 2 questions`, `…li…1 edit`, `atlas-m1-live.md13h`. GUI Activity: `…left it5h`, `…md46m`. Story meta is inconsistent: sometimes `turn 72 · 1 decision`, sometimes only counts, sometimes `t65`.
- **G9, Files:** counts are missing on some rows (time only) and present on others. Formats vary (`4e 14h` with no `0r`). Middle truncation varies row to row.
- **G10, Goal expansion:** four primary (white) buttons in one group (3× `Update goal` + `Use this as my goal`), against "one primary per group". The TUI still has `[ Update goal ]`, `[ Use this as my goal ]` and `[ Pin as next step ]` with inner spaces, while `[Close]` has none, so T5 is incomplete. `Self-audit scope for inconsistenciesobserved alternative` is glued. Suggested goals are recent *topics*, not goals.
- **G11, glyph collision:** Map topics use `○`, while the Legend says `○` = "suggestion, needs you". Story rows show `C ⚑` (two marks). Claude milestones appear as top-level Story rows mixed in with turns. Weak turn titles (`1.`, `*merge`).
- **G12, Open hygiene:** markdown leaks into captured questions (`**Still open:**`); stale and long uncapped lists (27–29 observed decisions; old questions never resolved).
- **G13:** the GUI Earlier Sessions list includes the session itself (`Clean up TUI · ffcc4887`), possibly because of the fork. Verify whether the current session can list itself.
- **G14:** large dead space at the GUI bottom, and differing vertical rhythm and indentation between surfaces.

## Slices: one auditor per slice, line by line within its scope
**Slice A: docs, guidance, repo hygiene, dead code** (report `A-docs-hygiene-deadcode.md`)
1. Documentation and in-app guidance: verify `AGENTS.md`, README, decisions, history and handoffs against the code.
   - Known: AGENTS' POPUP rule (Trail events, Decisions and Open questions as popups) is outdated. "Publishing needs a decision" is now done. Worktree wording.
   - Every `EXPLAIN` entry, heading-help text, Legend line and setup message: find references to removed controls, popups, "More", `[ change ]` and old workflows.
   - Separate historical records, which should stay as history, from current instructions that need correcting.
2. **Dead code inventory, line by line:** old **Trailhead** code and paths (`fromTrailheadFile`, `.claude/trailhead/`, `/trailhead` mentions). Are they still needed for recovery, or dead? Removed features: decisions/questions/event popups, `AtlasPopup` kinds, `fit()` leftovers, unused `hooks/ui` primitives, unused types, unused exports, obsolete tests, stale comments, misleading names.
3. Repo and release hygiene:
   - line endings and the missing `.gitattributes` (goldens show line-ending-only changes);
   - golden generation, and syncing of `tests/golden/manifest.ts`;
   - **reproducibility:** tsc depends on `C:/Users/Neel/AppData/Local/Temp/claude/tc-atlas`, outside the repo;
   - what the install script copies, versioning, stale branches.
   Separate optional housekeeping from defects. A branch's age and version `0.1.0` alone aren't bugs.

**Slice B: architecture, code quality, SDK correctness** (report `B-architecture-code.md`)
1. Trace engine → screens (`hooks/screens/*`) → UI base (`hooks/ui/*`) → renderers (`view.tsx`) → actions (`register.tsx`). Map every file to a layer, and **every place a layer leaks**:
   - terminal assumptions inherited by the GUI: cell-based truncation, fixed heights, indentation by spaces, button width measurement, the scrollbar, overlay placement, the `────` rule;
   - presentation inside screen models: hardcoded colours, glyphs, animation palettes;
   - whether the GUI can use desktop-only elements (`Svg`, native button variants), or is held back by terminal-derived types.
2. Inventory hardcoded colours, duplicated glyph tables and duplicated width/truncation/format/action logic. Propose **semantic style roles** (e.g. `heading.decisions`, `observed`, `settled`, `primaryAction`) that each consumer maps on its own.
3. Shared view state and scroll bounds when terminal and desktop attach to the same session. Client module loading, allowed elements, literal module paths, timers and fallbacks, checked against the SDK.
4. Code quality: purity rules (`model.ts`, `activity.ts`, `view.tsx`, screens, ui), side effects only in `register.tsx`, `plain()` for Client props, CAS `update`, `LIMITS` bounds, stale comments, conventions.
   - Tests: meaningful coverage, obsolete assertions, gaps. **Explain exactly what the goldens verify and what their text flattener leaves out** (it plainly misses the GUI boxes, cropping and clipping in the screenshots).
5. Review **`snapshot/installed-2026-10-03`** vs the checkout: what it adds (`adopt-full`, recall, live and register changes), whether it is sound, and whether it breaks any invariant. "Observation never writes intent" especially.
6. Deliver a **target architecture**: the four layers, file layout, interfaces, how one heading such as "EARLIER SESSIONS" flows from engine to UI base to the TUI and GUI renderers, and an incremental migration plan in small jobs.

**Slice C: visual, layout, interaction, UX** (report `C-visual-ux.md`)
1. Verify and extend G1–G14 against the screenshots **and** the code (root cause file:line). Review every tab, the setup screen, the Legend, expansions and remaining popups on both surfaces, using the 46/80-column goldens in `tests/golden/`. Look at the narrow-width boundaries and the compact-label transitions.
2. Clipping, wrapping, truncation, metadata priority, empty states, long paths and text, glyphs vs the Legend, colours, observed vs settled, primary vs secondary actions, dismiss buttons, heading controls, expansion indentation, field order, action placement, closing behaviour. Readability and consistent meaning, **without** requiring identical layouts on desktop and terminal.
3. Interaction and accessibility:
   - keyboard navigation, focus, hotkeys, mouse, scroll routing;
   - every interactive-looking element acts, and every action is discoverable;
   - selected, expanded and disabled states; whether dismissal or navigation loses context;
   - contrast, reliance on colour alone, glyph legibility.
   Plus first-run consent, observer status, scan feedback, recovery, errors and loading states.
4. Verify that observation never becomes confirmed intent through presentation (e.g. suggested goals, Story marks).
5. Produce a **GUI-perfect wishlist**: what a native-feeling desktop pane should look like here (tabs, rules, buttons, spacing, rhythm, icons), separate from the TUI.

## Evidence and efficiency rules (all slices)
- Inspect shared components first, then the exceptions for each screen. Report a shared root cause **once** and list the screens it affects.
- Use static inspection and the existing goldens before expensive runtime work. You may read anything. Don't write anything except your final message.
- If you can't see real rendering, label visual and interaction claims **unverified** and give the exact check needed.
- Don't claim full runtime coverage from passing tests or snapshots.

## Report format (each slice)
Start with the most consequential findings. For each finding:
- a **stable ID** (`A-01`, `B-01`, `C-01`…) and category;
- severity **bug / misleading / cosmetic / inefficiency**, and evidence **confirmed / suspected / unverified**;
- file:line, and the surface (TUI/GUI/both) and version (checkout/snapshot) it affects;
- the trigger, what happens, and the impact on the user;
- the proposed fix and how to verify it.

End with:
- a coverage matrix (what you checked, and how);
- the verification gaps still open;
- **an ordered list of small fix jobs**, with dependencies and expected golden scope.

Keep **architectural improvements** separate from **confirmed defects**.
