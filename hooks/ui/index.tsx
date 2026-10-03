// Pure UI primitives shared by the terminal and desktop renderers.
//
// These functions only receive element constructors and plain render data. They
// do not know about Atlas state and never touch `$`.

import type { Elements, RenderElement } from 'claude-code'

export type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'
export type UiElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type UiContext = {
  el: UiElements
  surface: Surface
  width: number
}

export type GlyphSet = {
  goal: string
  suggestion: string
  currentTopic: string
  detour: string
  returned: string
  observedDecision: string
  settledDecision: string
  checkpoint: string
  openQuestion: string
  resolved: string
  ok: string
  fail: string
  editedFile: string
  readFile: string
  fresh: string
  expanded: string
  prompt: string
  next: string
  resume: string
  handoff: string
  reportBack: string
}

// Keep one semantic table while allowing a proportional desktop surface to
// choose simpler marks where terminal-specific glyphs are noisy.
export const GLYPH_SETS: Record<'tui' | 'gui', GlyphSet> = {
  tui: {
    goal: '◎',
    suggestion: '○',
    currentTopic: '●',
    detour: '↳',
    returned: '↩',
    observedDecision: '◇',
    settledDecision: '◆',
    checkpoint: '⚑',
    openQuestion: '?',
    resolved: '✓',
    ok: '✓',
    fail: '✗',
    editedFile: '✎',
    readFile: '·',
    fresh: '✦',
    expanded: '▾',
    prompt: '›',
    next: '▸',
    resume: '◎',
    handoff: '→',
    reportBack: '←',
  },
  gui: {
    goal: '◎',
    suggestion: '○',
    currentTopic: '●',
    detour: '↳',
    returned: '↩',
    observedDecision: '◇',
    settledDecision: '◆',
    checkpoint: '⚑',
    openQuestion: '?',
    resolved: '✓',
    ok: '✓',
    fail: '×',
    editedFile: '✎',
    readFile: '·',
    fresh: '✦',
    expanded: '▾',
    prompt: '•',
    next: '▸',
    resume: '◎',
    handoff: '→',
    reportBack: '←',
  },
}

export function isGui(surface: Surface): boolean {
  return surface === 'desktop'
}

export function glyphsFor(surface: Surface): GlyphSet {
  return isGui(surface) ? GLYPH_SETS.gui : GLYPH_SETS.tui
}

// A small cell-width approximation. It handles combining marks and the wide
// Unicode ranges that matter for the glyphs used by Atlas without depending on
// a terminal package that is unavailable to the plugin runtime.
export function cellWidth(value: string): number {
  let width = 0
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 0 || (code >= 0x300 && code <= 0x36f) || (code >= 0xfe00 && code <= 0xfe0f)) continue
    const wide = code >= 0x1100 && (
      code <= 0x115f || code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    )
    width += wide ? 2 : 1
  }
  return width
}

export function truncateCells(value: string, width: number): string {
  const limit = Math.max(1, Math.floor(width))
  if (cellWidth(value) <= limit) return value
  if (limit === 1) return '…'
  let out = ''
  for (const ch of value) {
    if (cellWidth(`${out}${ch}…`) > limit) break
    out += ch
  }
  return `${out}…`
}

export type BarItem = {
  key: string
  label: string
  short?: string
  compact?: string
  icon?: string
  active?: boolean
  activeColor?: string
  hotkey?: string
  onPress: () => void
}

export type BarLabels = {
  tier: 'full' | 'short' | 'compact'
  labels: string[]
}

function tierLabels(items: BarItem[], tier: BarLabels['tier']): string[] {
  return items.map(item => tier === 'full' ? item.label : tier === 'short' ? (item.short ?? item.label) : (item.compact ?? item.icon ?? item.short ?? item.label.slice(0, 1)))
}

export function barWidth(labels: string[], gap = 1): number {
  return labels.reduce((sum, label, i) => sum + cellWidth(label) + (i ? gap : 0), 0)
}

// All items remain in the returned list. At the last tier labels collapse to a
// single icon/count form rather than dropping a tab or the Mark action.
export function collapseBarLabels(items: BarItem[], width: number, surface: Surface, gap = 1): BarLabels {
  const tiers: BarLabels['tier'][] = isGui(surface) ? ['short', 'compact'] : ['full', 'short', 'compact']
  for (const tier of tiers) {
    const labels = tierLabels(items, tier)
    if (barWidth(labels, gap) <= Math.max(1, width)) return { tier, labels }
  }
  const labels = tierLabels(items, 'compact').map(label => truncateCells(label, 1))
  return { tier: 'compact', labels }
}

export function Tabs(ctx: UiContext, items: BarItem[], gap = 1): RenderElement {
  const { Box, Button, Text } = ctx.el
  const choice = collapseBarLabels(items, ctx.width, ctx.surface, gap)
  return (
    <Box flexDirection="row" gap={gap} flexWrap="nowrap" overflow="hidden" flexShrink={0}>
      {items.map((item, i) => item.active
        ? <Text key={item.key} bold color={item.activeColor}>{`▸${choice.labels[i] ?? ''}`}</Text>
        : <Button key={item.key} plain hotkey={choice.tier === 'compact' ? undefined : item.hotkey} label={choice.labels[i] ?? ''} onPress={() => item.onPress()} />)}
    </Box>
  )
}

export function Bar(ctx: UiContext, items: BarItem[], gap = 1): RenderElement {
  const { Box, Button, Text } = ctx.el
  const choice = collapseBarLabels(items, ctx.width, ctx.surface, gap)
  return (
    <Box flexDirection="row" gap={gap} flexWrap="nowrap" overflow="hidden" flexShrink={0}>
      {items.map((item, i) => (
        <Box key={`bar-wrap-${item.key}`} flexDirection="row" gap={isGui(ctx.surface) ? 0 : 1} flexShrink={1} overflow="hidden">
          {item.icon ? <Text dimColor={!item.active}>{item.icon}</Text> : null}
          <Button
            key={item.key === 'mark' ? 'mark' : `bar-${item.key}`}
            {...(isGui(ctx.surface) ? {} : { plain: true as const })}
            variant={isGui(ctx.surface) ? 'secondary' : undefined}
            hotkey={choice.tier === 'compact' ? undefined : item.hotkey}
            dimColor={!item.active}
            label={choice.labels[i] ?? ''}
            onPress={() => item.onPress()}
          />
        </Box>
      ))}
    </Box>
  )
}

export type ActionItem = { key: string; label: string; primary?: boolean; role?: 'dismiss'; onPress: () => void }

export function ActionGroup(ctx: UiContext, items: ActionItem[], options: { marginLeft?: number; gap?: number; flexWrap?: 'wrap' | 'nowrap' } = {}): RenderElement {
  const { Box, Text, Button } = ctx.el
  const marginLeft = options.marginLeft ?? 2
  const gap = options.gap ?? 1
  const flexWrap = options.flexWrap ?? 'wrap'
  return (
    <Box flexDirection="row" gap={gap} marginLeft={marginLeft} flexWrap={flexWrap}>
      {items.map(item => item.primary || isGui(ctx.surface)
        ? <Button key={item.key} label={item.label} variant={item.primary ? 'primary' : 'secondary'} {...(item.role ? { role: item.role } : {})} onPress={() => item.onPress()} />
        : <Box key={`action-${item.key}`} flexDirection="row">
            <Text color="#7dcfff">[</Text>
            <Button key={item.key} plain label={` ${item.label} `} hover={{ color: '#7dcfff' }} {...(item.role ? { role: item.role } : {})} onPress={() => item.onPress()} />
            <Text color="#7dcfff">]</Text>
          </Box>)}
    </Box>
  )
}

export function ScrollBox(ctx: UiContext, children: RenderElement[], options: { height: number; backgroundColor?: string } ): RenderElement {
  const { Box } = ctx.el
  return <Box flexDirection="column" height={options.height} overflow="hidden" backgroundColor={options.backgroundColor}>{children}</Box>
}

export function Popup(ctx: UiContext, children: RenderElement[], options: { width: number; height: number; backgroundColor: string; borderColor?: string; top?: number; left?: number; bottom?: number }): RenderElement {
  const { Box } = ctx.el
  // The shell and each flow region carry the fill. This is intentional: an
  // absolute panel must paint every cell, including gaps beside short rows.
  return (
    <Box key="atlas-popup" position="absolute" top={options.top} left={options.left} bottom={options.bottom} width={options.width} height={options.height} overflow="hidden" borderStyle="round" borderColor={options.borderColor} backgroundColor={options.backgroundColor} paddingX={1} flexDirection="column">
      {children.map((child, i) => <Box key={`popup-fill-${i}`} backgroundColor={options.backgroundColor} flexShrink={0}>{child}</Box>)}
    </Box>
  )
}

export function rule(ctx: UiContext, color?: string): RenderElement {
  const { Box, Text } = ctx.el
  if (isGui(ctx.surface)) return <Box height={1} flexGrow={1} borderStyle="single" borderColor={color} />
  return <Text dimColor>{'─'.repeat(Math.max(1, ctx.width))}</Text>
}
