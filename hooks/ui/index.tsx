import type { RenderElement } from 'claude-code'
import { guiKit } from './gui'
import { kitFor, type SurfaceKit } from './kit'
import type { BarItem, BarKind, GlyphSet, Surface, UiContext } from './shared'
import { tuiKit, tuiGlyphs } from './tui'

export * from './shared'
export { kitFor }
export type { ActionGroupOptions, ActionItem, SurfaceKit } from './kit'

export const GLYPH_SETS: Record<'tui' | 'gui', GlyphSet> = { tui: tuiGlyphs, gui: guiKit.glyphs }

export function isGui(surface: Surface): boolean {
  return surface === 'desktop'
}

export function glyphsFor(surface: Surface) {
  return kitFor(surface).glyphs
}

export type SurfaceUiContext = UiContext & { surface: Surface }

export function measuredBarItem(item: BarItem, label: string, surface: Surface, kind: BarKind, hotkeys = true): number {
  return kitFor(surface).measuredBarItem(item, label, kind, hotkeys)
}

export function collapseBarLabels(
  items: BarItem[],
  width: number,
  surface: Surface,
  gap = 1,
  kind: BarKind = 'bar',
) {
  return kitFor(surface).collapseBarLabels(items, width, gap, kind)
}

export function Tabs(ctx: SurfaceUiContext, items: BarItem[], gap = 1): RenderElement {
  return kitFor(ctx.surface).Tabs(ctx, items, gap)
}

export function Bar(ctx: SurfaceUiContext, items: BarItem[], gap = 1): RenderElement {
  return kitFor(ctx.surface).Bar(ctx, items, gap)
}

export function ActionGroup(
  ctx: SurfaceUiContext,
  items: import('./kit').ActionItem[],
  options?: import('./kit').ActionGroupOptions,
): RenderElement {
  return kitFor(ctx.surface).ActionGroup(ctx, items, options)
}

export function rule(ctx: SurfaceUiContext, color?: string): RenderElement {
  return kitFor(ctx.surface).rule(ctx, color)
}
