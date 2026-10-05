# Atlas task table (single source of truth for tasks; owner-approved format, 2026-10-05). Snapshot: dev @ 4b1e4ae. The Task Master chat keeps it current.

## Legend
| Symbol | Decision status | | Symbol | Build state |
|---|---|---|---|---|
| ✔ | Confirmed | | ● | Merged on `dev`, real-pane check done |
| ? | Needs clarity | | ◐ | Merged on `dev`, real-pane check pending |
| ○ | Not discussed | | ◌ | Not started |
| ✕ | Dropped | | – | No code (decision or doc only) |
| ⏸ | Parked backlog | | | |
| ⚠ | Risk | | | |

- Release: 0.1 / 0.2 / 0.3 / later.
- Surface = `Tab.SECTION: specific thing`; several places are listed. Tabs: Map, Trail, Open, Evidence. Global = tab bar, bottom bar (Legend, decisions, open questions, + Mark), Legend panel, popups (Trail Settings, Decisions, Open Questions), Setup. Map sections: GOAL, CURRENT PATH, POSSIBLE DETOUR, ACTIVITY, WORKING SET, RESUME NEXT, LATEST. Open: NEEDS YOUR CALL, OBSERVED DECISIONS, DETOUR FINDINGS, OPEN QUESTIONS. Trail: MAP OF TOPICS, timeline. Evidence: CHECKPOINTS, FILES, EARLIER SESSIONS, settled-decisions ledger. (LATEST and ledger names unverified.)
- Needs: `Prereq:[#x,#y]` = must exist first (hard dependency). "Decide:" = an open decision to settle first.

## A. Decisions
| # | Item (exact) | Status | Build | Release | Surface | Needs |
|---|---|---|---|---|---|---|
| 17 | Each decision becomes a stored record (id, statement, status, weight, short revision list); `observe` sends only changes (new, revise, revert, reaffirm), no extra calls | ✔ | ◌ | 0.2 | Open.OBSERVED DECISIONS: rows; Map.LATEST: rows; Evidence.ledger: rows; Trail.timeline: revision events | Prereq:[#4, #15-16]. Decide: #5 |
| 18 | Major/minor weight assigned automatically; shown as `!` (major) or `·` (minor) after the decision icon; a "Make major/minor" toggle in the expansion overrides it | ✔ | ◐ | 0.1 | Open.OBSERVED DECISIONS: marker and expansion toggle; Map.LATEST: marker; Evidence.ledger: marker; Global: Legend panel | Prereq:[–] (shipped without #17). Real-pane check; Legend paging 46/80 |
| 5 | The rule that decides major vs minor (scope, architecture, visible behavior, hard to undo?) and whether your override persists | ? | – | 0.2 | Open.OBSERVED DECISIONS: weight | Prereq:[#18]. Decide: is the rule right? do overrides persist? |
| 19 | Observed-decision buttons are Confirm, Drop, Chat ⇒, ✕ (Confirm moves it to Evidence; Chat ⇒ puts `[Atlas #n: full title]` in your draft). Open questions get Confirm (= answered), Drop, Chat ⇒, ✕; a confirmed question shows Reopen | ✔ | ◐ | 0.1 | Open.OBSERVED DECISIONS: expansion buttons; Open.OPEN QUESTIONS: expansion buttons; Global: Decisions and Open Questions popups (footers) | Prereq:[–]. Update button is #1. Real-pane check |
| 1 | An Update button that edits a decision's title and adds a note, via an in-pane text input | ✔ | ◌ | 0.2 | Open.OBSERVED DECISIONS: expansion button and input | Prereq:[#17, #19]. ⚠ TUI feasibility |
| 6 | "Confirm all minor" button, per turn group | ✕ | – | – | Open.OBSERVED DECISIONS | You are not a fan; remove from the mockbed |
| 10 | Matching a reworded decision to its earlier one ("revise #4") | ? | ◌ | 0.2 | Open.OBSERVED DECISIONS: matching | Prereq:[#17]. Untested |
| 11 | `↻` badge on revised decisions | ○ | ◌ | 0.2 | Open.OBSERVED DECISIONS: row badge; Evidence.ledger: row badge | Prereq:[#17]. Decide: keep or cut |
| 12 | Sort order by weight | ○ | ◌ | later | Open.OBSERVED DECISIONS; Evidence.ledger | Prereq:[#18] |
| 13 | Decisions made across detours (how grouped and carried) | ○ | ◌ | later | Open.DETOUR FINDINGS; Trail.timeline; Evidence.past detours | Prereq:[#17] |
| 14 | Merging duplicate decisions | ○ | ◌ | later | Open.OBSERVED DECISIONS | Prereq:[#17, #10] |

## B. Open questions
| # | Item (exact) | Status | Build | Release | Surface | Needs |
|---|---|---|---|---|---|---|
| 20 | The "Resolved" button is removed | ✔ | ◐ | 0.1 | Open.OPEN QUESTIONS: expansion buttons; Global: Open Questions popup | Prereq:[–]. Real-pane check |
| 8 | Claude proposes an answer. Accept records it as a confirmed decision. Edit only updates the answer | ✔ | ◌ | 0.2 | Open.OPEN QUESTIONS: rows and expansion; Evidence.ledger: new decision | Prereq:[#17, #19, #20]. ⚠ TUI feasibility |

## C. Goals
| # | Item (exact) | Status | Build | Release | Surface | Needs |
|---|---|---|---|---|---|---|
| 24 | No goal suggestion with empty text, `…` or a weak first prompt | ✔ | ◐ | 0.1 | Open.NEEDS YOUR CALL: goal suggestion rows; Map.GOAL: suggestion row | Prereq:[–]. Try a few real first prompts |
| – | No fake goal row when no goal is set; empty-state hint instead (added after the design chat) | ✔ | ◐ | 0.1 | Map.GOAL: empty state | Prereq:[–]. Real-pane check, both surfaces |
| 22 | Goals become an ordered list (confirmed and suggested): reorder (easy to remove later), edit text, Drop, Set as goal | ✔ | ◌ | 0.2 | Map.GOAL: list and buttons; Open.NEEDS YOUR CALL: suggestions | Prereq:[#9, #24]. ⚠ TUI feasibility of edit |
| 2 | An automatically suggested goal shows hollow `○`; the word `auto` only where needed | ✔ | ◐ | 0.1 | Map.GOAL: icon and meta; Global: Legend panel | Prereq:[#28]. Check the `○` glyph is drawn |
| 3 | Suggested goals stay until you drop them; optional red tint when a decision counters the goal, only if free | ✔ | ◌ | 0.2 | Map.GOAL: suggestion rows | Prereq:[#22] |
| 9 | Option A: the top confirmed goal is the active one; promoting inserts at top and the old goal keeps its history | ? | ◌ | 0.2 | Map.GOAL; Trail.timeline | Prereq:[–]. Decide: you were wary of Trail complexity. Blocks #22 |
| – | Goal row right-side meta: short tag plus age only | ✔ | ◌ | 0.2 | Map.GOAL: row meta | Prereq:[–]. Verify current wording |

## D. Focus marker
| # | Item (exact) | Status | Build | Release | Surface | Needs |
|---|---|---|---|---|---|---|
| 23 | `✦` right after the goal icon (`◎ ✦ title`) on the goal the current turn is about; observation only, no Trail event | ✔ | ◐ | 0.1 | Map.GOAL: row marker; Global: Legend panel | Prereq:[–]. Real-pane check; `✦` also means "just changed" before an icon |
| 7 | Focus moves to another topic after about 2 consecutive turns, then "Switch to this" appears (only a press sets the goal) | ✔ | ◐ | 0.1 | Map.GOAL: alternative row and button | Prereq:[#23]. Real-pane check |

## E. UI conventions and requests
| # | Item (exact) | Status | Build | Release | Surface | Needs |
|---|---|---|---|---|---|---|
| 21 | `✕` sits at the right edge of every expansion | ✔ | ◐ | 0.1 | Map, Trail, Open, Evidence: all expansions; Global: popups | Prereq:[–]. Goldens cannot prove the pinning; check 46/80 and narrow |
| 28 | The word `auto` marks anything Atlas picked until you act | ✔ | ◐ | 0.1 | Map.GOAL: suggestion and alternative meta, expansion detail; Global: Legend panel | Prereq:[–]. Real-pane check |
| 29 | The engine plus `hooks/screens/*` is called "UI Base" | ✔ | – | – | None (naming) | Prereq:[–] |
| 30 | Desktop mouse wheel scrolls inside an expansion (needs `register.tsx` change) | ? | ◌ | 0.2 | Map, Trail, Open, Evidence: desktop body and expansions | Prereq:[–]. Decide: your explicit approval. Blocks #25 |
| 25 | Up to 3 expanded rows per tab on desktop | ⏸ | ◌ | 0.3 | Map, Trail, Open, Evidence: desktop only | Prereq:[#30, #1]. Overlaps the Update editor |
| – | Open plus edit may not work in the terminal | ⚠ | – | 0.2 | Open.OBSERVED DECISIONS; Open.OPEN QUESTIONS | Check before building #1, #8, #22 |

## F. Process, cost, docs
| # | Item (exact) | Status | Build | Release | Surface | Needs |
|---|---|---|---|---|---|---|
| 26 | Only changes are sent; no extra `observe` calls | ✔ | ◌ | 0.2 | None (engine) | Prereq:[#17]. Want a measured before/after? |
| 27 | Write all these design decisions into the README | ✔ | ◌ | 0.2 | None (docs) | Prereq:[#4, #5, #9] (after they are settled) |
| 31 | Mockbed artifact as the visual test bed | ✔ | ● | – | None (artifact) | Prereq:[–] |
| 4 | One design spec or three | ? | – | 0.2 | None (docs) | Prereq:[–]. Blocks #17 |
| 15-16 | Which goldens each job may change; the `observe` token budget | ○ | – | 0.2 | None (process) | Prereq:[–]. Blocks #17 |
