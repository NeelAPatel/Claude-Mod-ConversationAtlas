# App bar, Legend, and Mark

The pinned app bar holds tab navigation, the Legend toggle, and Mark.
Legend adds section explanations and a key for Atlas symbols; Mark records a checkpoint.

## How to reach it

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "legend" --step "scroll end"

The frames showed the expanded explanation notes and the LEGEND content at the bottom.

To expand How to use as well:

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "legend" --step "scroll end" --step "press legend-howto"

To check Mark in the sample:

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "press mark" --step "tab evidence"

The final frame showed the new mark at the top of CHECKPOINTS.

## What to look for

- The tab bar stays pinned while the body scrolls.
- Legend adds EXPLAIN notes beneath headings and a LEGEND section.
- How to use expands instructions and the observer toggle.
- Mark adds a checkpoint that appears in Evidence.

## Gotchas

- Legend adds enough lines that scroll end is needed to inspect its lower content.
- The Simulator uses a fixed sample clock and isolated state.

## Button keys

bar-legend, mark, legend-howto, observer-toggle, scroll-up, scroll-down
