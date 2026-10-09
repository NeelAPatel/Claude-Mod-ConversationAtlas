# Decisions popup

There is no dedicated Decisions popup. Per docs/design/TUI_UIUX_paradigm.md, a decision opens the shared item popup (closed with `Close`, key `popup-close`) only when its text is over 120 characters or 4+ lines.
A short decision in Open expands inline instead, and the fixed sample has no long decision, so the popup itself is unproven in the Simulator.

## How to reach it

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "tab open" --step "press dsel-d18"

The step 2 frame showed the expanded observed decision and its inline actions, not a popup.

## What to look for

- The inline detail shows text, kind, source, time, status, weight, and topic.
- Confirm, Drop, Make major, and Chat are actions on the expanded row.

## Gotchas

- The shared generic item popup is selected for long item text; the sample decision is short, so that popup is unproven here.
- Do not report this route as a popup check.

## Button keys

dsel-d18, set-d18, drp-d18, weight-d18, add-dsel-d18
