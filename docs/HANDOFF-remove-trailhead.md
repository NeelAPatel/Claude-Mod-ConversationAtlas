# Handoff: remove Trailhead from the code

Trailhead is retired and Atlas owns all of its features (owner, 2026-10-04). Public docs (README,
`docs/REFERENCE.md`) are already clean on `main` and `dev`. This job removes what is left in code. Branch:
`feat/remove-trailhead`, cut from `dev`. One change; goldens may change only where noted.

## Remove

- `hooks/recall.ts`: `TRAILHEAD_DIR`, `fromTrailheadFile`, the `.claude/trailhead/` header line, the
  "Trailhead session keeps only its highest checkpoint" logic.
- `hooks/register.tsx`: the `fromTrailheadFile` / `TRAILHEAD_DIR` imports and the
  `[TRAILHEAD_DIR, fromTrailheadFile]` source entry; reword the `recover` help text and the
  "No earlier Atlas or Trailhead sessions" message to "earlier sessions".
- `types/index.d.ts`: narrow `source: 'atlas' | 'trailhead'` to `'atlas'` (or drop the field if
  nothing else needs it); reword the three Trailhead comments.
- `hooks/model.ts` (`adoptRecall`, ~line 929): drop the `r.source === 'trailhead'` branch; reword
  the comments at ~422, 426, 761, 795, 851, 914 to describe the behaviour without the history.
- `hooks/screens/evidence.ts` (lines ~42, 193, 213): drop the Trailhead labels. The `EARLIER
  SESSIONS` meta and the `source:` detail line change, so **the Evidence goldens (terminal and
  desktop) will change**; review that diff and no other.
- `tests/atlas.test.tsx`: the `TRAILHEAD_CHECKPOINT` fixture, the `merge: Trailhead features inside
  Atlas` block (~599-629), the ~116 test title, and the ~797-800 fs mocks. Keep the Atlas-side
  assertions (keep/exclude, outcome, return packet) with Atlas-only wording.
- `.gitignore` comment (line 4) and `AGENTS.md` lines 10, 12, 21: reword or delete.

## Leave alone

`docs/HISTORY.md`, `docs/DECISIONS.md`, `docs/audit-*`: historical records.
`hooks/screens/trail.ts` only matches `trailHeading` (false positive).

## Check

`claude plugin validate .`, `claude plugin test .`, `scripts/check-seam.ps1`, then
`grep -ri trailhead` outside the historical docs should be empty.

## Open question

Owner's own old `.claude/trailhead/*.json` saves become unreadable after this. If any matter,
convert them to Atlas saves first.

## Status

Not started. Queue as one Codex job on `feat/remove-trailhead` (cut from `dev`); Claude reviews the
Evidence golden diff, merges to `dev` and installs for the owner to try before anything moves to `main`.
