# Trail Settings popup

Trail Settings is an over-body popup with three pages.
The sample reaches View, Order, and Hide Types through the Trail menu and pager.

## How to reach it

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "tab trail" --step "press trail-view-menu" --step "press settings-page-next" --step "press settings-page-next"

The frames showed pages 1/3 VIEW, 2/3 ORDER, and 3/3 HIDE TYPES.

## What to look for

- VIEW offers Story and Log.
- ORDER shows Event time and newest-first direction.
- HIDE TYPES shows Report-backs and Hand-offs, each with a shown state.
- Settings remain open while changing pages or flipping a row.

## Gotchas

- The exact route uses two page-next presses to reach the final page.
- The Simulator redraws frames; it does not send an engine wheel event.

## Button keys

trail-view-menu, settings-page-prev, settings-page-next, popup-close, trail-view-story, trail-view-log, trail-sort, trail-filter-b-toggle, trail-filter-h-toggle
