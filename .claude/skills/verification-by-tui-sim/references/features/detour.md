# Detour

Detour covers the possible-detour suggestion, taking it, then returning or promoting it to the goal.
The sample fixture has one possible detour and can reach both outcomes.

## How to reach it

Take and return:

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "press ok-s12" --step "press detour-topic-x42" --step "press return"

Take and promote, in a fresh Simulator run:

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "press ok-s12" --step "press detour-topic-x42" --step "press promote"

The first frame of each run showed the possible detour; the second exposed the active-row actions.

## What to look for

- Taking the suggestion shows an active DETOUR section and a return point.
- Expanding the active detour shows Return and Make it the goal.
- Return restores the main path; promote makes the detour topic the goal.

## Gotchas

- Return and promote appear only after expanding the active detour row.
- The fixture-specific row key includes an ID; use the visible footer if it changes.

## Button keys

ok-s12, no-s12, detour-topic-x42, return, promote
