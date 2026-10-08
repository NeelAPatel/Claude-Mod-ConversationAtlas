---
name: atlas-ship
description: Review a finished Codex job, run the gate, commit, and open the pull request with the evidence body, then wait for the owner's merge. Use for /atlas-ship after a job finishes.
---

# Atlas ship

Input: a finished job on its branch. Output: a PR into `dev` and a verdict. You never merge unless the owner says so in chat.

1. Read the Codex report (`.claude/atlas/handoffs/<slug>.md`) and `git status --short`. Reject the job if files outside the brief's SCOPE changed or a golden outside GOLDENS changed.
2. Run `node scripts/check.mjs --brief .claude/atlas/handoffs/<slug>-brief.md` (add `--base <parent-branch>` on a stacked branch; the default base is `dev`). It must print `RESULT PASS`. Read `.claude/atlas/tmp/check.json` and the golden diff, not whole logs. A new commit changes the patch-id and voids earlier results, so re-run after any edit.
3. Review the diff yourself for small jobs. For medium and larger jobs get a second opinion from a different model (Codex sol read-only, or `/code-review`) and sort findings: act on, consider, noted, dismissed with reasons.
4. If drawn output changed, check each golden diff against intent. For layout, resize, expansion and scroll behaviour, replay with `pwsh scripts/control-atlas.ps1 --surface tui|gui ...`. Wrapping and real pixels are not covered; label such a PR `owner-eye`.
5. Commit (end the message with the attribution line from the session). Show the exact push command and wait for the owner's word, then push.
6. Open the PR into `dev` with the body from `.github/pull_request_template.md`: `Closes #n`, Layer, Golden impact, Shared files, Why, What changed, Scope, Blast radius, Verification, and a verdict: `sim-verified`, `unit-test-verified`, `type-check-only` or `unproven (owner-eye)`. End with the PR attribution line. Bind monitoring with the ccd_pr tools.
7. Report to the owner: PR link, verdict, and anything that needs their eye.

Then wait. After the owner merges, use `atlas-land`.
