# Open

Open collects suggestions, observed decisions, and unanswered questions that need attention.
With an active detour and a new decision from it, the decisions section is named DETOUR FINDINGS.

## How to reach it

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "tab open"

The step 1 frame showed NEEDS YOUR CALL, OBSERVED DECISIONS, and OPEN QUESTIONS.

## What to look for

- Suggestions have a primary action and a dismiss or stay action.
- Observed decisions and questions expand inline to show source, time, status, and topic.
- A detour finding is a decision observed during an active detour.

## Gotchas

- The sample has no decision observed after the detour begins, so DETOUR FINDINGS cannot be reached with the supplied fixtures. That section is unproven in the Simulator.
- Short decision and question rows expand inline; see their feature files for the requested popup names.

## Button keys

suggestions-heading, sg-s15, sg-s12, observed-heading, dsel-d18, questions-heading, qsel-q22, bar-legend, mark
