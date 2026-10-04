# Atlas architecture: independent surface renderers

```
 ENGINE            model.ts · activity.ts · delegation.ts · recall.ts · scan.ts   (pure, no `$`)
 truth + intent    register.tsx = the only file with hooks and side effects
                              │  snapshot + view state
                              ▼
 SCREEN DATA       hooks/screens/*  →  ScreenModel + typed Actions
 what to show      (surface-blind; observed facts and confirmed intent stay distinct)
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
 RENDERERS      hooks/render-tui.tsx       hooks/render-gui.tsx
 how to draw     complete terminal UI       complete desktop UI
                glyphs, palette, rows,      glyphs, palette, rows,
                sections, popups, chrome,   sections, popups, chrome,
                geometry and scrolling     geometry and scrolling
                └─────────────┬────────────┘
                              ▼
 DISPATCH       hooks/view.tsx chooses a renderer; hooks/ui/shared.tsx has only neutral
                              measuring and layout math
                              ▼
 HOST           terminal pane · desktop pane
```

- Screen models and actions do not depend on a surface.
- Each renderer owns all drawn behavior for its surface. The renderers do not import from one another.
- `view.tsx` is the only surface dispatcher. `scripts/check-seam.ps1` checks the module boundary.
- Golden snapshots cover both renderers. Changes to one surface keep the other surface's goldens byte-identical.
