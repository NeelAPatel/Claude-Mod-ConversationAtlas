# Desktop renderer contract

The desktop renderer must mount and validate on every tab, with Legend open and the Setup screen at `bodyColumns` 46 and 80. A mount may not show a hook failure or engine fallback. No desktop tree may contain an absolute-positioned Box or an `atlas-popup`; Trail controls stay inline and overflow items expand beneath their row. Presses by `Button` key must reach the corresponding shared `Action` and update state. A stale terminal popup is represented by an inline notice and its `popup-close` action. Drawn text must contain the underlying goal, topic, decision, question, file, and section-help content. With overflow, desktop scroll bounds are nonnegative, `maxScroll` is positive, and wheel scrolling changes the view; `maxPopupScroll` is always 0. The live `Client` element must remain present during a desktop scan.

| Button key (including dynamic forms) | Shared Action |
|---|---|
| `tab-map`, `tab-trail`, `tab-open`, `tab-evidence` | `tab` |
| `bar-legend` / `legend` | `legend` |
| `mark` | `mark` |
| `setup-claude`, `setup-engine` | `set-observer` |
| `observer-toggle` | `toggle-observer` |
| `events-heading` and other `<section>-heading` help keys | `expand` |
| `trail-view-story`, `trail-view-log` | `trail-view-set` |
| `trail-sort` | `trail-sort` |
| `trail-filter-b-toggle`, `trail-filter-h-toggle` | `trail-filter` |
| `popup-close` (stale terminal notice only) | `popup` |
| `help-up-*`, `help-down-*` | `expanded-scroll` |
| `scroll-up`, `scroll-down` | `scroll` |
| `sb-thumb` | `scroll-to` |
| `close-*`, `add-*`, `sg-*`, `qsel-*`, `dsel-*`, `tsel-*`, `goal-alternative-*`, `path-*`, `sel-*`, `ef-*`, `csel-*`, `dh-*`, `rc-*`, `evb-*`, `evb-story-*` | The `Action` attached to that screen action or row (expand, attach, confirm, dismiss, settle, exclude, drop, restore, resolve, reopen, return, promote, adopt, or adopt-full as applicable) |

The Trail toolbar is visible on the Trail tab at widths 46 and 80. The selected Story/Log control uses the primary variant; the order button names the active order; Report-backs and Hand-offs state whether they are shown or hidden. Contract tests press `tab-trail`, `tab-open`, `tab-evidence`, `tab-map`, `bar-legend`, Trail toolbar keys, `events-heading`, and `setup-engine`. They dispatch `tab`, `legend`, `trail-view-set`, `trail-sort`, `trail-filter`, `expand`, and `set-observer` according to the table.
