---
name: atlas-mockup
description: Append a fake but realistic project history ("Tidepool", a neighbourhood tool-lending app) to the live Conversation Atlas so every section and icon shows 2-4 examples. Run when the user says "mockup" or /atlas-mockup. Works in the desktop GUI and the terminal TUI. Does not touch the user's project.
---

# Atlas mockup

Purpose: fill the Atlas pane with demo data so the owner can eyeball every section and icon.
It **appends** to whatever is already there; it will not make sense for this chat, and that is fine.
Run the waves below in order, exactly as written. Do not improvise content, do not ask questions,
do not tell the user the pane exists beyond the final report. Narrate one line per wave.

## Rules

- **Never touch the user's project files.** Scratch files go in `SCRATCH` = `$CLAUDE_JOB_DIR/tmp/atlas-mockup`
  if that variable is set, otherwise the system temp dir + `/atlas-mockup`. Create it first.
- No git commits, no real tests, no network. Commands are harmless `echo`s.
- Make calls in one wave **in parallel** where independent. Each wave = one `observe` call plus the
  tool calls listed, in the same response.
- Decision wording matters: Atlas marks a decision **major (!)** when it contains one of
  architecture, schema, API, security, release, publish, delete, migrate, replace, rename, breaking,
  public, data, must, never, always, default, "go with"; otherwise **minor (·)**. The wording below
  is already chosen. Keep it verbatim.
- Hand-offs: Atlas turns an `Agent` call into a hand-off (→) and its completion into a report-back (←).
  A shell command starting with `codex` becomes a Codex hand-off; its report-back arrives when a file
  appears at `<project root>/.claude/atlas/handoffs/<slug>.md` where `<slug>` is the `.md` name in the command.

## Cast

Project **Tidepool**: a neighbourhood tool-lending app for one street.
Targets of coverage: 3 goals, 8 topics, 3 detours + 3 returns, 4 major + 4 minor decisions,
4 questions (2 resolved), 3 checkpoints, 3 next steps, 3 Codex + 3 Haiku hand-offs with report-backs,
3 edited + 3 read files, 2 failures, 3 passes.

## Wave 0: scratch

Bash: `mkdir -p "SCRATCH/tidepool"` (resolve SCRATCH as above).

## Wave 1: kickoff

`observe`: goal "Ship a tool-lending app for one street", topic "Tidepool kickoff", shift "sibling",
next "Draft the inventory model".
Write `SCRATCH/tidepool/inventory.md` ("# Inventory\n- item: name, photo, owner\n").
Write `SCRATCH/tidepool/booking.md` ("# Booking\n- loans last three days\n").
Read `SCRATCH/tidepool/inventory.md`.

## Wave 2: data model

`observe`: topic "Inventory model", shift "subtopic",
decisions ["Go with Postgres; schema has items, loans and members", "Item cards show a photo first"],
questions ["Who pays when a tool breaks?"].
Edit `inventory.md` (add a line "- loan: item, member, due date").
Bash: `echo pytest tidepool inventory` (a pass; Atlas reads it as a passing test).
Bash: `ls "SCRATCH/tidepool/missing-file"; echo exit $?` (a failure ✗).
Bash with `description` "Seed demo items": `echo seeded 12 items`.

## Wave 3: first hand-offs

`observe`: topic "Booking rules", shift "sibling",
decisions ["Deposits must never be held by the app", "Loans last three days"],
checkpoint "Inventory model drafted".
Agent (model haiku, subagent_type general-purpose), description "Haiku: name 10 tool categories",
prompt "Reply with the single word OK. Use no tools."
Agent (model haiku), description "Haiku: draft a friendly reminder text", same prompt.
Bash, description "Codex: booking calendar spike":
`codex() { :; }; codex --title "Codex: booking calendar spike" mock-codex-1.md`
Write `<project root>/.claude/atlas/handoffs/mock-codex-1.md` with:
```
status: done
summary: Booking calendar spike works for three-day loans
branch: feat/mock-calendar
tests: 4 passed
files:
- src/booking/calendar.ts
- src/booking/calendar.test.ts
```

## Wave 4: detour 1 and return

`observe`: topic "Logo and brand colors", shift "possible-detour", why "Side trip while naming the app",
decisions ["Use a teal accent color"], questions ["Do neighbours need ID checks?"].
Read `inventory.md`. Edit `booking.md` (add "- late fee: none for beta").
Agent (model haiku), description "Haiku: suggest three logo ideas", same prompt.
Then in the same wave or the next response: `observe` topic "Booking rules", shift "return",
why "Logo parked, back to booking", next "Define the late-return rule".

## Wave 5: deposits and damage

`observe`: goal "Make lending safe enough to trust strangers", topic "Deposit and damage",
shift "subtopic", decisions ["Always delete member data on request"],
resolved ["Who pays when a tool breaks?"],
questions ["Is a paper sign-up sheet enough for beta?"].
Bash, description "Codex: damage report form": `codex() { :; }; codex --title "Codex: damage report form" mock-codex-2.md`
Write `<project root>/.claude/atlas/handoffs/mock-codex-2.md`:
```
status: blocked
summary: Damage form needs a decision on photo uploads
branch: feat/mock-damage
tests: not run
files:
- src/forms/damage.tsx
```
Bash: `echo pytest tidepool deposits` (pass). Bash: `echo pytest tidepool damage; exit 1` (failure ✗).

## Wave 6: reminders, trust

`observe`: topic "Notification reminders", shift "sibling",
decisions ["Reminders go out at 9am", "API is public read-only until beta ends"],
checkpoint "Booking flow works end to end".
Agent (model haiku), description "Haiku: summarize reminder timing options", same prompt.
Bash, description "Codex: reminder scheduler": `codex() { :; }; codex --title "Codex: reminder scheduler" mock-codex-3.md`
Write `<project root>/.claude/atlas/handoffs/mock-codex-3.md`:
```
status: failed
summary: Scheduler spike hit a timezone bug
branch: feat/mock-reminders
tests: 1 failed
files:
- src/reminders/schedule.ts
```
Read `booking.md`. Edit `inventory.md` once more.

## Wave 7: detours 2 and 3, returns

`observe`: topic "Hosting cost comparison", shift "possible-detour", why "Curious about free tiers",
decisions ["Weekly digest on Sundays"].
Bash, description "Compare hosts": `echo hosting: small vm vs serverless`.
`observe`: topic "Trust scores", shift "return", why "Costs noted, back to trust", questions ["Should kids have accounts?"].
`observe`: topic "Fix flaky calendar library", shift "possible-detour", why "Calendar test flaked once".
`observe`: topic "Trust scores", shift "return", why "Flake was a clock issue, back to trust",
resolved ["Do neighbours need ID checks?"], next "Write the beta invite message".
(Four observes may be one call each, in that order, in the same response.)

## Wave 8: beta and wrap-up

`observe`: topic "Beta launch plan", shift "sibling", goal "Launch Tidepool beta to 20 households",
decisions ["Release is invite-only for the first month"], checkpoint "Beta checklist complete",
next "Print the sign-up sheet".
Agent (model haiku), description "Haiku: proofread the invite", same prompt.
Wait roughly 6 seconds (`sleep` is blocked: use a tiny harmless Bash such as `echo waiting` twice), then
delete the three `mock-codex-*.md` files from `<project root>/.claude/atlas/handoffs/` so no litter remains.

## Final report

Say in 3 lines: what was appended, that scratch files live in SCRATCH, and that these need the owner's
**pane presses** (observation never writes intent): ◆ settle decisions, confirm the ◎ goal,
Take detour on a ↳ suggestion, ⚑ + Mark checkpoints, ◎ resume earlier session, Keep/Exclude detour findings.
End with `result:` and a one-line headline.
