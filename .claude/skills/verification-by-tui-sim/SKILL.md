---
name: verification-by-tui-sim
description: Use when checking a Conversation Atlas UI change with control-atlas, reaching a tab or state, and reporting what the Simulator does and does not prove.
---

# Verification by TUI Sim

Use this skill to inspect Atlas tabs, sections, popups, and setup states with the Simulator. Read the feature index, then use the exact route listed for the feature being changed.

## Run the Simulator

Run commands from the repository root. The --surface tui|gui flag is required. **TUI is the only faithful view.** GUI frames are a text approximation of the separate desktop renderer; they are not what the owner sees.

The default fixture is sample. Use --state nogoal for the no-goal suggestion and --state setup for consent. Every completed step prints a frame.

## Step grammar

| Step | Example | Effect |
| --- | --- | --- |
| size W x H | size 60x20 | Redraw at a body width and height. Write the size as 60x20. |
| tab map, trail, open, evidence | tab trail | Select a tab. |
| press KEY | press trail-view-menu | Press a Button by key. |
| click KEY | click evb-story-2 | Alias for press. |
| clickrow N | clickrow 3 | Press the first Button on visible, 1-based row N. |
| key CHAR | key t | Press the Button with that hotkey. |
| scroll N | scroll -2 | Move the Simulator window by a signed row count. |
| scroll top or end | scroll end | Move the Simulator window to its first or last position. |
| legend | legend | Press the Legend toggle. |
| snapshot | snapshot | Print the current frame without an action. |

The command also accepts --width, --height, --state sample|nogoal|setup, --styles, and --json. See the feature file for a complete route.

## Read a frame

The header names the surface, body size, scroll offset and total drawn lines, and the step just applied. Read the visible lines below it as the current frame. The buttons: footer lists Button keys and hotkeys found on visible rows; use those keys for the next press. In JSON output, each line carries its own buttons list.

The Simulator reports overflow when an unwrapped line is wider than the frame. That warning does not prove the real pane overflows.

## Coverage boundary

| Input or output | Simulator evidence | Limit |
| --- | --- | --- |
| TUI rendering | The real TUI renderer tree is mounted and drawn by the plugin test kit. | This is the only faithful view in the text sim. |
| GUI rendering | The separate GUI renderer tree is drawn. | Its text frame is only an approximation, not the owner's view. |
| Button press | press and click call the pane's ui.press action. | The action is real; pointer position is emulated. |
| Keyboard | key resolves a Button hotkey and presses its key. | Physical keyboard input is emulated. |
| Window scroll and size | scroll and size redraw with a window offset and body dimensions. | This redraw is emulated; it is not an engine wheel or live resize. |
| Engine wheel | Not sent by the test kit. | Unproven. |
| Real mouse and resize paint | There is no mouse or resize paint event in this kit. | Unproven. |
| Word wrapping | The frame dump does not wrap long text. | Unverified; needs the owner's eyes (or a real terminal run). |

Known gap: pressing the pane's scroll-up or scroll-down Button can change Atlas scroll state but does not move the Simulator window. Use scroll N with a signed row count to inspect another window. Whether the real engine moves its window for those Buttons is unproven.

## Proof labels

Every claim in a PR's Proof check table (Claim | Label | Evidence, see docs/process/NAMING.md) carries exactly one of these labels:

- **sim-verified**: the exact route ran in the Simulator on the TUI, the relevant frame was read, and it matches the stated expectation. Name the route and frame.
- **unit-test-verified**: a test or the Gate covers it, but the changed screen was not inspected in the Simulator.
- **type-check-only**: only `tsc` or validation covers it.
- **unproven (owner-eye)**: the Simulator cannot reach the state, or its limits exclude the behaviour (real mouse, engine wheel, live resize paint, word wrapping, text entry).

Never claim visual testing you did not run. A test pass is not a visual check. A GUI text frame is not an owner-eye check. Keep reachable and unproven parts separate when one feature has both.

## Check a UI change

1. Find the changed feature in references/features/README.md and choose its fixture and route.
2. Run the TUI Simulator with the exact route, for example: pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 30 --step "tab trail".
3. Inspect the frame header, changed rows, visible buttons footer, and any later frames after actions.
4. Compare the result to the feature's expected behavior and the relevant existing golden. Record any route or behavior the Simulator could not reach as unproven.
5. Run the Gate (step 4 of docs/process/ATLAS_FLOW.md): node scripts/check.mjs --brief with your job's brief file (see docs/process/brief-template.md) and report its result with the verdict. A PASS on an empty diff proves nothing; say what changed.

## Design rules

Before documenting or judging UI behaviour, read docs/design/README.md and the matching paradigm file (docs/design/TUI_UIUX_paradigm.md for the TUI, docs/design/GUI_UIUX_paradigm.md for the GUI). The Simulator does not check word wrapping, real wheel or mouse input, or real pixels.

## Feature map

The index in references/features/README.md links to one file per tab, the app bar, each requested popup, setup consent, goal, detour, and scrolling. The exact routes in those files were driven through control-atlas; files call out the cases that remain unreachable or unproven.
