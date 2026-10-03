# Audit reconciliation (Codex, 2026-10-03)

Independent review of reports A/B/C, the 12 screenshots, the implementation and the SDK declarations, by Codex with two Luna xHigh reviewers. No files were changed and no tests were run. **Claude spot-checked R1, U1 and U5 in the code and confirmed all three.** This document supersedes `SUMMARY.md` where they disagree.

## 1. Evidence boundary
- Baseline `5d642de` vs installed snapshot `a70e975`. The snapshot changes **seven files**. It does **not** change `hooks/live.tsx`, `hooks/view.tsx` or `hooks/ui/index.tsx`.
- The screenshots are not a clean baseline-TUI vs snapshot-GUI comparison. 04 (the TUI Legend) mentions "Resume full". Session data differs (fork). Compare presentation, not counts or membership.

| Pair | Confirmed |
|---|---|
| 01/02 Evidence | GUI title = empty bordered boxes; tabs and footer crop; wrapped details lose the guide; long file rows crowd meta/time |
| 03/04 Legend | GUI Legend/body/footer geometry clips; TUI Legend readable; glyph-label separation to check in both |
| 05/06 Open | Markdown leaks (`**Still open:**`); different counts expected |
| 07/08 Trail expanded | Wrapping loses structural indent; some summary fields repeat |
| 09/10 Trail View | GUI content obscured/clipped; TUI shows all, but tight labels and unconditional paging confuse |
| 11/12 Map goal | Crowded goal alternatives, lost guides, meta touching text; pinned-next-step/action mismatch (U1) |

Not established by the screenshots: focus rings, accessible names, wheel routing, contrast compliance, Client-load failure behaviour.

## 2. Architecture: keep the engine, separate the renderers
- Shared already: the pure engine modules; `hooks/screens/*` (sections, rows, labels, states, typed actions).
- Coupled: `hooks/ui/index.tsx` + `hooks/view.tsx` mix semantic presentation with terminal width maths and surface branches. `register.tsx` owns state, effects and dispatch.
- The main coupling: **the GUI depends on terminal presentation assumptions** (cell truncation, fixed button columns, space indentation, text-rule replacements, shared height estimates, shared popup placement).
- Start from the existing `ScreenModel` / `ScreenSection` / `ScreenRow` and the typed `Action` union. **Do not adopt B's generic string-ID dispatch.**

```
Shared engine and persistence
             ↓
Shared semantic screens + typed actions + semantic style roles
             ↓
     TUI renderer      GUI renderer
             ↓              ↓
       Shared action dispatcher
```

- Avoid a broad file-moving refactor or a second generic UI tree unless something concrete needs it.
- Style roles precise enough to express intent: `heading.goal`, `heading.decisions`, `heading.questions`, `state.observed`, `state.settled`, `action.primary`, `action.secondary`, `metadata.readCount`, `metadata.writeCount`. Each renderer resolves roles through its own adapter.
- SDK: desktop `Svg` exists in the hook-rendered table, but **the Client element subset excludes Svg**. Desktop is not an unrestricted CSS environment. The generated declarations are the authority.

## 3. Report findings reconciled
| Findings | Conclusion |
|---|---|
| A-01 / C-10 | Stale docs. The removed Decisions/Open menus should not return. Trail details are inline; Trail View and item-overflow popups stay intentional. |
| A-02 | Conflicting handoff instructions (`danger-full-access`, commit/branch authority, "never headless"). Mark them historical or replace them. |
| A-03 | README licence TODO is stale. Keep the dated publication history and append the current status. Future-publish approval can stay as policy. |
| A-04 / A-05 | Unused UI exports and the obsolete Legend popup state are cleanup candidates. Trailhead recovery is live and stays. Consider persisted old view values before removing variants. |
| A-06 | Rename stale tests/comments, but **keep** the negative assertions that guard removed controls. |
| A-07 / A-09 | Line endings and type-check reproducibility: tooling, not runtime defects. |
| A-08 | Manifest and files agree at 28. The updater should report/reject unexpected files, not auto-delete them. |
| A-10 / A-11 | Installer ownership and branches need clarifying. They are not established safe cleanup targets. |
| B-01 / B-03 / B-04 | Real architectural limits. They don't prove invalid trees. Some different glyph mappings are intentional adaptation. |
| B-02 | Shared mutable scroll bounds: a concrete hazard. Live impact unverified. |
| B-05 / C-14 | One gap: text goldens can't establish GUI geometry, clipping or native-control usability. |
| B-06 | Adopted-ID merging is a semantics decision (see R4). |
| B-07 | The guard's naming misleads, but the bigger problem is missing overwrite protection (R2). Don't narrow it to confirmed intent. |
| B-08 / C-12 | Observation/intent separation is sound. Presentation can blur it without breaking the engine. |
| C-01–C-04 | Screenshot-backed GUI layout defects. Root causes: title rules, the flex-growing footer rule, native button measurement, Legend geometry. |
| C-05 / C-06 | Real meta and expansion issues. Meta dropping under width pressure is partly intended priority behaviour. |
| C-07 / C-11 | Scroll routing and popup-window logic need fixes. Accessibility needs live evidence. The info button is `ⓘ`, not `?`. |
| C-08 | Markdown leak confirmed. Lists are **bounded**. Old questions must not be silently resolved or deleted. |
| C-09 | Weak action hierarchy is credible. The four buttons span separate groups, so this is not a literal one-primary-per-group violation. |
| C-13 | Self-listing unproven. `setRecall` filters matching ids. A fork legitimately appears. |

Also:
- `C`+⚑ means source plus event type.
- Titles like `perfect.` / `1.` / `*merge` are literal prompts; better summaries would be a product improvement.
- Primary `[ label ]` vs secondary `[label]` follow different paths. If uniform brackets are wanted, document the requirement.
- Unused body space in a tall pane isn't a defect. The **bordered** empty region is.

## 4. Recovery defects (snapshot `a70e975`; recheck current)
- **R1 — Invalid saves can replace the map with an empty one. Highest priority.** `fromAtlasFullFile` accepts any object snapshot without validating its version or schema. `recoverFull` → `hydrate` returns an empty snapshot for an unsupported version, and recovery still reports success. Malformed v1 collections can throw.
  - Fix: validate the version and collection shapes before replacing; reject clearly; leave current state unchanged on failure.
  - Tests: unsupported version, malformed collections, valid legacy migration.
  - Locations: `recall.ts:66–71`, `model.ts:796–817`, `hydrate` at `model.ts:112`.
  - *Claude confirmed: no inner validation; `hydrate` returns base when `v !== 1`.*
- **R2 — The replacement guard misses content.** `hasConfirmedMap` checks only goal, topics and decisions. Guard on **any content being replaced** (next step, detour, checkpoints, questions, files, activity) and rename it. Test empty, observed-only, next-step-only, detour-only and evidence-only maps.
- **R3 — Restored rows can inherit unrelated freshness.** `recoverFull` keeps `current.fresh` while ids from another session can collide. Clear `fresh` on full replacement. Fix the test that keeps an orphan fresh id. Test a collision.
- **R4 — Decide what `adopted` means** before changing it: the lineage of the displayed map, or all adoptions in the live session. Each choice has a failure mode. Test the chosen meaning.
- **R5 — Disk recall selection.** `sessionsToDelete` prunes `$.store`, not save files. `register.tsx:346` reads only the first 80 directory entries before sorting, so newer saves can be missed. Make selection deterministic. Test more than 80 shuffled saves. Keep archival policy separate.
- **R6 — Saves now keep activity labels**, including Bash/PowerShell first lines and arguments (`shortCommand`). Document it, and decide whether to sanitise or truncate.
- Full recovery is an explicit user action, so the intent invariant holds. Add that replacement path to the model/rules docs.

## 5. UI behaviour defects
- **U1 — "Resume next" display and actions can refer to different items.** `screens/map.ts:325` shows `resumeHint` (a detour or pinned step first) but picks the latest next-step suggestion separately for the buttons and observer gating. Derive the display, provenance, gating and actions from one hint. Test pinned+suggestion and detour+suggestion. *Claude confirmed.*
- **U2 — Long popup items can't scroll internally.** `view.tsx:674` advances only by whole items. Use visual-row scrolling, or another full-text path. Test an oversized item, mixed heights, and reaching the end.
- **U3 — Expanded help permanently truncates long sentences.** `view.tsx:449` paginates logical entries with `truncate-end`. Make the full help reachable at narrow widths. Size expansions by wrapped rows, not logical lines.
- **U4 — `ScreenRow.live` has no consumer.** Path/activity animation was promised but isn't used; the Client only drives the scan bar. Implement it, or remove the metadata and the stale promises.
- **U5 — Read/write count colours are reversed** (`screens/map.ts:307`, `screens/evidence.ts:103`). Fix it through shared metadata construction. Bare compact numbers also lose their `e`/`r` meaning. *Claude confirmed.*
- **U6 — No reserved boundary between title and meta.** `renderRow`'s flexible spacer has no minimum, so text and meta touch. Reserve and measure a separator. Test long paths, activity labels, alternate-goal provenance and Story counts at 46/80.

## 6. Renderer state and verification
- Tie scroll bounds to the surface that produced them. Whether tabs, expansion and sort sync across surfaces is a product choice.
- `memberOf` is keyed by `requestId`, and Atlas uses one pane request id. Verify the available identity fields first.
- Keep the text goldens. Add structural assertions and real desktop checks for:
  - tabs and footer controls staying visible;
  - native button size;
  - Legend bounds;
  - long wrapped content;
  - overlay placement while scrolled;
  - focus, dismissal and wheel ownership;
  - two surfaces at different sizes, rendering in alternating order.
- 37 lines over 160 characters in production hooks/types; tests use `any`. Low-priority convention cleanup.

## 7. Job order (replaces SUMMARY §5)
1. **Recovery validation and overwrite protection**: R1/R2. Snapshot code plus focused recovery tests only.
2. **Recovery transient state**: R3, then R4 once its meaning is decided.
3. **Hint/action identity**: U1, on both surfaces.
4. **Popup/help reachability and scroll ownership**: U2/U3, Trail View routing, per-surface bounds.
5. **GUI tabs and title**: desktop-native measurement and a real separator.
6. **GUI footer, Legend and overlay geometry**: remove the flex-growing bordered rule; correct the bounds.
7. **Meta and expansion structure**: U5/U6, units, continuation guides, field order.
8. **Shared style contract and renderer extraction**: incremental, on the existing typed screens and actions.
9. **Current docs and reproducible checks**: stale instructions, local type-check bootstrap, explicit line endings.
10. **Optional product/hygiene decisions**: animations, queue grouping, installer ownership, retention, branch cleanup.

Each job names its permitted files, exact golden scope, acceptance criteria and validation. Keep the TUI frozen unless a change is explicitly authorised. Never blanket-regenerate goldens.
