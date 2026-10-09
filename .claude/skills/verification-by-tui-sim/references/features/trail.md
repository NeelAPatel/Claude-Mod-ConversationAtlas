# Trail

Trail shows the topic tree and the conversation events grouped as a story or listed as a log.
The sample has four topics and two story rows.

## How to reach it

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "tab trail"

The step 1 frame showed MAP OF TOPICS and TRAIL · Story.

## What to look for

- MAP OF TOPICS displays the nested topic rows and current topic.
- TRAIL · Story groups events by turn; the menu can switch to Log.
- Event rows expand when pressed. The sample keys are evb-story-2 and evb-story-1.

## Gotchas

- Event and topic keys depend on fixture content; inspect the buttons: footer if the IDs differ.
- Use Trail Settings to inspect view, order, and hidden-type controls.

## Button keys

topics-heading, tsel-t6, tsel-t8, tsel-t10, tsel-t13, events-heading, trail-view-menu, evb-story-2, evb-story-1, bar-legend, mark
