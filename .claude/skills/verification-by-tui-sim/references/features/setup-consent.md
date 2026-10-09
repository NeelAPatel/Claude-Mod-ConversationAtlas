# Setup consent

Setup consent asks which observation mode Atlas may use before the choice is recorded.
The setup fixture displays the choice screen without saved setup state.

## How to reach it

    pwsh scripts/control-atlas.ps1 --surface tui --state setup --width 80 --height 60 --step "snapshot"

The step 1 frame showed Set up Atlas, the observer explanation, and both choices.

## What to look for

- The screen explains the Claude observer, usage, and Engine only mode.
- The choice applies in every project, as the frame says.
- The visible buttons are Use Claude observer and Engine only (free).

## Gotchas

- The Simulator starts without a saved choice. Persistence outside its isolated fixture is not tested here.
- This route reaches the consent screen; it does not prove a real account or host setting changed.

## Button keys

setup-claude, setup-engine
