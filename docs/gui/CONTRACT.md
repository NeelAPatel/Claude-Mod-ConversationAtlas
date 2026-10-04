# Desktop renderer contract

The desktop renderer must mount and validate on every tab, with Legend open and the Setup screen at `bodyColumns` 46 and 80. A mount may not show a hook failure or engine fallback. No desktop tree may contain an absolute-positioned Box or an `atlas-popup`; Trail controls stay inline and overflow items expand beneath their row. Presses by `Button` key must reach the corresponding shared `Action` and update state. A stale terminal popup is represented by an inline notice and its `popup-close` action. Drawn text must contain the underlying goal, topic, decision, question, file, and section-help content. With overflow, desktop scroll bounds are nonnegative, `maxScroll` is positive, and wheel scrolling changes the view; `maxPopupScroll` is always 0. The live `Client` element must remain present during a desktop scan.

| Control key (including dynamic forms) | Shared Action |
|---|---|
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
| `scroll-up`, `scroll-down` | `scroll` |
| `sb-thumb` | `scroll-to` |
| `close-*`, `add-*`, `sg-*`, `qsel-*`, `dsel-*`, `tsel-*`, `goal-alternative-*`, `path-*`, `sel-*`, `ef-*`, `csel-*`, `dh-*`, `rc-*`, `evb-*`, `evb-story-*` | The `Action` attached to that screen action or row (expand, attach, confirm, dismiss, settle, exclude, drop, restore, resolve, reopen, return, promote, adopt, or adopt-full as applicable) |

The Trail toolbar is visible on the Trail tab at widths 46 and 80. A native `trail-view-select` chooses Story or Log and dispatches `trail-view-set`; if Select is unavailable, paired Story/Log Buttons remain the fallback. The sort control is right aligned and labeled `Newest ▼` or `Oldest ▲`; filters use `✓` while shown and dim `○` while hidden. No View/Order/Show label text is drawn. The Legend presents HOW TO USE, OBSERVER, then LEGEND; the observer toggle is under its heading. At 64 columns and above the icon list uses two equal columns filled top-to-bottom; narrower layouts use one. The tab strip has no per-tab underline; its full-width, 2px SVG baseline uses the active tab accent (Map yellow, Trail green, Open red, Evidence blue). Contract tests select `trail-view-select`, press Trail toolbar buttons and other controls, and verify the corresponding `trail-view-set`, `trail-sort`, and `trail-filter` actions.

Tab cells grow equally but never shrink below their padded label width; there is no zero-width basis. Labels use NBSP padding to equalize their character lengths (the short label is used below 40 columns). The Up/Down scroll controls remain at the end of the row, and narrow widths may wrap without horizontal overflow. A one-cell spacer separates the buttons from the colored baseline. Expansion details are all rendered inline with no internal window or Previous/Next controls. They use two equal columns at `bodyColumns >= 64` for short `label: value` lines, filled left-to-right; long free text and unlabeled lines remain full-width in order. At 46 columns, details stay in one column. Add to message and Close remain together after the details, each exactly once. The normal pane body scroll bounds cover expansion content; `maxExpandedScroll` is always 0.
