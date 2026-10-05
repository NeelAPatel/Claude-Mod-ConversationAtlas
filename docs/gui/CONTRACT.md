# Desktop renderer contract

Goal rows retain their Atlas icon and draw the semantic focus modifier immediately after
it (`◎ ✦ title` for the confirmed goal, `○ ✦ title` for a focused alternative). The modifier
reserves title space independently of the icon and right-side metadata. Goal suggestions
and alternatives show `auto`; expansions explain `auto: Atlas's guess, not yet yours.`
Alternatives use the existing goal Action labeled **Switch to this**. The
shared engine moves focus after two consecutive topic-observed turns and restores it on a
goal-matching topic; renderer reads never change state. Legend uses `✦ suggested / goal detected`;
its icon-list entry `before an icon: just changed` remains.
Suggested goals have Switch to this and Dismiss actions with one blank row after each action line.
A thin static 1px guide in `#41414a` runs from the expanded goal through the alternatives
to Use this as my goal; alternatives sit one level inside it.

The desktop renderer must mount and validate on every tab, with Legend open and the Setup screen at `bodyColumns` 46 and 80. A mount may not show a hook failure
or engine fallback. No desktop tree may contain an absolute-positioned Box or an `atlas-popup`; Trail controls stay inline and overflow items expand beneath
their row. Presses by `Button` key must reach the corresponding shared `Action` and update state. A stale terminal popup is represented by an inline notice and
its `popup-close` action. Drawn text must contain the underlying goal, topic, decision, question, file, and section-help content.
The desktop draws the full tree; the engine scrolls it as a whole, including the tab strip and Legend.
Legend and + Mark follow the four tabs in the same wrapping row, at natural width with hotkeys L and K.
Legend uses the primary variant and a small accent underline while open; + Mark stays secondary.
The full inline Legend panel follows the strip spacer before the body; there is no bottom app bar.
All four renderer scroll maxima are 0.
Desktop-only wheel hooks pass through without writing view state.
The live `Client` element must remain present during a desktop scan.

| Control key (including dynamic forms) | Shared Action |
|---|---|
| `weight-<id>` | `{ type: 'weight', id }`; Make minor / Make major in a decision expansion |
| `tab-map`, `tab-trail`, `tab-open`, `tab-evidence` | `tab` |
| `bar-legend` / `legend` | `legend` |
| `mark` | `mark` |
| `setup-claude`, `setup-engine` | `set-observer` |
| `observer-toggle` | `toggle-observer` |
| `events-heading` and other `<section>-heading` help keys | `expand` |
| `trail-view-select` (or fallback `trail-view-story`, `trail-view-log`) | `trail-view-set` |
| `trail-sort` | `trail-sort` |
| `trail-filter-b-toggle`, `trail-filter-h-toggle` | `trail-filter` |
| `popup-close` (stale terminal notice only) | `popup` |
| `help-up-*`, `help-down-*` | `expanded-scroll` |
| `close-*`, `add-*`, `sg-*`, `qsel-*`, `dsel-*`, `tsel-*`, `goal-alternative-*`, `path-*`, `sel-*`, `ef-*`, `csel-*`, `dh-*`, `rc-*`, `evb-*`, `evb-story-*` | The `Action` attached to that screen action or row (expand, attach, confirm, dismiss, settle, exclude, drop, restore, reopen, return, promote, adopt, or adopt-full as applicable) |

The Trail toolbar is visible on the Trail tab at widths 46 and 80. A native `trail-view-select` chooses Story or Log and dispatches `trail-view-set`;
if Select is unavailable, paired Story/Log Buttons remain the fallback. The sort control is right aligned and labeled `Newest ▼` or `Oldest ▲`;
filters use `✓` while shown and dim `○` while hidden. No View/Order/Show label text is drawn. The Legend presents LEGEND, source marks, then How to
use (closed by default); instructions, Observer mode and counts share its indented body. At 64 columns and above the icon list uses two equal columns
filled top-to-bottom; narrower layouts use one. The tab strip has no per-tab underline; its full-width, 2px SVG baseline uses the active tab accent
(Map yellow, Trail green, Open red, Evidence blue). Contract tests select `trail-view-select`, press Trail toolbar buttons and other controls, and
verify the corresponding `trail-view-set`, `trail-sort`, and `trail-filter` actions.

Tab cells grow equally but never shrink below their padded label width; there is no zero-width basis. Labels use NBSP padding to equalize their character
lengths (the short label is used below 40 columns).
The tab strip has no Up/Down scroll buttons or custom scrollbar; narrow widths may wrap without horizontal overflow.
A one-cell spacer separates the buttons from the colored baseline. Expansion details are all rendered inline with no internal window or Previous/Next controls.
Each detail line sits on its own row at every width. Press an expanded row to collapse it; its other actions wrap on the left. Expansion `✕` buttons are
disabled behind one renderer switch. Chat ⇒ keeps the full `[Atlas #n: full title]` chip text. Decision Confirm uses the `settle` Action; resolved questions
keep Reopen, and open questions have no Resolved button.
The engine scrolls the full inline expansion and Legend content; `maxExpandedScroll` is always 0.

Decision rows draw the shared marker immediately after their icon: `!` in the
decision tone for major, `·` dim for minor. Expansion details include
`weight: major (auto)` / `weight: minor (you)`. The `weight-<id>` button carries
`{ type: 'weight', id }`, labeled Make minor / Make major, after status actions
and before Chat ⇒. Pressing flips weight while keeping the expansion open.
This Action changes only the person's weight; it adds no Trail event or intent.
