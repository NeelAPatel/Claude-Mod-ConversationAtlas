# Map

Map is the main status tab for the current goal, path, detour cue, activity, files, latest decisions and questions, and next step.
The sample fixture opens here and shows each section in one TUI frame.

## How to reach it

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "snapshot"

The step 1 frame showed GOAL, CURRENT PATH, POSSIBLE DETOUR, ACTIVITY, WORKING SET, LATEST, and RESUME NEXT.

## What to look for

- GOAL shows the confirmed goal and how many suggestions are available.
- CURRENT PATH shows the topic chain. POSSIBLE DETOUR has Take detour and Not a detour actions.
- ACTIVITY, WORKING SET, LATEST, and RESUME NEXT show their sample rows and counts.
- The app bar stays at the bottom of the frame; use the scrolling feature route when the body is taller than the window.

## Gotchas

- Section names are stable; row keys with IDs depend on the fixture state.
- Working-set keys include a file path. The safe key family is sel-f-*; never copy an absolute fixture path into public notes.

## Button keys

goal-heading, edit-goal, goal-row, path-heading, possible-detour-heading, ok-s12, no-s12, activity-heading, files-heading, latest-heading, dsel-d16, dsel-d18, qsel-q22, next-heading, bar-legend, mark, sel-f-*
