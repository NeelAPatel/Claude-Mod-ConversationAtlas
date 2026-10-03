# ConversationAtlas self-audit: decision summary (2026-10-03)

Consolidates reports A (docs, hygiene, dead code), B (architecture) and C (visual/UX) in `reports/`. Base: checkout `5d642de` (TUI frozen, tag `tui-freeze-2026-10-03`). Snapshot `a70e975` (adopt-full) differs only in recovery files, so all view findings apply to both. No tests were run during the audit. Visual claims rest on screenshots plus static code. Synthesised by a Sonnet subagent with spot-checks of the key citations.

## 1. Top findings (deduplicated)

| # | IDs | Problem | Sev | Surface | Evidence | Spot-check |
|---|---|---|---|---|---|---|
| 1 | C-01, B-01, G2, G3 | GUI tabs and bottom bar use terminal cell maths. The GUI measure ignores the hotkey chip the native Button still draws. The GUI tier list is only `['short']`, so layout falls to `compact`. Buttons sit in fixed-width `overflow="hidden"` cells. Result: cropped tabs, clipped `Legend` / `+ Mark`. | bug | GUI | confirmed | `ui/index.tsx:348` (`hotkey: !isGui`), `:425` (`tiers = isGui ? ['short']`), `:445`, `:479` |
| 2 | C-02, G1 | The GUI title rule is two empty `borderStyle="single"` boxes (blue, C.goal `#7dcfff`). | cosmetic bug | GUI | confirmed | `view.tsx:815-823` |
| 3 | C-03, G4, G14 | The GUI `rule()` is an empty bordered Box with `flexGrow={1}` after a body that also grows. They split the spare height, so a big empty purple box (C.path `#bb9af7`) fills ~1/5 of the pane and overlays/Legend get covered or clipped. | bug | GUI | confirmed (code) | `ui/index.tsx:663`, used at `view.tsx:1038` (body `:1028-1029`) |
| 4 | C-04, G5 | The Legend is height-capped by `rows - fixed` inside a fixed-height hidden-overflow shell, so its last rows are clipped. The "missing space after glyph" claim is refuted: `` `${g.char} ` `` at `view.tsx:597`. | bug (clip) | GUI | clip confirmed; spacing refuted | confirmed |
| 5 | C-05, G8, G9 | Meta collides with text (`1 edit`, `md13h`). `1e`/`0r` degrade to bare `1`/`0` under 60 cells. | bug | both | confirmed in goldens | TUI is frozen; only the GUI half is fixable now |
| 6 | C-06, G6 | Expansion detail is one wrapping Text with a `│ ` prefix, so continuation lines lose the bar and indent. `summary:` repeats the visible fields. | bug | both | confirmed | not re-read |
| 7 | C-07, C-11, G7 | The Trail View popup is positioned from row estimates, so it is mis-anchored and clipped on GUI. `ui.scroll` routes popup scroll only for `legend`/`item`, not `trail-view`. | bug | both | geometry confirmed; routing static | `register.tsx:957`. The popup itself is intended (see section 6). |
| 8 | B-02 | `maxScroll`, `maxPopupScroll`, `maxExpandedScroll` and `maxLegendScroll` are module globals overwritten by each pane render, so two attached surfaces clobber each other. | bug (latent) | both | static; live impact unverified | `register.tsx:128-135, 945-948` |
| 9 | B-03, B-04 | Presentation leaks. `UiElements` is `Pick<terminal Box/Text/Button>`. Colours and glyphs are duplicated across `view.tsx`, `ui GLYPH_SETS` and `screens/trail.ts` (`sourceMarkColor`). GUI cannot use `Svg`. | architecture | both | confirmed | consistent with `view.tsx:43-60` |
| 10 | B-05, C-14 | Goldens flatten to text and style only (no borders, sizes, clipping, Client), so they cannot see findings 1–4. | verification gap | both | confirmed | — |
| 11 | C-10, A-01 | AGENTS/README describe Decisions/Open popups and a Legend "More". The bar has only Legend and + Mark. This is stale docs (tests assert the removal). | misleading | both | confirmed | `view.tsx:914-917`, `types/index.d.ts:202` |
| 12 | C-08, C-09, C-12, G10-G12 | Content and semantics: markdown leaks into Open items; uncapped stale lists; four primary buttons in the goal expansion; topic-derived "goal" alternatives look like goals. No actual violation of "observation never writes intent". | misleading | both | confirmed | — |

Also real, lower priority:
- A-02: handoffs tell Codex to commit and switch branches, contradicting AGENTS.md.
- A-09: strict tsc depends on `C:/Users/Neel/AppData/Local/Temp/claude/tc-atlas`.

## 2. The GUI defects the user named: root causes

| Complaint | Root cause | file:line |
|---|---|---|
| Cropped tabs | GUI measure excludes the hotkey chip the Button still shows. The only GUI tier is `short`, so it drops to `compact` (key chip + 1–2 letters). Fixed-width hidden cells. | `hooks/ui/index.tsx:348, 425, 445` |
| Clipped `Legend` / `+ Mark` | Same maths. Bar cells are fixed width with `overflow="hidden"` around a native button. | `hooks/ui/index.tsx:479-483` |
| Blue boxes | The title rule is two bordered Boxes (C.goal). | `hooks/view.tsx:815-823` |
| Purple box | The `rule()` GUI branch is a bordered Box with `flexGrow={1}` beside a `flexGrow={1}` body. It takes the leftover height. | `hooks/ui/index.tsx:663`; `hooks/view.tsx:1038` |
| Thin blue box over FILES (Legend on) | Probably the rule/title box overlapping the absolute legend/popup layer. **Unverified.** | `view.tsx:1038-1044` |
| Legend last rows clipped | Height cap + hidden-overflow shell. Border cost is not reserved. | `view.tsx:990-996, 1039-1042` |

## 3. Target architecture and the smallest migration

1. **Engine** (pure): `model.ts`, `activity.ts`, `recall.ts`, `scan.ts`. Unchanged. Side effects stay in `register.tsx`.
2. **Screens** (pure): `hooks/screens/*` emit semantic sections, rows, counts and actions, plus style roles and glyph keys only. No colours, widths, truncation or glyph characters.
   - Meta becomes separate trailing cells with a priority order.
   - Expansion details become label/value fields.
   - Observed vs settled is an explicit role.
3. **UI base**: `hooks/ui/roles.ts` (roles, glyph keys), `nodes.ts` (a neutral tree), `actions.ts` (ids, primary/secondary/dismiss). Shared by both renderers.
4. **Renderers**:
   - `renderers/terminal.tsx`: cell measure, truncation, bracketed buttons, the `─` rule. A move of existing code with byte-identical output.
   - `renderers/desktop.tsx`: flex, intrinsic-width tabs, a real rule or Svg, native primary/secondary buttons, margin indent, an overlay layer.

Example flow: engine recall → `evidence.ts` section `{heading:'EARLIER SESSIONS', count, rows:[{role:'recall', meta, actions:['resume','resume-full']}]}` → each renderer maps the role to its own glyph, colour and control. Both fire the same action ids.

Smallest steps:
- Step 1: GUI-only fixes in the `isGui` branches. The TUI is untouched. This is the quick visible win.
- Step 2: centralise roles and glyph keys; goldens stay identical.
- Step 3: the neutral node layer.
- Step 4: move the TUI code to `renderers/terminal.tsx` unchanged.
- Step 5: a new `renderers/desktop.tsx` replaces the `isGui` branches.
- Per-surface scroll bounds can go first, or alongside step 3.

## 4. Dead code and Trailhead verdict

- **Keep (live recovery):** `fromTrailheadFile`, the `.claude/trailhead/` scan (`recall.ts:4,58`; `register.tsx:346-351`), the Evidence label, and the test at `atlas.test.tsx:374`. Only relabel as "legacy Trailhead compatibility". Leave HISTORY and DECISIONS untouched.
- **Safe to delete:**
  - `AtlasPopup.kind='legend'` and its `ui.scroll` branch (`types/index.d.ts:202`, `register.tsx:957`). Legend state lives in `view.legend`.
  - `UiRow` and `Row` (`ui/index.tsx:17, 539`).
  - `barWidth` (`:400`).
  - `export { ago }` (`view.tsx:1060`).
  - Do NOT remove `layoutRow`'s `fits`.
- **Stale tests and comments:** negative `legend-more` / `LEGEND · MORE` asserts, the fixture "Trail event popup" comment, the `/trail exclude` type comment (A-06).
- **Never remove:** `adopt-full` / `recoverFull`. The user wants it.

## 5. Ordered fix jobs

One change per job. Commit only. Codex `gpt-5.6-luna` xhigh implements.

| # | Job | Depends | Goldens it may change | Touches frozen TUI | Size |
|---|---|---|---|---|---|
| J1 | GUI title rule: one real line instead of two boxes (`isGui` branch) | — | desktop goldens, all tabs + setup | No | S |
| J2 | GUI footer rule: fixed one-row, non-growing; separate footer pinning from the rule | J1 | desktop goldens, Legend, Trail popup | No | S |
| J3 | GUI tabs and bottom bar: intrinsic width, no fixed cells, hotkey chip dropped or measured, `full` tier restored | — | desktop goldens, all tabs + setup | No | M |
| J4 | Legend: measure the framed panel including border; GUI two-column grid | J2 | desktop Legend goldens | No | S |
| J5 | Trail View: anchor in an overlay layer, route `trail-view` scroll, pager only when scrolling | J2 | desktop Trail-popup golden | No (GUI-only) | M |
| J6 | Per-surface scroll bounds (B-02) | — | none | No | S |
| J7 | Desktop structural tests (box sizes, no empty bordered boxes, no clipped buttons) | J1–J3 | none | No | M |
| J8 | Dead-code removal plus stale tests/comments (A-04, A-06) | — | none | No | S |
| J9 | Docs: AGENTS/README/handoffs follow the AGENTS rules; publication and licence status (A-01..A-03) | — | none | No | S |
| J10 | Hygiene: `.gitattributes`, golden updater stale-file check, repo-local pinned tsc, installer owned-set cleanup (A-07..A-10) | — | none | No | M (4 sub-jobs) |
| J11 | Centralise style roles and glyph keys | J1–J5 | none (must stay identical) | No | M |
| J12 | Neutral UI node layer; move the shared bars, sections and actions | J11 | none, then the affected bar goldens | No (output identical) | L |
| J13 | Split Evidence into terminal/desktop renderers, then Map/Trail/Open/Legend/popups | J12 | per-screen list per job | Moves TUI code only, output identical | L (4+ jobs) |
| J14 | GUI-native expansion (structured fields, margin indent) and meta trailing cells | J13 | desktop goldens | No | M |
| J15 | Content: strip markdown in Open, recency grouping, "Observed"/"Needs confirmation" labels, one primary per group in the goal expansion | D3 | both surfaces | **Yes** | M |
| J16 | Recovery UX: loading/failure states, observer health | — | Evidence/Open goldens | Yes | M |

J1–J7 are GUI-only. J8–J10 are independent hygiene. J11–J14 are the decoupling. J15–J16 need the TUI unfrozen.

## 6. Disagreements, doubts, verification gaps

- **Popup paradigm:** the brief (G7) says popups contradict "everything expands inline". C-07 says the Trail View menu is intended, per HANDOFF-ui-architecture. The synthesis sides with C: only the geometry is wrong. Needs the user (D2).
- **C-10 vs A-01:** C calls the missing Decisions/Open menus a bug. A shows it is stale docs, with tests asserting the removal. Treated here as a docs fix plus a product question.
- **G5 spacing:** refuted by the code. The Legend clip is real.
- **B-03 severity:** overstated as a bug. It is an architecture limit with no invalid runtime tree.
- **B-06:** `recoverFull` (snapshot `model.ts:803`) uses `[...loaded.adopted, source.id]` and drops the current map's `adopted` ids. It replaces the whole map, so this may be intentional. Needs the user's intent plus a test either way. B-07 (`hasConfirmedMap` name) is a rename nit.
- **G13 / C-13:** `setRecall` filters on the engine's own session id (`model.ts:774`). Self-listing would need a forked session with a different id. Probably not a defect, unverified.
- **A-09 / A-10 severity:** closer to hygiene than bugs, unless reproducibility on a fresh machine is a goal.
- **G4, the thin box over FILES:** root cause not pinned.
- **Not verified by anyone:**
  - no live desktop session;
  - no `plugin test` / `validate` / tsc during the audit;
  - no dual-surface scroll test;
  - no focus or accessibility check;
  - Client animation untested;
  - snapshot tests not run;
  - A-11 remote refs not fetched.
- The goldens cannot confirm any GUI fix. J7 plus manual screenshots at 46 and 80 cells are required.

## 7. Decisions for the user

- **D1:** GUI fixes first (J1–J7, no refactor) or straight to the four-layer split? Recommendation: GUI fixes first.
- **D2:** Are the Decisions/Open-question menus gone for good (so AGENTS/README get corrected)? Does Trail View stay as a small popup?
- **D3:** When may the TUI be unfrozen (meta gaps, expansion indent, `[ Update goal ]` spacing, markdown in Open)?
- **D4:** `recoverFull` and `adopted`: replace or merge? A clearer name for `adopt-full` can wait.
- **D5:** Fix the handoffs now (J9) so Codex is no longer told to commit or switch branches?
- **D6:** Pin an SDK and add a repo-local tsc config? Add `.gitattributes` and normalise line endings in one dedicated change?
- **D7:** Clean up the stale `origin/dev` (`b1b90ec`) and old branches, or leave them?
- **D8:** Desktop Svg glyphs and rules (needs the desktop renderer, J13), or native text only?
