# Goal

Goal is the confirmed aim and any suggested alternatives.
The sample can expand the confirmed goal; the nogoal fixture exposes a goal suggestion in Open.

## How to reach it

Expand the sample goal and alternatives:

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "press goal-row"

Enter the sample edit state:

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "press edit-goal"

Reach and confirm the no-goal suggestion:

    pwsh scripts/control-atlas.ps1 --surface tui --state nogoal --width 80 --height 60 --step "tab open" --step "press sg-s-no-goal" --step "press ok-s-no-goal"

The second frame expands the suggestion; the third frame shows the resulting Open list.

## What to look for

- The expanded confirmed goal lists alternatives and Switch to this actions.
- Edit changes the heading action to Cancel.
- The no-goal suggestion expands with Set as goal and Not my goal.

## Gotchas

- The edit route reaches edit state, but the text input is not represented in the Simulator frame. Typing and Enter submission are unproven.
- Suggestion IDs can change with fixture data.

## Button keys

goal-row, edit-goal, cancel-goal, switch-goal-0, dismiss-goal-0, use-detected-goal, sg-s-no-goal, ok-s-no-goal, no-s-no-goal
