# Open questions popup

There is no dedicated Open questions popup. Per docs/design/TUI_UIUX_paradigm.md, a question opens the shared item popup (closed with `Close`, key `popup-close`) only when its text is over 120 characters or 4+ lines.
A short question in Open expands inline instead, and the fixed sample has no long question, so the popup itself is unproven in the Simulator.

## How to reach it

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "tab open" --step "press qsel-q22"

The step 2 frame showed the expanded question and its inline actions, not a popup.

## What to look for

- The inline detail shows text, kind, source, time, status, and topic.
- Confirm, Drop, and Chat are actions on the expanded row.

## Gotchas

- The shared generic item popup is selected for long item text; the sample question is short, so that popup is unproven here.
- Do not report this route as a popup check.

## Button keys

qsel-q22, res-q22, drp-q22, add-qsel-q22
