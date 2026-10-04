import type { RenderElement } from 'claude-code'
import type { AtlasSnapshot } from '../types'
import type { Surface } from './ui/shared'
import type { ScreenPopup } from './screens/types'
import * as Tui from './render-tui'
import * as Gui from './render-gui'

export type { Action } from './render-tui'
export { C, GLYPH, LEGEND, TONES, rowsOf, oneLine, ago } from './render-tui'
export const rendererFor = (surface: Surface | 'desktop'): 'gui' | 'tui' => surface === 'desktop' ? 'gui' : 'tui'
export type Ctx = Tui.Ctx & { surface: Surface | 'desktop' }
export function pane(ctx: Ctx, snapshot: AtlasSnapshot): ReturnType<typeof Tui.pane> {
  return rendererFor(ctx.surface) === 'gui' ? Gui.pane(ctx, snapshot) : Tui.pane(ctx, snapshot)
}
export function popupShell(ctx: Ctx, popup: ScreenPopup, placement: Parameters<typeof Tui.popupShell>[2]): RenderElement {
  return rendererFor(ctx.surface) === 'gui' ? Gui.popupShell(ctx, popup, placement) : Tui.popupShell(ctx, popup, placement)
}
export function legendPanel(ctx: Ctx, height?: number, at?: number): RenderElement {
  return rendererFor(ctx.surface) === 'gui' ? Gui.legendPanel(ctx, height, at) : Tui.legendPanel(ctx, height, at)
}
