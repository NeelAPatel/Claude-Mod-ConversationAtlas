# Atlas architecture: where the TUI and GUI sit

```
 ENGINE            model.ts · activity.ts · delegation.ts · recall.ts · scan.ts   (pure, no `$`)
 truth + intent    register.tsx = the only file with hooks and side effects
                              │  snapshot + view state
                              ▼
 "API" LAYER       hooks/screens/*.ts  →  ScreenModel (tabs, sections, rows, popups, tones, glyph keys)
 what to show      + typed `Action`s back to `act`        (pure data; guarded by tests/golden)
                              │  same data, both surfaces
                ┌─────────────┴─────────────┐
                ▼                           ▼
 SURFACE KITS   hooks/ui/tui.tsx            hooks/ui/gui.tsx          one `SurfaceKit` interface
 how to draw    glyphs, bar tiers, Tabs,    its own glyphs, tiers,    (hooks/ui/kit.ts, `kitFor`)
                Bar, ActionGroup, rules     Tabs, Bar, rules
                └──────────────┬────────────┘
                               ▼
 SHARED         hooks/view.tsx (pane, rows, sections, popups, expansions) calls `ctx.kit.*`
 LAYOUT         hooks/ui/shared.tsx (cell width, truncation, row layout, bar-grid math)
                               ▼
 HOST           terminal pane · desktop pane  (`Surface`: desktop → GUI kit; terminal/vscode/mobile → TUI kit)
```

- The engine never knows a surface exists. Screens never know a surface exists.
- Surface-specific drawing lives only in `hooks/ui/tui.tsx` and `hooks/ui/gui.tsx` (plus `kit.ts` and the `index.tsx` façade). `view.tsx` and `hooks/screens/*` must not mention `isGui`, `GLYPH_SETS` or a surface name.
- Changing the GUI means changing `gui.tsx` (and, if the shared layout must differ, splitting that piece into the kit). Terminal goldens must stay byte-identical while doing so.
- Added in b10 (2026-10-04). Before b10, `view.tsx` and `hooks/ui/index.tsx` branched on the surface inline.
