# Slice C — Visual, layout, interaction, UX

Audit basis: frozen checkout `5d642de` on `audit/self-audit`; installed snapshot `a70e975`. Read-only inspection of the 12 screenshots, 46/80-column TUI and GUI goldens, screen/UI/render code, tests, SDK declarations, and relevant documentation. No files, branches, goldens, installation, or git state were changed.

The shared visual code is unchanged between checkout and installed snapshot, so shared findings apply to both unless noted.

## Findings

### C-01 — GUI bars use terminal width math

- Category: layout
- Severity: bug
- Evidence: confirmed
- Findings: G2, G3
- Files: `hooks/ui/index.tsx:341-359, 420-491`; `hooks/view.tsx:881-930`
- Surface/version: GUI; checkout and installed snapshot

Trigger: desktop tabs or bottom-bar buttons render with native button chrome and hotkey props.

What happens: width measurement omits GUI hotkeys, while the actual GUI `Button` still receives them. Fixed-width cells then use `overflow="hidden"`. The screenshots show key chips, cropped tab labels, and clipped `Legend` / `+ Mark`.

Impact: the GUI looks terminal-derived, loses label discoverability, and may expose smaller-than-expected click targets. The text goldens do not catch this because they flatten button labels and omit native chrome.

Proposed fix: give GUI `Tabs` and `Bar` a separate intrinsic-width layout. Either omit hotkeys from GUI buttons or include their native width in measurement. Do not put native buttons in fixed-width overflow cells.

Verify: sweep real desktop widths from 20 to 100 cells, including active/inactive tabs, scrollbar-present states, Legend open, and both bottom-bar actions. Capture actual desktop screenshots; require no crop or wrap.

### C-02 — GUI title rule creates empty bordered boxes

- Category: rendering
- Severity: cosmetic bug
- Evidence: confirmed
- Finding: G1
- Files: `hooks/view.tsx:811-832`
- Surface/version: GUI; checkout and installed snapshot

Trigger: the desktop title rule is rendered.

What happens: each side of the title is a `Box` with `height={1}`, `flexGrow={1}`, and `borderStyle="single"`. The GUI renders these as two empty rounded/boxed regions instead of a one-row rule.

Impact: the title area looks like two input fields and is visually unlike the TUI rule.

Proposed fix: use a dedicated desktop rule renderer: a single horizontal line element, text line, or SVG rule with the title centered. Do not use bordered boxes as line segments.

Verify: compare desktop and TUI title rows at 20, 34, 46, and 80 cells. Confirm exactly one noninteractive rule and no empty bordered regions.

### C-03 — The GUI flex-growing rule reserves and paints dead space

- Category: layout
- Severity: bug
- Evidence: confirmed
- Findings: G4, G7, G14
- Files: `hooks/ui/index.tsx:661-665`; `hooks/view.tsx:990-1048`
- Surface/version: GUI primarily; shared source in checkout and installed snapshot

Trigger: the pane is pinned to a tall GUI viewport, especially with Legend or Trail View open.

What happens: the GUI rule is an empty bordered `Box` with `flexGrow={1}`. It consumes remaining space after the body and is painted after the body. The screenshots show a large purple empty box, dead space, and overlays clipped or covered by it.

Impact: the GUI has inconsistent vertical rhythm; Legend and Trail View content can overlap the rule or disappear beneath it. The TUI uses a text rule and does not show the same empty box.

Proposed fix: make the rule a fixed one-row element with `flexGrow={0}`. Separate footer pinning from rule rendering. Give overlays a defined stacking/parent region or render them in a dedicated overlay layer.

Verify: test short and tall panes with body overflow, Legend, Trail View, and expanded rows. Confirm no overlay is covered by the rule and that the footer remains pinned without a large bordered reserve.

### C-04 — Legend geometry and spacing are not layout-safe

- Category: layout/readability
- Severity: bug
- Evidence: partly confirmed
- Finding: G5
- Files: `hooks/view.tsx:561-618, 990-1044`
- Surface/version: GUI clipping confirmed; TUI spacing claim not confirmed; both versions

Trigger: Legend is opened at narrow or tall widths.

What happens: `legendRows` is calculated from content rows but does not reserve the Legend border’s vertical cost. The fixed-height Legend wrapper then clips its final rows on GUI. The GUI screenshot loses the final legend entries.

The specific “missing space after glyph” claim is not supported by the checkout source: `view.tsx:597-599` explicitly renders `${g.char} `.

Impact: users may not see the complete glyph vocabulary, defeating the Legend’s purpose. The apparent spacing problem may be a host/font rendering issue or adjacent column packing.

Proposed fix: measure the framed panel, including border and padding, before assigning height. Use an explicit two-column desktop grid and a one-column terminal layout. Keep glyph and label in separate measured cells.

Verify: inspect actual native rendering at 46 and 80 cells, with short and tall pane heights. Confirm all 16 entries are visible and each glyph has a visible label gap.

### C-05 — Metadata is allowed to collide with row text

- Category: readability
- Severity: bug
- Evidence: confirmed
- Findings: G8, G9
- Files: `hooks/ui/index.tsx:228-296`; `hooks/view.tsx:217-245`; `hooks/screens/map.ts:298-321`; `hooks/screens/evidence.ts:95-116`
- Surface/version: TUI and GUI; checkout and installed snapshot

Trigger: rows combine a title, metadata, and right-side time/status, especially files and Trail summaries.

What happens:

- `metaChoices()` changes file counts from `1e`/`0r` to bare `1`/`0` below 60 cells.
- Some metadata choices reserve no separator, while the renderer relies on a flex spacer and gap.
- The fixed row structure allows text and metadata to touch.

The goldens visibly contain forms such as `milestonemilestone`, `tsx1e`, and `atlas-m1-live.md13h`; the screenshots show similar GUI collisions.

Impact: counts become ambiguous and metadata appears attached to the wrong field.

Proposed fix: represent metadata as separate semantic trailing cells. Preserve compact labels as `1e` and `0r`; drop lower-priority metadata before dropping operation meaning. Give the title a flexing region and metadata a measured trailing region.

Verify: test long paths, long titles, zero/nonzero read-write counts, times, and multi-part Story metadata at 20–100 cells on both surfaces.

### C-06 — Expansion details lose structural indentation and repeat content

- Category: expansion/readability
- Severity: bug
- Evidence: confirmed
- Finding: G6
- Files: `hooks/view.tsx:248-395, 401-435`; `hooks/screens/map.ts:82-90`; `hooks/screens/evidence.ts:59-90`
- Surface/version: TUI and GUI; checkout and installed snapshot

Trigger: a checkpoint, goal, file, or Trail row is expanded and a detail line wraps.

What happens: detail lines are rendered as one wrapping `Text` value prefixed with `│ `. Continuation lines receive no bar or indentation. Checkpoint details also append `summary: ${text}`, where `text` already repeats the checkpoint name/topic/files.

Impact: expanded content is hard to scan and looks structurally broken. Repeated fields make the expansion longer and increase clipping risk.

Proposed fix: render each field as a structured label/value row, with a persistent indentation column. Remove `summary` when it duplicates visible fields. Preserve the full value in a scrollable expansion where necessary.

Verify: expand long goals, paths, checkpoint summaries, and Trail prompts at 46 and 80 cells; inspect every continuation line on both surfaces.

### C-07 — Trail View popup geometry is fragile

- Category: popup interaction
- Severity: bug
- Evidence: confirmed for GUI geometry; popup paradigm itself is not a defect
- Finding: G7
- Files: `hooks/view.tsx:689-748`; `hooks/screens/trail.ts:235-289`
- Surface/version: GUI and TUI; checkout and installed snapshot

Trigger: opening Trail View near the bottom of the Trail body.

What happens: the popup is absolutely positioned using body-relative row estimates. The body is separately scrolled and the GUI rule is painted afterward. The GUI screenshot shows the popup over the body with lower content clipped. The TUI shows tight title/Close spacing and a confusing `1/3` control for three menu rows.

The “popup violates the inline-expansion direction” claim is not fully supported: the current architecture documentation explicitly describes a Trail View menu. The geometry and interaction problems remain.

Proposed fix: keep Trail View as a small menu, but render it in a dedicated overlay layer anchored to the triggering heading. Reserve its full measured height and use a clear native close control. Show pagination only when content actually scrolls.

Verify: open the menu at top, middle, and bottom positions with body scrolling active; test Escape/Close, wheel scrolling, and both surfaces.

### C-08 — Open items leak Markdown and remain stale-looking

- Category: content hygiene
- Severity: misleading
- Evidence: confirmed
- Finding: G12
- Files: `hooks/model.ts:301-307`; `hooks/screens/open.ts:50-102`; `hooks/model.ts:25-35`
- Surface/version: TUI and GUI; checkout and installed snapshot

Trigger: Claude or engine observations contain Markdown emphasis or remain unresolved for many turns.

What happens: item text is clipped but not normalized, so captured questions can display `**Still open:**`. Open renders all retained suggestions, observed decisions, and open questions without recency grouping or an archive view. Storage is bounded at 60 items, but the active screen is not meaningfully bounded.

Impact: the Open tab looks like raw transcript residue rather than an actionable queue. Old questions compete with current decisions.

Proposed fix: normalize presentation-only Markdown at capture/display time. Add recency or status grouping and an explicit “older” state; do not silently delete observations.

Verify: feed Markdown-prefixed questions, 60 mixed items, resolved/reopened items, and duplicate observations. Confirm current actionable items remain prominent and raw markers are absent.

### C-09 — Goal expansion presents multiple equally dominant primary actions

- Category: interaction hierarchy
- Severity: misleading
- Evidence: confirmed
- Finding: G10
- Files: `hooks/screens/map.ts:76-139`; `hooks/model.ts:209-239`; `hooks/view.tsx:372-395`; `hooks/ui/index.tsx:502-535`
- Surface/version: TUI and GUI; checkout and installed snapshot

Trigger: a confirmed goal has detected or topic-derived alternatives.

What happens: the expansion displays several `Update goal` actions plus `Use this as my goal`. Each suggestion is technically rendered in its own action group, but visually they form one goal decision area. On GUI they become several equally prominent native actions; on TUI they produce several bracketed controls. The alternative metadata can also touch the text.

The alternatives are intentionally derived from recent topics and checkpoints, not actual goal objects (`model.ts:214-230`).

Impact: observed topics can look like system-authored goals, increasing the chance that users treat observations as intent.

Proposed fix: label these as “Possible readings of your goal,” use secondary actions for alternatives, and keep one primary action for the detected-goal adoption path.

Verify: test no alternative, one alternative, and three alternatives on both surfaces; confirm only the intended action has primary emphasis.

### C-10 — Advertised Decisions/Open Questions bottom-bar actions are absent

- Category: discoverability
- Severity: bug
- Evidence: confirmed in code and screenshots
- Files: `hooks/view.tsx:914-930`; `types/index.d.ts:202-218`; `AGENTS.md:20`; `README.md:149-170`
- Surface/version: TUI and GUI; checkout and installed snapshot

Trigger: a user follows the current Legend/README guidance.

What happens: the bottom bar contains only Legend and + Mark. The documented Decisions and Open Questions menus are not represented in `appBarItems`, and `AtlasPopup` has no decisions/questions kinds.

Impact: promised actions are undiscoverable, and the current implementation conflicts with the repository’s stated popup invariant.

Proposed fix: either implement the documented menus with the current popup contract, or explicitly settle and update the invariant and guidance to make Open the sole action surface.

Verify: inspect the bottom bar and keyboard/mouse controls in every tab at 46/80 cells. Confirm the chosen product contract is consistent across code, Legend, README, and screenshots.

### C-11 — Scroll and focus routing are incomplete

- Category: accessibility/interaction
- Severity: bug
- Evidence: suspected from static inspection; runtime not performed
- Files: `hooks/register.tsx:418, 954-970`; `hooks/view.tsx:583-589, 689-738`
- Surface/version: both; checkout and installed snapshot

Trigger: a popup is open, or the pane is opened with focus.

What happens:

- `ui.scroll` routes popup scrolling only for `legend` and `item`; `trail-view` is omitted.
- The `act('scroll')` path likewise handles Legend but not Trail View.
- No rendered Button or Input uses `autoFocus`.
- Section help buttons expose only `?` as their native label.
- Row buttons use already-truncated labels, so native accessibility names may be truncated.

Impact: wheel behavior can scroll the body behind a popup, and keyboard focus/discoverability may be inconsistent. Color and tiny glyphs carry too much meaning without guaranteed accessible labels.

Proposed fix: centralize focus and scroll ownership by active overlay kind. Add explicit accessible labels, focus the first meaningful control when opening a pane/popup, and preserve full row text as the accessible name.

Verify: real terminal and desktop tests for Tab/Shift-Tab, Enter, Escape, wheel, PageUp/PageDown, popup open/close, focus rings, and screen-reader/accessibility-tree labels.

### C-12 — Intent boundaries are preserved, but presentation can blur them

- Category: semantic UX
- Severity: misleading
- Evidence: confirmed presentation risk; no confirmed state violation
- Files: `hooks/model.ts:4-7, 209-239`; `hooks/screens/map.ts:94-123`; `hooks/screens/trail.ts:193-228`
- Surface/version: both; checkout and installed snapshot

Observation does not silently write intent: goal alternatives require an explicit action, topic rows are observational, and Story rows are event summaries. No confirmed `observe`-to-goal/detour/settled-decision violation was found.

The risk is visual: “Suggested goals,” topic-derived alternatives, source marks, and event glyphs are close enough to confirmed content that users may read them as settled. The Story view also combines source marks and event glyphs, producing rows such as `C` plus a checkpoint mark.

Proposed fix: use explicit labels such as “Observed” and “Needs confirmation,” reserve confirmed glyphs for confirmed state, and give Story source/type information separate semantic columns.

Verify: seed equivalent observed and settled items and confirm they differ through text, style, and accessible labels—not color alone.

### C-13 — Earlier-session self-listing is not established

- Category: recovery UX
- Severity: misleading
- Evidence: unverified; current code argues against the defect
- Finding: G13
- Files: `hooks/register.tsx:346-373`; `hooks/model.ts:773-775`; `hooks/screens/evidence.ts:179-209`
- Surface/version: Evidence; checkout and installed snapshot

`setRecall()` filters records whose `sessionId` equals the active snapshot session ID. The GUI screenshot’s “Clean up TUI” row may therefore be a prior/forked session, consistent with the brief’s warning that GUI data differs.

Verify: create a save file with the exact current `$.session.id()`, load recall, and assert it is absent. Separately verify that a forked session with a different ID is intentionally listed.

### C-14 — Golden snapshots are not a complete GUI visual oracle

- Category: verification gap
- Severity: inefficiency
- Evidence: confirmed
- Files: `tests/golden.test.tsx:40-79, 91-103, 152-218`; `tests/golden/README.md:1-13`
- Surface/version: both; checkout goldens

The flattener:

- returns no output for `Client`;
- converts Buttons to labels only;
- ignores borders, width, height, flex growth, padding, overflow, and native button chrome;
- does not perform actual wrapping or clipping;
- records only color, bold, italic, and dim style.

Therefore the goldens correctly protect semantic text and style roles but cannot detect the GUI boxes, button cropping, overlay z-order, dead space, or clipped native controls shown in the screenshots.

Proposed fix: retain text goldens for semantic regression, and add a separate desktop structural/screenshot verification layer. Do not treat passing golden tests as proof of GUI usability.

## Setup, observer, scan, recovery, and error states

- First-run consent is present in `hooks/view.tsx:622-654`; mode is engine-only until stored choice in `hooks/register.tsx:213-220`. The setup goldens at 46/80 show both choices and no hidden control.
- Observer status is only a mode toggle and dimming note (`hooks/view.tsx:576-590`, `496-523`). There is no “last report” health indicator or warning when Claude mode is enabled but silent.
- Scan feedback is implemented through `scanBanner()` and `Client module="./live.tsx"` (`hooks/view.tsx:950-957`, `hooks/register.tsx:930-940`). The existing tests exercise state changes, but the provided screenshots do not validate real desktop animation.
- Recovery is explicit through Evidence actions. `loadRecall()` catches filesystem errors silently (`hooks/register.tsx:346-373, 288`), so missing/denied save files have no loading or failure state.
- Action failures reach a toast through the pane render callback (`hooks/register.tsx:944`), but recovery and initial recall failures do not.

## Coverage matrix

| Area | Evidence checked | Result |
|---|---|---|
| Evidence | Screens 01–04; terminal/desktop 46/80 Evidence and Legend goldens; `screens/evidence.ts` | G4–G6, G8–G9, G13 assessed |
| Open | Screens 05–06; terminal/desktop 46/80 Open goldens; `screens/open.ts` | G8, G11–G12 assessed |
| Trail expanded | Screens 07–08; terminal/desktop 46/80 Trail-expanded goldens; `screens/trail.ts`, expansion renderer | G6–G8, G11 assessed |
| Trail View | Screens 09–10; terminal/desktop 46/80 Trail goldens; popup geometry and scroll routing | G7 and C-11 assessed |
| Map/Goal | Screens 11–12; terminal/desktop 46/80 Map goldens; `screens/map.ts` | G8, G10–G11, intent presentation assessed |
| Legend | Screens 03–04; terminal/desktop 46/80 Legend goldens; legend sizing code | G4–G5 assessed |
| Setup | terminal/desktop 46/80 setup goldens; setup and mode code | Consent and copy checked; native focus unverified |
| Bars/rules | all 46/80 goldens plus screenshot pairs; `hooks/ui/index.tsx`, `view.tsx` | G1–G3, G14 assessed |
| SDK contract | generated `claude-code.d.ts:900-971, 1322-1400, 3594-3661` | Native Button, Client, focus, and desktop element behavior checked statically |
| Tests | existing test source and golden flattener; no tests executed | Coverage boundaries documented; current runtime result not independently re-run |

## Verification gaps

- No live Claude Desktop pane was driven during this read-only audit.
- Native button dimensions, focus rings, screen-reader labels, mouse hit targets, and actual z-order remain unverified.
- The GUI screenshots show a forked session, so counts and data membership were not treated as evidence against the checkout.
- `Client` animation/load behavior is statically correct by literal module path, but real desktop loading remains unverified.
- Current observer silence and recovery failure behavior need a live session with a missing observer tool and denied/missing save files.
- G13 requires an exact current-session-ID fixture.

## Ordered small fix jobs

1. **GUI bars and title rule**  
   Dependency: none.  
   Files: `hooks/ui/index.tsx`, `hooks/view.tsx`, focused UI tests.  
   Golden scope: desktop Map/Open/Evidence/Trail at 46/80; desktop setup if shared bar code changes.  
   Fix C-01 and C-02 first because they affect every screen.

2. **GUI footer/rule/overlay geometry**  
   Dependency: job 1.  
   Files: `hooks/view.tsx`, popup/Legend tests.  
   Golden scope: desktop Legend and desktop Trail-expanded/Trail popup scenarios.  
   Remove flex-growing bordered rule and establish a real overlay layer.

3. **Metadata and expansion layout**  
   Dependency: job 1.  
   Files: `hooks/ui/index.tsx`, `hooks/view.tsx`, `hooks/screens/map.ts`, `hooks/screens/evidence.ts`.  
   Golden scope: both surfaces, Map/Evidence/Trail-expanded at 46/80.  
   Preserve `e/r` semantics and structured indentation.

4. **Glyph and intent presentation**  
   Dependency: job 3.  
   Files: `hooks/screens/shared.ts`, `hooks/screens/trail.ts`, `hooks/view.tsx`, Legend goldens.  
   Golden scope: all Legend, Map, Trail, Open, and Evidence goldens.  
   Separate topic/source/event semantics and make observed state explicit.

5. **Popup routing and accessible interaction**  
   Dependency: job 2.  
   Files: `hooks/register.tsx`, `hooks/view.tsx`, interaction tests.  
   Golden scope: Trail and Legend popup/expanded goldens only.  
   Add focus, Escape, wheel routing, accessible labels, and native dismissal behavior.

6. **Open queue and recovery status**  
   Dependency: job 4.  
   Files: `hooks/model.ts`, `hooks/screens/open.ts`, `hooks/register.tsx`, Evidence/Open goldens.  
   Golden scope: Open and Evidence at both surfaces and widths.  
   Normalize Markdown, improve stale-item grouping, and expose recall loading/failure states.

7. **Product-contract reconciliation**  
   Dependency: jobs 4–6.  
   Files: `AGENTS.md`, `README.md`, `docs/DECISIONS.md`, only after the user settles whether Decisions/Open menus remain required.  
   Golden scope: only if visible controls or guidance change.

## Architectural improvements — separate from confirmed defects

The smallest durable direction is:

- Engine continues to provide state and observation/intent reducers.
- Screens provide semantic sections, rows, metadata, actions, counts, and state labels.
- A shared UI base provides semantic layout contracts, not terminal cell math.
- TUI and GUI renderers consume that base independently.

For GUI specifically, the target should be a native pane with intrinsic-width tabs, a single horizontal rule, flex-based title/metadata columns, margin-based topic depth, native primary/secondary buttons, a compact Legend card, opaque anchored overlays, visible focus rings, and no reliance on color alone. The TUI can retain cell measurement, bracketed secondary actions, and text glyph rules without forcing those assumptions onto the GUI.

