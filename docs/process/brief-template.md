# Implementation brief

## RESTATE
Restate the issue in your own words first: <what problem needs solving>

## GOAL
One sentence describing the outcome: <single outcome>

## SCOPE
Allow-list bullets only. Tag shared paths with `(shared)`.
- <path or glob>

## FORBIDDEN
List the actions and files that must not be touched: <constraints>

## GOLDENS
Write `none` or comma-separated golden basenames: <none or names>

## ACCEPTANCE
Checkable outcomes: <observable requirements>

## VERIFY
Exact commands, including `node scripts/check.mjs --brief <this file>`. For UI changes, list the Simulator routes to replay, taken from the feature pages of the `verification-by-tui-sim` skill (for example `tab trail`).

## TIMEBOX
Estimate and stop condition: <estimate and retry limit>

## REPORT
Name `.claude/atlas/handoffs/<slug>.md`; include status, summary, branch, tests, and files.

## Worked example

## RESTATE
The small status helper needs a usage example in its documentation.

## GOAL
Document one invocation of the status helper.

## SCOPE
- scripts/check.mjs

## FORBIDDEN
Do not change product files or golden snapshots.

## GOLDENS
none

## ACCEPTANCE
- The documentation shows the supported command.

## VERIFY
Run `node scripts/check.mjs` and review the output.

## TIMEBOX
Complete in one short documentation pass.

## REPORT
Write `.claude/atlas/handoffs/example.md` with status, summary, branch, tests, and files.
