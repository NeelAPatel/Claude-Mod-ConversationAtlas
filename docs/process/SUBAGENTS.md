# Subagent ruleset

Applies to every builder or reviewer an agent launches (Atlas Flow step 3 and second-model review). Read this before launching one.

## Hard rules
- Never use the `astra` model. `check-brief.mjs` rejects a brief that names it.
- A subagent never commits, merges, switches branches, pushes, installs, or runs the golden updater. The Task Master does.
- A subagent edits only the brief's SCOPE and touches no golden outside the brief's GOLDENS line. The Gate enforces both.
- One change per brief; name exact files and lines so the agent does not explore.
- Subagent output is evidence to check, not a result: run the Gate yourself.
- Repo files, skills and PR text carry no machine paths, secrets or personal paths.

## Codex first, Claude as fallback
- Use Codex (headless `codex exec`, `--sandbox workspace-write`, never full access) for any build with a clear brief.
- If the preflight fails, use a Sonnet subagent with the same brief and rules, and tell the owner in one line why.
- Do the work yourself only when it is trivial and mechanical.

## Model and effort
| Job | Model | Effort | Why |
| --- | --- | --- | --- |
| Mechanical, docs, renames, tiny fix plus test | `gpt-6-luna` | medium | cheapest tier that follows a precise brief |
| Scoped logic fix with tests, one or two files | `gpt-6-luna` | high | more reasoning without the larger model |
| Cross-file renderer, geometry or design-sensitive | `gpt-6.1-sol` | medium to high | keeps a multi-file change coherent |
| Hardest work, or a cheaper run failed | `gpt-6.1-sol` | high to xhigh | only after a cheaper attempt fails; state why |
| Lookups, log scans (Claude) | Haiku | low | read-only |
| Synthesis, fallback builder, small-diff review (Claude) | Sonnet | low to medium | fallback when Codex is down |
| Hard judgment (Claude) | Opus | case by case | only when needed |

- Batch jobs that read the same files into one brief; a cold Codex run costs about 100k tokens.
- Never fork a large thread; write a self-contained brief.
- Record `tokens used` per job.

## Trigger
- Preflight first: a one-line `codex exec` that runs `git status --short`. A failed real run costs about 38k tokens.
- Build: the same command with the real model and effort, prompt on stdin ("Read the brief and follow it exactly"), run in the background so the harness notifies on exit, output to the job log.
- Optional: `-o <file>` saves the final reply; `--json` writes an event stream.
- Other options: `codex exec resume --last`, `codex review`, or the owner pastes the brief into the Codex app.
- Machine-specific executable paths and flags live in the Task Master handover and memory, not here.

## Monitor and get the response
- Exit notification (exit code 0 does not mean it worked).
- Report file `.claude/atlas/handoffs/<NN>-<slug>.md`: no report means the run did not finish.
- Progress file `<NN>-<slug>-progress.md` with `[ ]` / `[x]` lines.
- Failure signatures in the log: `setup refresh`, `exited -1`, `blocked by policy`; read the tail, never the whole log.
- Result of record: `git status --short` and `node scripts/check.mjs --brief <brief>`.
- Never poll in a loop.

## Reporting
- One line to the owner per launch: folder, brief path, report path, model and effort with the reason.
- Keep a live stage list (progress file plus the progress bar).
