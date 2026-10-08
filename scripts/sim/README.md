# control-atlas sim

`control-atlas` mounts Atlas's real `Pane` in the Claude plugin-test kit, applies a step list, and prints the drawn tree after each step. It makes TUI and GUI layouts reviewable in automation without changing a golden. `--surface` is required.

**TUI** means Atlas's terminal renderer (`surface: terminal`). **GUI** means the separate desktop renderer (`surface: desktop`); its text dump is an approximation and is not what the owner sees.

The runner copies the hooks, types, plugin metadata, fixtures, and sim helpers into a fresh `.claude/atlas/tmp/sim-<random>/`, generates one test from `sim.template.txt`, runs `claude plugin test .` there, reads `SIM_FRAME` records, and removes the temp folder unless `--keep-temp` is set.

## What the sim covers

| Input or output | What happens | Status |
| --- | --- | --- |
| Pane rendering | The real TUI or GUI renderer draws the fixture state through the plugin-test kit. | Real renderer tree |
| Button click | `press <key>` and `click <key>` call Pane `ui.press({ key })`. `clickrow` maps a visible text row to its first Button key. | Button action is real; pointer position is emulated |
| Keyboard | `key <char>` finds the Button whose `hotkey` matches and presses its key. | Button action is real; physical key input is emulated |
| Wheel and height | `scroll` and `size` call `redraw` with `scroll.offset`, `scroll.bodyRows`, and `bodyColumns`; the runner windows the full drawn lines. | Emulated with redraw; engine wheel is unproven |
| Mouse and resize paint | Pane has no mouse or resize event API in this test kit. | Real mouse and real resize paint are unproven |

**Wrapping is unverified:** the frame dump (like `ui.drawn()` and the goldens) does not wrap long text, so word wrapping inside expansions is not checked by layer 1 (for example, Trail-expanded rows are 140-212 characters at width 46 in the existing goldens). `OVERFLOW` lines are therefore a warning, not proof of a real overflow. Real wrapping needs layer 2 or 3.

**Known gap (found by Co-Master-sim):** pressing the TUI's own `scroll-up` / `scroll-down` Buttons moves Atlas's scrollbar thumb (it changes `view.scroll`) but does NOT move the runner's window, so the visible rows stay the same. Use `scroll <n>` to move the window. Whether the real engine ties those Buttons to its window offset is unproven (needs layer 2/3).

Lines are measured with JavaScript `.length` (UTF-16 code units), because the cell-width helper is not imported by the harness. A line longer than `--width` stays unwrapped and gets an `OVERFLOW row n: <length> > <width>` report. `--styles` adds annotations like `{0:color:#7dcfff,bold}`.

## Examples

```powershell
pwsh scripts/control-atlas.ps1 --surface tui
```

```powershell
pwsh scripts/control-atlas.ps1 --surface tui --width 46 --height 20 --step "tab trail" --step "scroll 5" --step "key t"
```

```powershell
pwsh scripts/control-atlas.ps1 --surface gui --state nogoal --step "tab open" --styles
```

```powershell
pwsh scripts/control-atlas.ps1 --surface tui --step "legend" --step "clickrow 4" --json
```

```powershell
pwsh scripts/control-atlas.ps1 --surface gui --step "tab trail" --step "snapshot" --dry-run
```

A `.json` step file is an array of strings or an object with a `steps` array. A `.txt` file has one step per line; blank lines and lines starting with `#` are ignored. `--dry-run` validates the list and prints its plan without invoking Claude.

## Step grammar

| Step | Example | Effect |
| --- | --- | --- |
| `size <W>x<H>` | `size 60x20` | Redraw at a new body width and height. |
| `tab map\|trail\|open\|evidence` | `tab trail` | Press `tab-<name>` (already-selected tab is a no-op). |
| `press <key>` | `press tab-trail` | Press a Button by its `key`. |
| `click <key>` | `click evb-123` | Alias for `press`. |
| `clickrow <n>` | `clickrow 3` | Press the first Button on visible, 1-based row `n`; errors list row keys. |
| `key <char>` | `key t` | Press the first Button with that hotkey; an already-selected TUI tab hotkey is a no-op because that tab is drawn as Text. |
| `scroll <n>` | `scroll -2` | Move the redraw window by signed rows. |
| `scroll top\|end` | `scroll end` | Move to the first or last redraw window. |
| `legend` | `legend` | Press `bar-legend`. |
| `snapshot` | `snapshot` | Emit a frame without an action. |

Every completed step emits one frame. The footer lists the keys and hotkeys on visible rows. Frame headers name the surface, body size, scroll offset/total lines, and step. Exit codes are `0` success, `1` step or plugin-test failure, and `2` usage error. `--help` prints the full CLI reference.
