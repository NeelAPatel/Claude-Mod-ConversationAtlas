# Desktop renderer contract

The desktop renderer must mount and validate on every tab, with Legend open, a popup open, Trail Settings open, and the Setup screen at `bodyColumns` 46 and 80. A mount may not show a hook failure or engine fallback. Presses by `Button` key must reach the corresponding shared `Action` and update state as the terminal does. Drawn text must contain the underlying goal, topic, decision, question, file, and section-help content; presentation and decoration are unconstrained. With overflow, desktop scroll bounds are nonnegative, `maxScroll` is positive, and wheel scrolling changes the view. The live `Client` element must remain present during a desktop scan.

| Button key (including dynamic forms) | Shared Action |
|---|---|
| `tab-map`, `tab-trail`, `tab-open`, `tab-evidence` | `tab` |
| `bar-legend` / `legend` | `legend` |
| `mark` | `mark` |
| `setup-claude`, `setup-engine` | `set-observer` |
| `observer-toggle` | `toggle-observer` |
| `events-heading` and other `<section>-heading` help keys | `expand` |
| `trail-view-menu`, `trail-view-story`, `trail-view-log`, `trail-sort`, `trail-filter-b-toggle`, `trail-filter-h-toggle`, `trail-settings-page-*` | `popup`, `trail-view`, `trail-sort`, `trail-filter`, `trail-settings-page` respectively |
| `popup-close`, `popup-up`, `popup-down`, `help-up-*`, `help-down-*`, `scroll-up`, `scroll-down`, `sb-thumb` | `popup`, `popup-scroll`, `expanded-scroll`, `scroll`, `scroll-to` respectively |
| `close-*`, `add-*`, `sg-*`, `qsel-*`, `dsel-*`, `tsel-*`, `goal-alternative-*`, `path-*`, `sel-*`, `ef-*`, `csel-*`, `dh-*`, `rc-*`, `evb-*`, `evb-story-*` | The `Action` attached to that screen action or row (expand, attach, confirm, dismiss, settle, exclude, drop, restore, resolve, reopen, return, promote, adopt, or adopt-full as applicable) |

Contract tests press these concrete keys: `tab-trail`, `tab-open`, `tab-evidence`, `tab-map`, `bar-legend`, `trail-view-menu`, `events-heading`, and `setup-engine`. They dispatch `tab`, `legend`, `popup`, `expand`, and `set-observer` according to the table.
