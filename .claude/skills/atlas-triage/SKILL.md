---
name: atlas-triage
description: Triage a Conversation Atlas GitHub issue (new or existing) into layer, golden impact, shared files, size, route and blockers before any brief is written. Use for /atlas-triage <issue number>.
---

# Atlas triage

Input: an issue number. Output: one triage comment on the issue and a one-line route for the owner. Read-only except the comment, label and milestone edits.

1. `gh issue view <n> --json title,body,labels,milestone,comments`. Read AGENTS.md invariants only if the issue touches intent, state or the surface seam.
2. Restate the issue in two sentences in your own words. If you cannot, the issue is under-specified: label it `decision-needed` and ask the owner one question (use AskUserQuestion with a default).
3. Fill these fields:
   - **Layer:** engine, ui-base, tui, gui, docs, process.
   - **Golden impact:** none, terminal, desktop, both. Name the goldens when known (list `tests/golden/*.txt`).
   - **Shared files:** `register.tsx`, `live.tsx`, `screens/*`, `view.tsx` need an owner-approved job; say if already approved.
   - **Size:** S (one file), M (two to four files), L (cross-file or design-sensitive).
   - **Route** (see `docs/process/models.md`): S/M with a clear spec goes to Codex; L or design-sensitive goes to Codex sol or an Imp chat; trivial mechanical edits are done directly.
   - **Blockers:** native GitHub links, or issues that must land first.
   - **Milestone:** patch (fix without new capability) vs minor (one capability); Tooling for process.
4. Check for duplicates: `gh issue list --search "<keywords>" --state all`.
5. Post the comment (`gh issue comment <n> --body-file ...`) and set the milestone/labels if missing. Do not close anything.
6. Reply with: route, size, golden impact, blockers, and whether the owner has a decision to make (with the default).

Do not write the brief here; that is `atlas-brief`. Never reference private paths or secrets: the repo is public.
