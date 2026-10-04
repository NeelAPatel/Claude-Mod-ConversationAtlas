import type { RenderElement } from 'claude-code'
import type { BarItem, BarLabels, GlyphSet, Surface } from './shared'
import type { UiContext } from './shared'

export interface SurfaceKit {
  glyphs: GlyphSet
  collapseBarLabels(items: BarItem[], width: number, gap?: number, kind?: 'tabs' | 'bar'): BarLabels
  measuredBarItem(item: BarItem, label: string, kind: 'tabs' | 'bar', hotkeys?: boolean): number
  Tabs(ctx: UiContext, items: BarItem[], gap?: number): RenderElement
  Bar(ctx: UiContext, items: BarItem[], gap?: number): RenderElement
  ActionGroup(ctx: UiContext, items: ActionItem[], options?: ActionGroupOptions): RenderElement
  rule(ctx: UiContext, color?: string): RenderElement
  titleRule(ctx: UiContext, width: number, color: string): RenderElement
}

export type ActionItem = {
  key: string
  label: string
  primary?: boolean
  role?: 'dismiss'
  onPress: () => void
}

export type ActionGroupOptions = { marginLeft?: number; gap?: number; flexWrap?: 'wrap' | 'nowrap' }

export function kitFor(surface: Surface): SurfaceKit {
  return surface === 'desktop' ? guiKit : tuiKit
}

import { guiKit } from './gui'
import { tuiKit } from './tui'
