# Atlas task table (single source of truth for tasks; owner-approved format, 2026-10-05). The Task Master chat keeps it current.

## Legend
One **Stage** column follows the task lifecycle: inserted → discussion → needs clarity / parked → confirmed and queued for a release → building → code complete → test complete → committed. A row's symbol changes only when the row's evidence changes.

| Step | Meaning | Symbol (B, in use) | Emoji (A, spare) |
|---|---|---|---|
| 1 | Task inserted, logged only | `-` | ➖ |
| 2 | Discussion | `◇` | 💬 |
| 3a | Needs clarity | `?` | ❓ |
| 3b | Parked into backlog | `⏸` | ⏸️ |
| 4 | Confirmed for a release, queued (Release column says which) | `✔` | ✔️ |
| 5 | Building | `◔` | 🔨 |
| 6 | Code complete (merged, tests not all done) | `◑` | 🧩 |
| 7 | Test complete (all tests done, including real-pane checks) | `◕` | 🧪 |
| 8 | Committed (with documentation if needed) | `●` | 📦 |
| – | Dropped | `✕` | ❌ |

- **Where it is committed:** `●` alone means on `dev`. `● ⎇ feat/xyz` means committed on that feature branch only, which is earlier than `●` on `dev`.
- **Per-surface tags (T = terminal, G = desktop):** a Stage cell shows `T`/`G` tags only when the two surfaces differ, e.g. `◔ T◑ G◔`. The leading symbol is the lowest of the two. When both surfaces are at the same stage there is no tag. Applies from step 5 (building) through step 7 (test complete); real-pane checks are tracked per surface.
- **Risk:** `⚠` sits next to the task number (e.g. `22 ⚠`) and can go with any stage.
- Release: 0.1 / 0.2 / 0.3 / later.
- Surface = `Tab.SECTION: specific thing`; several places are listed. Tabs: Map, Trail, Open, Evidence. Global = tab bar, bottom bar (Legend, decisions, open questions, + Mark), Legend panel, popups (Trail Settings, Decisions, Open Questions), Setup. Map sections: GOAL, CURRENT PATH, DETOUR (the active one), POSSIBLE DETOUR, ACTIVITY, WORKING SET, RESUME NEXT, LATEST. Open: NEEDS YOUR CALL, OBSERVED DECISIONS, DETOUR FINDINGS, OPEN QUESTIONS. Trail: MAP OF TOPICS, timeline. Evidence: CHECKPOINTS, SETTLED (LEDGER), RESOLVED, DETOURS (only once a detour has ended), FILES, EARLIER SESSIONS.
- Needs: `Prereq:[#x,#y]` = must exist first (hard dependency). "Decide:" = an open decision to settle first.

## A. Decisions
| # | Item (exact) | Stage | Release | Surface | Needs |
|---|---|---|---|---|---|
| 17 | Each decision becomes a stored record (id, statement, status, weight, short revision list); `observe` sends only changes (new, revise, revert, reaffirm), no extra calls | ✔ | 0.2 | Open.OBSERVED DECISIONS: rows; Map.LATEST: rows; Evidence.SETTLED (LEDGER): rows; Trail.timeline: revision events | Prereq:[#4, #15-16]. Decide: #5 |
| 18 | Major/minor weight assigned automatically; shown as `!` (major) or `·` (minor) after the decision icon; a "Make major/minor" toggle in the expansion overrides it | ◕ | 0.1 | Open.OBSERVED DECISIONS: marker and expansion toggle; Map.LATEST: marker; Evidence.SETTLED (LEDGER): marker; Global: Legend panel | Prereq:[–] (shipped without #17). On `dev`. Tested on both surfaces (terminal widths on the owner's word). The wide-width desktop expansion text bug is #39 |
| 5 | The rule that decides major vs minor (scope, architecture, visible behavior, hard to undo?) and whether your override persists | ? | 0.2 | Open.OBSERVED DECISIONS: weight | Prereq:[#18]. Decide: is the rule right? do overrides persist? |
| 19 | Observed-decision buttons are Confirm, Drop, Chat ⇒ (Confirm moves it to Evidence; Chat ⇒ puts `[Atlas #n: full title]` in your draft). Open questions get Confirm (= answered), Drop, Chat ⇒; a confirmed question shows Reopen. The expansion `✕` is disabled (see #21) | ◕ | 0.1 | Open.OBSERVED DECISIONS: expansion buttons; Open.OPEN QUESTIONS: expansion buttons; Evidence.RESOLVED: Reopen; Global: Decisions and Open Questions popups (footers) | Prereq:[–]. Update button is #1. On `dev`. Tested on both surfaces: decision and question buttons, Reopen on RESOLVED. Desktop has no popups, so the popup footers apply to the terminal only |
| 1 ⚠ | An Update button that edits a decision's title and adds a note, via an in-pane text input | ✔ | 0.2 | Open.OBSERVED DECISIONS: expansion button and input | Prereq:[#17, #19]. TUI feasibility |
| 6 | "Confirm all minor" button, per turn group | ✕ | – | Open.OBSERVED DECISIONS | You are not a fan; remove from the mockbed |
| 10 | Matching a reworded decision to its earlier one ("revise #4") | ? | 0.2 | Open.OBSERVED DECISIONS: matching | Prereq:[#17]. Untested |
| 11 | `↻` badge on revised decisions | - | 0.2 | Open.OBSERVED DECISIONS: row badge; Evidence.SETTLED (LEDGER): row badge | Prereq:[#17]. Decide: keep or cut |
| 12 | Sort order by weight | - | later | Open.OBSERVED DECISIONS; Evidence.SETTLED (LEDGER) | Prereq:[#18] |
| 13 | Decisions made across detours (how grouped and carried) | - | later | Open.DETOUR FINDINGS; Trail.timeline; Evidence.DETOURS | Prereq:[#17] |
| 14 | Merging duplicate decisions | - | later | Open.OBSERVED DECISIONS | Prereq:[#17, #10] |

## B. Open questions
| # | Item (exact) | Stage | Release | Surface | Needs |
|---|---|---|---|---|---|
| 20 | The "Resolved" button is removed | ◕ | 0.1 | Open.OPEN QUESTIONS: expansion buttons; Global: Open Questions popup | Prereq:[–]. On `dev`. Tested on both surfaces |
| 8 ⚠ | Claude proposes an answer. Accept records it as a confirmed decision. Edit only updates the answer. You can also type your own answer, which is stored as a confirmed decision | ✔ | 0.2 | Open.OPEN QUESTIONS: rows and expansion; Evidence.SETTLED (LEDGER): new decision | Prereq:[#17, #19, #20]. TUI feasibility |

## C. Goals
| # | Item (exact) | Stage | Release | Surface | Needs |
|---|---|---|---|---|---|
| 24 | No goal suggestion with empty text, `…` or a weak first prompt | ◕ | 0.1 | Open.NEEDS YOUR CALL: goal suggestion rows; Map.GOAL: suggestion row | Prereq:[–]. On `dev`. Tested on both surfaces. A weak first prompt gives no suggestion, but a recall suggestion from an earlier session can still appear |
| – | No fake goal row when no goal is set; empty-state hint instead (added after the design chat) | ◕ | 0.1 | Map.GOAL: empty state | Prereq:[–]. On `dev`. Tested on both surfaces. Golden-covered with one suggestion; the pure empty state (hint plus input, no suggestion) has no golden |
| 22 ⚠ | Goals become an ordered list (confirmed and suggested): reorder (easy to remove later), edit text, Drop, Set as goal | ✔ | 0.2 | Map.GOAL: list and buttons; Open.NEEDS YOUR CALL: suggestions | Prereq:[#9, #24]. TUI feasibility of edit |
| 2 | An automatically suggested goal shows hollow `○`; the word `auto` only where needed | ◕ | 0.1 | Map.GOAL: icon and meta (only when no goal is set); Open.NEEDS YOUR CALL: icon; Global: Legend panel | Prereq:[#28]. On `dev`. Tested on both surfaces. Golden-proven in Open and on Map in the no-goal state at 46 and 80 |
| 3 | Suggested goals stay until you drop them; optional red tint when a decision counters the goal, only if free | ✔ | 0.2 | Map.GOAL: suggestion rows | Prereq:[#22] |
| 9 | Option A: the top confirmed goal is the active one; promoting inserts at top and the old goal keeps its history | ? | 0.2 | Map.GOAL; Trail.timeline | Prereq:[–]. Decide: you were wary of Trail complexity. Blocks #22 |
| – | Goal row right-side meta: short tag plus age only | ✔ | 0.2 | Map.GOAL: row meta | Prereq:[–]. Verify current wording |

## D. Focus marker
| # | Item (exact) | Stage | Release | Surface | Needs |
|---|---|---|---|---|---|
| 23 | `✦` right after the goal icon (`◎ ✦ title`) on the goal the current turn is about; observation only, no Trail event | ◕ | 0.1 | Map.GOAL: row marker; Global: Legend panel | Prereq:[–]. On `dev`. Tested on both surfaces. `✦` also means "just changed" before an icon |
| 7 | Focus moves to another topic after about 2 consecutive turns, then "Switch to this" appears (only a press sets the goal) | ◑ T◕ G◑ | 0.1 | Map.GOAL: alternative row and button | Prereq:[#23]. On `dev`. Button seen on both surfaces; the in-use test (focus moves after two turns, Switch sets the goal, blocked during a detour) needs a mock chat |

## E. UI conventions and requests
| # | Item (exact) | Stage | Release | Surface | Needs |
|---|---|---|---|---|---|
| 21 | Expansions collapse by clicking the row; the `✕` control is disabled for now (easy to turn back on); popups keep their header `✕` | ✔ | 0.1 | Map, Trail, Open, Evidence: all expansions; Global: popups | Prereq:[–]. Build needed in both renderers; changes the `AGENTS.md` expansion rule and the goldens. The adaptive terminal label is #35 |
| 28 | The word `auto` marks anything Atlas picked until you act | ◕ | 0.1 | Map.GOAL: suggestion and alternative meta, expansion detail; Global: Legend panel | Prereq:[–]. Tested on both surfaces. The terminal 46-column `auto` fix is commit 9c437f3 on `feat/propagate-ui` (special-cased to the literal `auto`); not yet on `dev` |
| 32 | Every section is always shown on its tab, even when empty: heading plus a one-line explanation, and the `?` opens the full help. Evidence.CHECKPOINTS and Evidence.SETTLED (LEDGER) are the model | ✔ | 0.1 | Map: WORKING SET, LATEST, RESUME NEXT, DETOUR / POSSIBLE DETOUR (CURRENT PATH and ACTIVITY unchecked); Open: NEEDS YOUR CALL, OBSERVED DECISIONS, OPEN QUESTIONS; Evidence: RESOLVED, DETOURS, EARLIER SESSIONS (FILES unchecked); Global: Legend panel, EXPLAIN notes | Prereq:[–]. Changes every golden that now omits a section, on both surfaces; invalidates pane checks already planned for 0.1 |
| 33 | At narrow widths, a row's right-hand text must not vanish before its title is shortened. Seen on Open.NEEDS YOUR CALL at 46 columns, where "next suggestion · from Claude" is dropped | ? | 0.2 | Open.NEEDS YOUR CALL: suggestion rows; Global: shared row layout (both surfaces) | Prereq:[–]. Decide: confirm what is wrong at a real width. Would replace the `auto`-only patch in render-tui.tsx and changes terminal and desktop goldens |
| 34 | Edit goal starts from the current goal text and can be cancelled without losing it (today Edit empties the field with no way back) | - | 0.1 | Map.GOAL: Edit button and goal input | Prereq:[–]. Needs view state and an Action, so it needs an approved shared-file job. Edit stays `[Edit]`; the pencil glyph is dropped because `✎` already means "file edited" |
| 35 | Terminal expansion close button (`✕`) that adapts to the pane width (`[Close ✕]`, `[✕]`, `✕`), shipped disabled | - | 0.2 | Map, Trail, Open, Evidence: terminal expansions | Prereq:[#21]. Terminal only; the control stays disabled until you enable it |
| 36 | Rename `Chat ⇒` to `Chat >` (plain ASCII) | ? | 0.2 | Open, Map.LATEST, Evidence: Chat buttons; Global: popups | Decide: keep `⇒` for 0.1 and revisit with the ASCII glyph fallback |
| 37 | Legend panel: a separator line above it on desktop, the `auto` and `✦` lines as separate wrapped rows, clearer "How to use" wording | - | 0.1 | Global: Legend panel (terminal and desktop) | Prereq:[–]. Expandable entries are #44 |
| 38 | Long goal-suggestion text cannot be read in full in the expansion in certain Map.GOAL situations | ? | 0.2 | Map.GOAL: suggestion expansions | Prereq:[–]. The exact row is not identified yet; owner chose 0.2 |
| 39 | Desktop wide width: expansion detail text breaks into one word per line and overlaps on Map, Open and Evidence | - | 0.1 | Map, Open, Evidence: desktop expansions at wide width | Prereq:[–]. 0.1 blocker (owner). Desktop renderer only |
| 40 | Desktop scrolling: a stray scroll bar, Up/Down buttons in the tab strip, and the wheel does nothing | ? | 0.1 | Map, Trail, Open, Evidence: desktop body | Prereq:[all other 0.1 rows on `dev`]. The last focused 0.1 edit; uses the `register.tsx` change from #30, approved at that point |
| 41 | Atlas fills sparsely in long chats until `/atlas scan` is run | ? | later | Global: observation and scan | Prereq:[–]. Retest once the other 0.1 work is cleared. Likely cause: few observation calls from Claude in this chat |
| 42 | Settled (LEDGER) decisions show Reopen (the action exists; the ledger rows are built without actions) | - | 0.1 | Evidence.SETTLED (LEDGER): expansion buttons | Prereq:[–]. Shared file (`hooks/screens/evidence.ts`), so it needs an approved shared-file job |
| 43 | A "pane: N columns" line in the Legend panel, so tested widths can be verified | - | 0.1 | Global: Legend panel (terminal and desktop) | Prereq:[–]. Drawn by each renderer from its own width; changes the Legend goldens only |
| 44 | Expandable entries in the Legend panel | - | 0.2 | Global: Legend panel | Prereq:[#37] |
| 29 | The engine plus `hooks/screens/*` is called "UI Base" | ● | – | None (naming) | Prereq:[–] |
| 30 | Desktop mouse wheel scrolls inside an expansion (needs `register.tsx` change) | ? | 0.2 | Map, Trail, Open, Evidence: desktop body and expansions | Prereq:[–]. Decide: your explicit approval. Blocks #25. To be promoted to 0.1 once all other 0.1 work is on `dev` (owner); the scroll fix itself is #40 |
| 25 | Up to 3 expanded rows per tab on desktop | ⏸ | 0.3 | Map, Trail, Open, Evidence: desktop only | Prereq:[#30, #1]. Overlaps the Update editor |
| – ⚠ | Open plus edit may not work in the terminal | ? | 0.2 | Open.OBSERVED DECISIONS; Open.OPEN QUESTIONS | Check before building #1, #8, #22 |

## F. Process, cost, docs
| # | Item (exact) | Stage | Release | Surface | Needs |
|---|---|---|---|---|---|
| 26 | Only changes are sent; no extra `observe` calls | ✔ | 0.2 | None (engine) | Prereq:[#17]. Want a measured before/after? |
| 27 | Write all these design decisions into the README | ✔ | 0.2 | None (docs) | Prereq:[#4, #5, #9] (after they are settled) |
| 31 | Mockbed artifact as the visual test bed | ● | – | None (artifact) | Prereq:[–] |
| 4 | One design spec or three | ? | 0.2 | None (docs) | Prereq:[–]. Blocks #17 |
| 15-16 | Which goldens each job may change; the `observe` token budget | - | 0.2 | None (process) | Prereq:[–]. Blocks #17 |
