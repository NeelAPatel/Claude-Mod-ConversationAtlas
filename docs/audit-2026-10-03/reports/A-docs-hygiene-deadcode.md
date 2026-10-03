# Slice A — docs, guidance, repo hygiene, dead code

Read-only audit completed. No implementation, configuration, golden, branch, installation, or report-file changes were made. Findings concern the checkout baseline (`5d642de`, audit wrapper `9fdf97c`); no finding concerns the installed snapshot (`a70e975`).

## Confirmed defects

### A-01 — Documentation describes removed popup and Legend controls

- Category: documentation / in-app guidance
- Severity: misleading
- Evidence: confirmed
- Surface/version: both; checkout
- Evidence: [`AGENTS.md:20`](<F:/LocalProj/Claude-Mod-ConversationAtlas/AGENTS.md:20>), [`README.md:165`](<F:/LocalProj/Claude-Mod-ConversationAtlas/README.md:165>), [`README.md:167`](<F:/LocalProj/Claude-Mod-ConversationAtlas/README.md:167>), [`docs/HANDOFF-ui-architecture.md:38`](<F:/LocalProj/Claude-Mod-ConversationAtlas/docs/HANDOFF-ui-architecture.md:38>), [`hooks/view.tsx:543`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/view.tsx:543>), [`hooks/view.tsx:317`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/view.tsx:317>), [`tests/atlas.test.tsx:1436`](<F:/LocalProj/Claude-Mod-ConversationAtlas/tests/atlas.test.tsx:1436>).

Trigger: a contributor or user follows the current guidance.

What happens: the guidance says Trail events, Decisions, and Open questions use popups, and that the Legend has a “More” popup. Current code expands Trail events inline; ordinary decision/question rows expand inline; the remaining popups are mainly Trail View and long-item overflow. The Legend has no More control. Tests explicitly assert that expanded Trail events do not create `atlas-popup`.

Impact: users receive incorrect interaction instructions, and future work may reintroduce controls deliberately removed by T2/T3.

Proposed fix: update current instructions and README interaction documentation. Preserve historical decision-log entries as history, but mark obsolete designs as historical. Verify with a repository-wide search for `More`, `legend-more`, and popup claims, then compare against the current tests. Documentation-only changes require no golden changes; changed Legend or setup copy would affect only the corresponding `*-legend` or `*-setup` goldens.

### A-02 — Current handoffs contain obsolete branch, agent, and commit authority

- Category: documentation / workflow
- Severity: bug
- Evidence: confirmed
- Surface/version: repository workflow; checkout
- Evidence: [`docs/HANDOFF-codex.md:3`](<F:/LocalProj/Claude-Mod-ConversationAtlas/docs/HANDOFF-codex.md:3>), [`docs/HANDOFF-codex.md:8`](<F:/LocalProj/Claude-Mod-ConversationAtlas/docs/HANDOFF-codex.md:8>), [`docs/HANDOFF-codex.md:18`](<F:/LocalProj/Claude-Mod-ConversationAtlas/docs/HANDOFF-codex.md:18>), [`docs/HANDOFF-codex.md:26`](<F:/LocalProj/Claude-Mod-ConversationAtlas/docs/HANDOFF-codex.md:26>), [`docs/HANDOFF-ui-architecture.md:7`](<F:/LocalProj/Claude-Mod-ConversationAtlas/docs/HANDOFF-ui-architecture.md:7>), [`docs/HANDOFF-desktop-ui.md:28`](<F:/LocalProj/Claude-Mod-ConversationAtlas/docs/HANDOFF-desktop-ui.md:28>), [`AGENTS.md:5`](<F:/LocalProj/Claude-Mod-ConversationAtlas/AGENTS.md:5>).

Trigger: an agent follows one of the handoff files as its current workflow.

What happens: the handoffs tell Codex to switch branches, commit, merge, install, and use visible `danger-full-access` execution. Current `AGENTS.md` says Codex must not commit, merge, or switch branches; headless execution is permitted with `--sandbox workspace-write`.

The Codex handoff also reports `dev` at `a027890`, while the actual local `dev` and `main` point to `5d642de`, and the current branch is `audit/self-audit` at `9fdf97c`.

Impact: stale instructions can cause unauthorized branch mutations or work on the wrong baseline.

Proposed fix: rewrite handoff workflow sections to defer to `AGENTS.md`; separate historical session state from current operating rules. Verify from a clean checkout that no current handoff instructs Codex to commit, merge, switch branches, or use full-access sandboxing. No golden changes.

### A-03 — Publication and license status is contradictory

- Category: release hygiene / documentation
- Severity: misleading
- Evidence: confirmed
- Surface/version: public release documentation; checkout
- Evidence: [`README.md:368`](<F:/LocalProj/Claude-Mod-ConversationAtlas/README.md:368>), [`README.md:370`](<F:/LocalProj/Claude-Mod-ConversationAtlas/README.md:370>), [`docs/DECISIONS.md:79`](<F:/LocalProj/Claude-Mod-ConversationAtlas/docs/DECISIONS.md:79>), [`AGENTS.md:4`](<F:/LocalProj/Claude-Mod-ConversationAtlas/AGENTS.md:4>), [`LICENSE:1`](<F:/LocalProj/Claude-Mod-ConversationAtlas/LICENSE:1>), [`docs/HANDOFF-codex.md:11`](<F:/LocalProj/Claude-Mod-ConversationAtlas/docs/HANDOFF-codex.md:11>).

Trigger: a user or contributor reads the public-facing documentation.

What happens: the repository contains an MIT `LICENSE` and has a public GitHub remote, while README and decision text say no license or publication decision exists.

Impact: legal and release status is unclear to users and contributors.

Proposed fix: update README and current status guidance to reflect the completed publication decision and MIT license. Do not rewrite the historical decision log; append a superseding status entry if needed. Version `0.1.0` matches the plugin manifest and is not itself a defect. No golden changes.

### A-04 — Unreachable popup state and unused UI exports remain

- Category: dead code
- Severity: inefficiency
- Evidence: confirmed
- Surface/version: both renderers; checkout
- Evidence: [`types/index.d.ts:202`](<F:/LocalProj/Claude-Mod-ConversationAtlas/types/index.d.ts:202>), [`hooks/register.tsx:440`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/register.tsx:440>), [`hooks/register.tsx:956`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/register.tsx:956>), [`hooks/view.tsx:776`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/view.tsx:776>), [`hooks/ui/index.tsx:17`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/ui/index.tsx:17>), [`hooks/ui/index.tsx:400`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/ui/index.tsx:400>), [`hooks/view.tsx:1060`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/view.tsx:1060>).

Inventory:

- `AtlasPopup.kind = 'legend'` has no constructor. Legend state is `view.legend`, and `activePopup()` handles only `trail-view` and `item`.
- The `popup.kind === 'legend'` scroll branch is therefore unreachable.
- `UiRow` and `Row` have no consumers.
- `barWidth()` has no consumers.
- `ago` is re-exported from `view.tsx` without a consumer.
- No obsolete `fit()` function remains. The `fits` predicate in `layoutRow()` is live and must not be removed.

Impact: stale API surface increases maintenance cost and makes the popup model appear broader than it is.

Proposed fix: remove only the unreachable variant, branch, unused primitive/export, and associated type comments after checking imports. Verify with type-checking and symbol search. Expected golden scope: none.

### A-05 — Trailhead compatibility is live recovery code, not dead code

- Category: dead-code inventory / migration compatibility
- Severity: misleading
- Evidence: confirmed
- Surface/version: recovery path; checkout
- Evidence: [`hooks/recall.ts:4`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/recall.ts:4>), [`hooks/recall.ts:58`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/recall.ts:58>), [`hooks/register.tsx:346`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/register.tsx:346>), [`hooks/register.tsx:351`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/register.tsx:351>), [`hooks/screens/evidence.ts:192`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/screens/evidence.ts:192>), [`tests/atlas.test.tsx:374`](<F:/LocalProj/Claude-Mod-ConversationAtlas/tests/atlas.test.tsx:374>`).

Trigger: `/atlas recover` scans a project containing legacy `.claude/trailhead` envelopes.

What happens: `fromTrailheadFile()` parses old checkpoints, `loadRecall()` includes them, Evidence labels them, and tests verify resume behavior.

Impact: deleting this code would break the documented migration/recovery path.

Proposed fix: retain the parser and tests, but rename comments and user-facing wording to “legacy Trailhead compatibility.” Keep historical Trailhead references in `HISTORY.md`. Verify recovery from an old envelope and an Atlas save. No golden changes.

### A-06 — Obsolete test names, comments, and legacy terminology remain

- Category: test/documentation hygiene
- Severity: inefficiency
- Evidence: confirmed
- Surface/version: repository maintenance; checkout
- Evidence: [`tests/atlas.test.tsx:1061`](<F:/LocalProj/Claude-Mod-ConversationAtlas/tests/atlas.test.tsx:1061>), [`tests/fixtures/sample.ts:113`](<F:/LocalProj/Claude-Mod-ConversationAtlas/tests/fixtures/sample.ts:113>), [`types/index.d.ts:42`](<F:/LocalProj/Claude-Mod-ConversationAtlas/types/index.d.ts:42>`).

Examples:

- Tests still assert absence of `legend-more` and `LEGEND · MORE`, despite the feature having been removed.
- The sample fixture calls the inline Trail expansion a “Trail event popup.”
- The type comment still refers to Trailhead’s `/trail exclude`, although the current command is `/atlas exclude`.

Impact: stale terminology obscures which behaviors are intentional and makes future searches noisy.

Proposed fix: replace negative removed-control assertions with positive current behavior assertions, update fixture comments, and label legacy semantics explicitly. Verify that remaining Trailhead references are limited to compatibility code and historical records. No golden changes.

### A-07 — Line-ending policy is implicit and inconsistent

- Category: repository hygiene
- Severity: inefficiency
- Evidence: confirmed
- Surface/version: repository; checkout
- Evidence: repository has no `.gitattributes`; `git ls-files --eol` reports index LF but many working-tree files CRLF, with `README.md` mixed. `core.autocrlf` is currently `true`.

Trigger: a Windows contributor edits source or regenerates goldens.

What happens: line-ending-only changes can appear in diffs, especially for golden files.

Impact: reviewers may mistake normalization noise for visual changes, and golden-scope checks become less reliable.

Proposed fix: add an explicit `.gitattributes` policy and normalize deliberately in a separate housekeeping change. Verify with `git ls-files --eol`, a clean diff, and a golden diff review. Do not regenerate goldens as part of the policy change.

### A-08 — Golden manifest is synchronized now, but the updater does not remove stale files

- Category: golden/release hygiene
- Severity: inefficiency
- Evidence: confirmed
- Surface/version: TUI/GUI golden maintenance; checkout
- Evidence: [`tests/golden/update-goldens.ps1:26`](<F:/LocalProj/Claude-Mod-ConversationAtlas/tests/golden/update-goldens.ps1:26>), [`tests/golden/update-goldens.ps1:31`](<F:/LocalProj/Claude-Mod-ConversationAtlas/tests/golden/update-goldens.ps1:31>), [`tests/golden/update-goldens.ps1:41`](<F:/LocalProj/Claude-Mod-ConversationAtlas/tests/golden/update-goldens.ps1:41>), [`tests/golden.test.tsx:134`](<F:/LocalProj/Claude-Mod-ConversationAtlas/tests/golden.test.tsx:134>`).

Current state: 28 `.txt` files and 28 manifest entries exist, with no missing, extra, or content-mismatched entries in a read-only comparison.

Latent trigger: a golden is renamed or removed and the updater is run.

What happens: the updater rewrites captured files and `manifest.ts`, but never deletes old `.txt` files.

Impact: stale review artifacts can remain in `tests/golden/`, even though runtime tests use only the manifest.

Proposed fix: have the updater remove or reject unreferenced golden files in a disposable destination. Verify set equality between manifest keys and `.txt` files. No intentional golden changes.

### A-09 — Strict TypeScript verification depends on an external, unpinned project

- Category: reproducibility
- Severity: bug
- Evidence: confirmed
- Surface/version: repository tooling; checkout
- Evidence: [`docs/HANDOFF-codex.md:23`](<F:/LocalProj/Claude-Mod-ConversationAtlas/docs/HANDOFF-codex.md:23>), [`docs/HANDOFF-ui-architecture.md:12`](<F:/LocalProj/Claude-Mod-ConversationAtlas/docs/HANDOFF-ui-architecture.md:12>), [`.gitignore:2`](<F:/LocalProj/Claude-Mod-ConversationAtlas/.gitignore:2>), [`README.md:343`](<F:/LocalProj/Claude-Mod-ConversationAtlas/README.md:343>`).

Trigger: a fresh checkout attempts the documented strict tsc command.

What happens: the command depends on `C:/Users/Neel/AppData/Local/Temp/claude/tc-atlas` and generated declarations outside the repository. The checkout itself has no `.claude-plugin/types` directory.

Impact: strict type-checking is not reproducible from repository contents alone and silently depends on one machine’s Claude installation.

Proposed fix: provide a repository-local type-check configuration and a pinned SDK declaration/bootstrap path, while keeping runtime-generated files ignored. Verify from a fresh checkout without the existing external temp project. No golden changes.

### A-10 — Installer cleanup is narrower than its “wholesale replacement” comment

- Category: release hygiene
- Severity: bug
- Evidence: confirmed
- Surface/version: private installed copy; checkout script
- Evidence: [`scripts/install-atlas.ps1:19`](<F:/LocalProj/Claude-Mod-ConversationAtlas/scripts/install-atlas.ps1:19>), [`scripts/install-atlas.ps1:29`](<F:/LocalProj/Claude-Mod-ConversationAtlas/scripts/install-atlas.ps1:29>), [`scripts/install-atlas.ps1:38`](<F:/LocalProj/Claude-Mod-ConversationAtlas/scripts/install-atlas.ps1:38>`).

Trigger: an existing installation contains root-level files that are no longer in the copy list, such as old `docs`, `scripts`, or `LICENSE` content.

What happens: the installer removes only `hooks`, `types`, `tests`, `README.md`, and `AGENTS.md`, then copies those same paths. Other old root-level files remain.

Impact: a private installation can accumulate stale non-runtime files across versions. The current omission of docs and LICENSE is an intentional private-install boundary; the cleanup mismatch is the defect.

Proposed fix: make the owned installation file set explicit and clean only that validated set, or install into a fresh versioned directory and switch the active copy. Verify in a disposable destination containing an extra stale file. No golden changes.

### A-11 — Remote integration branch is stale relative to local `dev`

- Category: branch hygiene
- Severity: misleading
- Evidence: confirmed
- Surface/version: repository collaboration; checkout
- Evidence: local `dev`/`main` point to `5d642de`; `origin/main` points to `5d642de`; `origin/dev` points to `b1b90ec`. The full local branch inventory also contains multiple prior feature branches and the installed snapshot.

Trigger: a contributor clones the repository and checks out `origin/dev`.

What happens: they receive the older `b1b90ec` baseline rather than the local integration branch at `5d642de`.

Impact: contributors can unknowingly work from an obsolete branch.

Proposed fix: reconcile remote refs only after explicit user authorization. Remove or retain historical feature branches according to the project’s branch policy. Verify local/remote branch topology afterward. No golden changes.

## Intentional history and compatibility

`docs/HISTORY.md` and `docs/DECISIONS.md` are historical records and should not be rewritten merely to remove old Trailhead or popup terminology. The current instructions in `AGENTS.md`, README, and handoff files should be corrected or explicitly marked historical.

The current in-app Legend and setup screen contain no `[ change ]` or More control references. The live `LEGEND` table is at [`hooks/view.tsx:543`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/view.tsx:543>), and setup copy begins at [`hooks/view.tsx:622`](<F:/LocalProj/Claude-Mod-ConversationAtlas/hooks/view.tsx:622>).

## Architectural improvements, separate from confirmed defects

- Establish one short current-status document for branch authority, publication status, supported SDK, install scope, and verification commands.
- Keep historical logs immutable and link them from current contributor guidance.
- Make generated goldens and generated SDK declarations explicitly machine-checkable rather than relying on process conventions.
- Treat Trailhead as a named compatibility adapter with a documented retirement boundary, not as active product terminology.

## Coverage matrix

| Area | Checked | Result |
|---|---|---|
| Current rules and guidance | `AGENTS.md`, README, all handoffs, decisions, history, golden README | Conflicts and stale current instructions identified; historical records separated |
| In-app explanations and setup | `hooks/screens/*.ts`, `hooks/view.tsx`, `hooks/register.tsx` | Current Legend/setup contain no More or `[ change ]`; popup guidance is stale in README/AGENTS |
| Trailhead paths | `recall.ts`, `register.tsx`, Evidence, types, tests | Confirmed live compatibility path; not dead |
| Dead code and exports | Cross-file symbol search in `hooks`, `types`, and tests | Unreachable `legend` popup state, unused `Row`, `barWidth`, and `ago` re-export found; no obsolete `fit()` function found |
| Golden generation | updater, golden test, manifest, all 28 text files | Manifest and text files currently synchronized; updater lacks stale-file cleanup |
| Line endings | `.gitattributes`, `git ls-files --eol`, Git config | No `.gitattributes`; mixed working-tree line endings confirmed |
| Reproducibility | tsc instructions, `.gitignore`, external config presence | External temp project dependency confirmed |
| Installer | `scripts/install-atlas.ps1`, plugin manifest | Copy set and cleanup allowlist inspected; stale-root-file risk confirmed |
| Branch hygiene | local and remote refs, status, log, tag | Audit branch and freeze tag confirmed; remote `origin/dev` is stale |
| Screenshots / visual UX | Not audited in Slice A | Deferred to Slice C |

## Verification gaps

- `claude plugin test`, `claude plugin validate`, and strict tsc were not run.
- No live installed-copy comparison was performed; the installed snapshot is Slice B scope.
- No fresh-clone or disposable-destination installer test was run.
- No visual or interaction claims from the twelve screenshots were evaluated; those belong to Slice C.
- Public GitHub state was inferred from local repository metadata and handoff text, not independently fetched.

## Ordered small fix jobs

1. Correct current README, AGENTS, and handoff guidance.  
   Dependency: none. Golden scope: none for documentation-only edits; `*-legend` or `*-setup` only if in-app copy changes.

2. Remove unreachable popup state and unused UI exports; update stale comments and obsolete negative tests.  
   Dependency: after the interaction model is documented. Golden scope: none expected.

3. Add explicit line-ending policy.  
   Dependency: none; do before future golden edits. Golden scope: no regenerated goldens; any normalization diff must be reviewed separately.

4. Harden golden updater with manifest/file-set equality and stale-file detection.  
   Dependency: line-ending policy. Golden scope: none unless the check exposes an existing mismatch.

5. Add a repository-local, pinned strict TypeScript verification path.  
   Dependency: decide supported SDK version. Golden scope: none.

6. Harden installer ownership/cleanup and verify in a disposable destination.  
   Dependency: current install boundary must be documented. Golden scope: none.

7. Reconcile stale remote and historical feature branches.  
   Dependency: explicit user authorization for remote or branch mutations. Golden scope: none.

