# Slice B — Architecture, Code Quality, SDK Correctness

## Audit basis

Read-only review of:

- Checkout: `audit/self-audit`, `5d642de`
- Installed snapshot: `snapshot/installed-2026-10-03`, `a70e975`
- SDK declarations and reference documentation
- Four supplied GUI screenshots

No files were changed, tests were not run, and no install or live-host validation was performed.

## Findings

### B-01 — GUI rendering still inherits terminal layout assumptions

- Category: architecture / layout
- Severity: bug
- Evidence: confirmed
- Surface/version: terminal and desktop; present in checkout and installed snapshot
- Files: `hooks/view.tsx:91-1050`, `hooks/ui/index.tsx:8-665`

`view.tsx` is the single layout shell for both surfaces. It uses terminal-derived element types, terminal-style cell measurement, fixed-width row layout, text indentation, repeated rule glyphs, and estimated row counts. `ui/index.tsx` adds shared primitives, but those primitives remain primarily terminal abstractions with GUI conditionals.

The desktop renderer therefore receives screen models shaped by terminal assumptions. This explains the GUI symptoms visible in the supplied screenshots: oversized empty regions, popup placement based on estimated rows, cropped content, and inconsistent bottom controls.

Proposed fix:

- Keep screen builders surface-neutral.
- Extract a semantic UI tree with no cell-width or terminal-glyph logic.
- Add separate TUI and desktop renderers.
- Let the desktop renderer use native flex sizing, native buttons, clipping, and `Svg` where appropriate.
- Keep terminal wrapping and cell truncation exclusively in the TUI renderer.

Verification:

- Add structural renderer tests for both surfaces.
- Manually inspect desktop map, evidence, legend, trail, and popup screens.
- Review only the goldens named by the migration job.

### B-02 — Scroll bounds are process-global while view state is shared

- Category: state / multi-surface behavior
- Severity: bug
- Evidence: confirmed statically; live dual-surface impact unverified
- Surface/version: both; present in checkout and installed snapshot
- Files: `hooks/register.tsx:124-139, 945-970`, `types/index.d.ts:AtlasView`

`maxScroll`, `maxPopupScroll`, `maxExpandedScroll`, and `maxLegendScroll` are mutable variables in `register.tsx`. Each pane render overwrites those values, while scroll actions operate on the shared `$.state` view.

If terminal and desktop panes are active in the same session, the last-rendered pane can determine the bounds used by the other pane. Different widths and popup heights make this unsafe.

Proposed fix:

- Store scroll bounds per surface and pane identity.
- Keep scroll position in the shared view only when the position is intentionally shared.
- Otherwise use surface-scoped view state.
- Clamp scroll positions whenever the active layout changes.

Verification:

- Mount terminal and desktop panes concurrently at different widths.
- Render each, then scroll each independently.
- Assert that one pane never changes the other pane’s bounds or position.

### B-03 — UI element types are explicitly restricted to terminal elements

- Category: SDK integration / architecture
- Severity: bug
- Evidence: confirmed
- Surface/version: both; present in checkout and installed snapshot
- Files: `hooks/ui/index.tsx:8-9`, `hooks/view.tsx:91`, SDK declarations `Elements` and `ClientElements`

`UiElements` is defined as:

```ts
Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
```

The same restriction is repeated in the view renderer. The SDK provides desktop-specific elements, including `Svg`, but the current abstraction cannot express them.

Native desktop buttons are used conditionally in some paths, so this is not necessarily an invalid runtime tree. It is an architectural limitation that prevents the desktop renderer from using the complete desktop element set.

Proposed fix:

- Define separate terminal and desktop element contracts.
- Make renderer context surface-specific.
- Keep only genuinely shared element capabilities in the common interface.
- Add an explicit desktop `Svg` path for glyphs and visual controls.

### B-04 — Style, glyph, and action presentation logic is duplicated

- Category: architecture / maintainability
- Severity: bug
- Evidence: confirmed
- Surface/version: both; present in checkout and installed snapshot
- Files: `hooks/view.tsx:42-89, 198-215`, `hooks/ui/index.tsx:64-120, 502-537`, `hooks/screens/trail.ts:70-110`, `hooks/screens/types.ts`

Color and glyph policy is split across:

- `view.tsx` color constants and `GLYPH`
- `ui/index.tsx` `GLYPH_SETS`
- Trail-specific source marks and colors
- Screen-row fields such as `sourceMarkColor`
- Hardcoded action colors inside `ActionGroup`

Action and layout decisions are also distributed between screen builders, shared screen helpers, `renderRow`, and UI primitives.

Proposed semantic style roles:

- `goal`
- `topic`
- `settled`
- `suggestion`
- `detour`
- `question`
- `checkpoint`
- `fileRead`
- `fileEdited`
- `done`
- `primaryAction`
- `secondaryAction`
- `sourceUser`
- `sourceClaude`
- `sourceEngine`

Screen models should carry semantic roles and action intent, not raw colors or renderer-specific glyphs. Each renderer should map those roles to its own glyphs, colors, borders, and controls.

### B-05 — Golden tests do not verify GUI geometry

- Category: testing / verification
- Severity: bug
- Evidence: confirmed
- Surface/version: both; present in checkout and installed snapshot
- Files: `tests/golden.test.tsx:26-79, 91-103, 166-198`

The golden flattener:

- Extracts text and limited style annotations.
- Ignores Box geometry, borders, background, position, width, height, overflow, and clipping.
- Returns no content for `Client`.
- Flattens children based on flex direction without validating actual GUI layout.

The tests mount terminal and desktop trees, but passing snapshots do not establish that desktop boxes, popups, native controls, or animated clients are positioned and sized correctly. The supplied screenshots demonstrate why this matters.

Proposed fix:

- Retain text goldens for semantic content.
- Add surface-aware structural assertions for:
  - Box dimensions
  - position and clipping
  - border/background
  - popup bounds
  - native Button variants
  - Client dimensions
- Add a manual desktop verification step for installed builds.

Expected golden scope should be explicit per job. A renderer migration would likely affect the desktop map, evidence, legend, trail, and popup goldens; unrelated goldens must remain unchanged.

### B-06 — Full recovery discards previously adopted-session identifiers

- Category: recovery correctness
- Severity: bug
- Evidence: confirmed code path; user-visible impact unverified
- Surface/version: installed snapshot only, `a70e975`
- File: `hooks/model.ts:~776-817`

`recoverFull` constructs the replacement snapshot with:

```ts
adopted: [...new Set([...loaded.adopted, source.id])]
```

It preserves the current recall object but does not merge the current snapshot’s existing `adopted` identifiers. A full recovery can therefore make previously adopted sessions appear available for adoption again.

Proposed fix:

```ts
adopted: [
  ...new Set([
    ...current.adopted,
    ...loaded.adopted,
    source.id,
  ]),
]
```

Add a regression test where the current map has already adopted one session and full recovery loads another.

### B-07 — Full-recovery confirmation guard is broader than its name suggests

- Category: semantics / misleading behavior
- Severity: misleading
- Evidence: confirmed
- Surface/version: installed snapshot only, `a70e975`
- File: `hooks/model.ts:~776-778`, `hooks/register.tsx` full-recovery action and command handling

`hasConfirmedMap` returns true when the map has a goal, topics, or decisions. Topics and decisions may be merely observed and not confirmed intent. Consequently, full recovery requires confirmation for maps containing observed information even when no confirmed goal exists.

This is conservative and does not violate the observation rule, but the helper name and behavior do not match.

Proposed fix:

- Rename it to reflect the actual guard, such as `hasMapContent`.
- Or narrow it to confirmed intent fields only.
- Add tests for empty, observed-only, and confirmed-goal maps.

### B-08 — Observation/intent separation remains sound in the snapshot

- Category: invariant review
- Severity: none found
- Evidence: confirmed
- Surface/version: checkout and installed snapshot

The snapshot’s full-recovery behavior is reached through explicit user actions:

- `adopt-full`
- `/atlas recover ... full [confirm]`

The observer path still calls `observe` and does not call `setGoal`, `setNextStep`, `startDetour`, `returnFromDetour`, `promoteDetour`, `mark`, or `confirmSuggestion`.

The added recovery feature therefore does not introduce an observation-never-writes-intent violation.

## Installed snapshot review

The installed snapshot differs from the checkout in seven files:

- `hooks/model.ts`
- `hooks/recall.ts`
- `hooks/register.tsx`
- `hooks/screens/evidence.ts`
- `hooks/screens/types.ts`
- `tests/atlas.test.tsx`
- `types/index.d.ts`

It adds full-session recovery, activity retention in saved files, pruning that avoids deleting the current session, and evidence-screen actions for normal or full resume.

It does not change:

- `hooks/view.tsx`
- `hooks/ui/index.tsx`
- `hooks/live.tsx`

The recovery design is generally consistent with the explicit-adoption rule, but the adopted-ID merge issue and broad confirmation guard should be fixed before treating it as complete. This audit did not run the snapshot’s tests or install it.

## Target architecture

```text
Engine
  snapshot, reducers, observation, recovery, persistence

Screens
  map, trail, open, evidence
  semantic rows, sections, actions

UI model
  surface-neutral nodes, roles, glyph keys, action intent

Renderers
  terminal renderer
  desktop renderer
  live Client renderer
```

Suggested file layout:

```text
hooks/engine/
  model.ts
  activity.ts
  scan.ts
  recall.ts

hooks/screens/
  types.ts
  shared.ts
  map.ts
  trail.ts
  open.ts
  evidence.ts

hooks/ui/
  nodes.ts
  roles.ts
  actions.ts

hooks/renderers/
  terminal.tsx
  desktop.tsx

hooks/live.tsx
hooks/register.tsx
```

Suggested interfaces:

```ts
type StyleRole =
  | 'goal'
  | 'topic'
  | 'settled'
  | 'suggestion'
  | 'checkpoint'
  | 'fileEdited'
  | 'primaryAction'
  | 'secondaryAction'

type ScreenAction =
  | { type: 'press'; id: string; role: 'primary' | 'secondary' | 'dismiss' }
  | { type: 'scroll'; id: string }

type ScreenRow = {
  id: string
  text: string
  role: StyleRole
  glyph: GlyphKey
  meta?: string
  children?: ScreenRow[]
  actions?: ScreenAction[]
}
```

The screen model should not contain raw colors, cell widths, truncation results, or terminal-only glyphs.

### Example: EARLIER SESSIONS

1. The engine supplies recall records.
2. `evidence.ts` builds semantic rows with `role: 'recall'` and actions such as `resume` or `resume-full`.
3. The common UI model represents the section, count, rows, and actions.
4. The TUI renderer applies cell truncation and bracketed controls.
5. The desktop renderer uses native buttons, flexible rows, and optional SVG glyphs.
6. Both renderers invoke the same action identifiers.

## Incremental implementation jobs

| Order | Job | Dependency | Expected golden scope |
|---|---|---|---|
| B-J1 | Make scroll bounds surface- and pane-scoped | None | No intentional drawn-output change |
| B-J2 | Centralize semantic roles and glyph keys | None | Existing goldens must remain identical |
| B-J3 | Extract surface-neutral UI nodes | B-J2 | Existing goldens must remain identical |
| B-J4 | Migrate shared bars, sections, and actions to the neutral model | B-J3 | Only affected terminal/desktop bar and section goldens |
| B-J5 | Split Evidence into terminal and desktop renderers | B-J4 | Evidence and relevant popup goldens only |
| B-J6 | Migrate Map, Trail, Open, Legend, and popups | B-J5 | Explicit per-screen golden list |
| B-J7 | Add geometry-aware GUI structural tests | B-J5 | No golden changes unless renderer output changes |
| B-J8 | Fix full-recovery adopted-ID merge and guard naming | None | No visual golden scope |

## Coverage matrix

| Area | Reviewed | Evidence | Remaining gap |
|---|---:|---|---|
| Engine and reducer boundaries | Yes | Static source and invariants | No fresh runtime execution |
| Screen builders | Yes | `hooks/screens/*` | No independent renderer contract |
| UI primitives | Yes | `hooks/ui/index.tsx` | Terminal assumptions remain |
| Desktop SDK elements | Yes | Generated SDK declarations | No live desktop paint verification |
| Client loading and props | Yes | `register.tsx`, `live.tsx`, SDK declarations | No installed-host test |
| Shared state and scrolling | Yes | `register.tsx`, `types/index.d.ts` | No concurrent-surface test |
| Purity and side effects | Yes | `register.tsx` versus pure modules | No fresh test run |
| Golden infrastructure | Yes | `tests/golden.test.tsx` | GUI geometry is omitted |
| Installed snapshot | Yes | Git diff and source review | Snapshot tests/install not run |
| Supplied screenshots | Yes | Four GUI screenshots | Screenshots use a different live data state |

## Verification gaps

- `claude plugin test` was not run.
- `claude plugin validate` was not run.
- TypeScript validation was not run.
- The installed snapshot was not executed.
- No live desktop or terminal host session was inspected.
- No concurrent terminal/desktop surface was tested.
- Golden tests do not validate GUI geometry or Client rendering.
- No regression test covers adopted-session preservation during full recovery.
- No test confirms native desktop buttons, SVGs, popup clipping, or responsive sizing.
- The screenshots cannot establish terminal/desktop parity because they represent a different live state.

## Ordered conclusion

1. Fix per-surface scroll bounds.
2. Correct full-recovery adopted-session merging and clarify the confirmation guard.
3. Centralize semantic roles and glyph keys.
4. Extract a surface-neutral UI model.
5. Split terminal and desktop renderers incrementally.
6. Add geometry-aware GUI verification before relying on golden test success.

Architectural improvements are B-J2 through B-J7. Confirmed code issues are B-02, B-03, B-04, B-05, and B-06. B-07 is a confirmed naming/semantic mismatch. No observation-never-writes-intent violation was found.

