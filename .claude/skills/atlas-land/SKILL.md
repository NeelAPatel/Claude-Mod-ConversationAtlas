---
name: atlas-land
description: "Clean up after the owner merges an Atlas pull request (close the issue, update dev, delete the merged branch, archive job files, ask about installing). Use for /atlas-land <PR number>."
---

# Atlas land

Run only after the PR shows `MERGED` (`gh pr view <n> --json state,closingIssuesReferences`).

1. `gh issue close <issue> --comment "Landed via PR <n>."` for each issue the PR closed. `Closes #n` into `dev` does not auto-close.
2. `git switch dev && git pull --ff-only`. Delete the merged local branch with `git branch -d` (never `-D`; if `-d` refuses, stop and ask).
3. Move the job's brief, progress, report and log into `.claude/atlas/handoffs/archive/`; keep the report path in the closing note.
4. Append one row to `.claude/atlas/ledger.tsv`: date, PR, issue, patch-id (from `check.json`), verdict, model and tokens used. This is local; do not commit it.
5. If the change affects the installed build, ask the owner whether to install: `claude plugin validate .`, `claude plugin test .`, then `scripts/install-atlas.ps1`, then `/reload-plugins`. Install only on their word.
6. Ask whether any finished Imp or Co-Master chat can be archived. Never archive without the owner's word.
7. Pick the next issue in order and offer `atlas-triage`.
