# Atlas Flow

The one path every issue takes from idea to `dev`. "Run #NN through the Flow" means steps 1 to 7 below, in order. Names are fixed (see `NAMING.md`).

| # | Step | Skill or tool | Input | Output | Who |
| --- | --- | --- | --- | --- | --- |
| 1 | Triage | `atlas-triage` | issue `#NN` | triage comment: layer, golden impact, shared files, size, route, blockers; label `decision-needed` if the owner must choose | Task Master |
| 2 | Brief | `atlas-brief` | triaged issue | checked brief (`check-brief.mjs`), branch `<type>/<NN>-<slug>`, progress file, Codex preflight | Task Master |
| 3 | Build | Codex (else a Sonnet subagent) | brief | edits only the brief's SCOPE, iterates the Gate, writes the report | Builder |
| 4 | Check | `atlas-ship` + Gate (`node scripts/check.mjs --brief`); for UI changes, Simulator (`verification-by-tui-sim`) | built branch | `RESULT PASS`, reviewed diff, golden diff, Simulator frames read, Proof check labels | Task Master |
| 5 | Ship | `atlas-ship` | green branch | commit, owner's word, push, PR with `Closes #NN` and the Proof check | Task Master |
| 6 | Merge | owner | PR | merged into `dev`; the owner eye-tests only PRs marked `unproven (owner-eye)` | Owner |
| 7 | Land | `atlas-land` | merged PR | issue closed, `dev` updated, branch deleted, job files archived, install question | Task Master |

## Rules
- Only step 6 is the owner's. Commit, push, merge and install happen only on the owner's word.
- A decision is raised in step 1 (or later) as one question with a default; the Task Master asks, workers never do.
- Step 3 failure paths: Codex preflight fails -> Sonnet subagent builds; Gate red three times -> builder stops and writes the blocker.
- A new commit voids earlier Gate results; re-run step 4.
- Stacked branches pass `--base <parent>` to the Gate.
- For a UI change, step 4 replays the changed routes in the Simulator (TUI is the faithful view) and labels each claim.

## Not in the Flow
- Releases (`dev` -> `main`, tags): `docs/RELEASING.md`, owner's word.
- Chat housekeeping and handovers: `NAMING.md`.
