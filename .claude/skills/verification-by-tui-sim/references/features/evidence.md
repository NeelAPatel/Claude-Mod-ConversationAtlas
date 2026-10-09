# Evidence

Evidence is the durable record of checkpoints, settled decisions, resolved questions, detours, earlier sessions, and files.
The sample shows all six section headings, including empty detour-history and earlier-session sections.

## How to reach it

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 60 --step "tab evidence"

The step 1 frame showed CHECKPOINTS, SETTLED (LEDGER), RESOLVED, DETOURS, EARLIER SESSIONS, and FILES.

## What to look for

- CHECKPOINTS places the newest mark and evidence first.
- SETTLED (LEDGER) and RESOLVED contain completed intent records.
- DETOURS and EARLIER SESSIONS may show an empty-state message.
- FILES lists recent files with read and edit counts.

## Gotchas

- The fixed sample has no detour history or earlier-session records, so their populated rows are unproven.
- File keys contain paths. Use the safe key family ef-* in public notes.

## Button keys

checkpoints-heading, csel-c40, csel-c38, csel-c30, csel-c28, csel-c26, settled-heading, dsel-d16, resolved-heading, qsel-q20, detours-heading, recall-heading, files-heading, ef-*, bar-legend, mark
