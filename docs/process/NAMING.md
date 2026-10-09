# Naming and communication standard

Applies to every chat, agent, branch, file and reply. Goal: the owner can follow the work from one place.

## One front door
- The owner talks only to the active `Task Master #N`.
- Worker and co-master chats report to the Task Master, never ask the owner directly.
- A worker that needs an owner decision sends the Task Master one question with a default.
- The Task Master asks the owner one decision at a time, with a default, in a short reply.

## Work items
- Name work only by GitHub number: `#NN` (issue) and `PR #NN` (pull request).
- Never use ordinals or invented labels ("PR 2", "layer 1", "dry run", "the spike") as names.
- Every work package gets an issue before work starts. No issue, no job.
- `Closes #NN` goes in the PR; the Task Master closes the issue after the merge.

## Chats
- `Task Master #N`: the one active lead.
- `Imp-<issue#>-<slug>`: a worker chat for one issue (for example `Imp-66-verify-atlas`).
- `Done - <name>`: finished chat; archive it after renaming.
- One active worker per issue; one job at a time in the main folder.

## Branches and files
- Branch: `<feat|fix|chore>/<issue#>-<slug>` cut from `dev`.
- Job files in `.claude/atlas/handoffs/`: `<issue#>-<slug>-brief.md`, `-progress.md`, `.md` (report), `.log`.
- Handover for a new lead: `master-<N>-kickoff.md`.

## Vocabulary (use these words, nothing else)

| Term | Meaning |
| --- | --- |
| Simulator | `scripts/control-atlas.ps1`: draws the real Atlas pane as text for a size and a list of steps |
| Gate | `node scripts/check.mjs`: validate, tests, seam, script tests, golden scope, scope, `tsc` when possible |
| Brief | the job file a builder follows (`docs/process/brief-template.md`) |
| Atlas Flow | the seven fixed steps every issue takes: Triage, Brief, Build, Check, Ship, Merge, Land (`ATLAS_FLOW.md`) |
| Proof check | the table of claims, labels and evidence that every PR carries |
| Handover | the kickoff file one Task Master leaves for the next |
| Golden | a saved text snapshot of a drawn screen in `tests/golden/` |

## Proof check
- Every PR's "Proof check" section is a table: Claim | Label | Evidence.
- Labels (exactly these):
  - `sim-verified`: replayed with the Simulator, frames read.
  - `unit-test-verified`: a test or the Gate covers it.
  - `type-check-only`: only `tsc` or validation.
  - `unproven (owner-eye)`: needs the owner's eyes (real look, word wrapping, real wheel or mouse).
- State what the check cannot show (the Simulator does not check word wrapping or real input).
- Do not call outside projects or tools by name in PR text; describe the check.

## Replies
- Lead with the outcome; bullets for status, prose for reasoning.
- End every reply that mentions labels, numbers or chats with a "reference" table: Label | What it is | Status.
- Keep replies short: one decision at a time, with a default so "yes" is the answer.
