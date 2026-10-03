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

export type UiRow = {
  key: string
  text: string
  glyph?: string
  glyphColor?: string
  right?: string
  dim?: boolean
  bold?: boolean
  onPress?: () => void
}

export type UiSection = {
  key: string
  heading: string
  explain?: string
  count?: string
  right?: string | RenderElement
  color?: string
  dim?: boolean
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
  itemWidths: number[]
  grid: BarGrid
}

export type BarGridRow = {
  items: number[]
  width: number
}

export type BarGrid = {
  columns: number
  rows: BarGridRow[]
  columnWidths: number[]
  rowWidths: number[]
  fits: boolean
}

export type BarMeasure = {
  label: string
  hotkey?: string
  icon?: string
  activeMarker?: string
  prefixGap?: number
  buttonChrome?: 'none' | 'bracketed'
}

// The renderer draws a hotkey as an accent key, colon and space. Keep that
// chrome here so layout and tests measure the same thing the person sees.
export function measuredBarItemWidth(measure: BarMeasure): number {
  const prefix = measure.icon ? cellWidth(measure.icon) + (measure.prefixGap ?? 0) : 0
  const marker = measure.activeMarker ? cellWidth(measure.activeMarker) : 0
  const hotkey = measure.hotkey ? cellWidth(measure.hotkey) + 2 : 0
  const brackets = measure.buttonChrome === 'bracketed' ? 4 : 0
  return prefix + marker + hotkey + brackets + cellWidth(measure.label)
}

export type BarKind = 'tabs' | 'bar'

export function measuredBarItem(item: BarItem, label: string, surface: Surface, kind: BarKind, hotkeys = true): number {
  const activeTab = kind === 'tabs' && item.active
  return measuredBarItemWidth({
    label,
    hotkey: !isGui(surface) && hotkeys && !activeTab ? item.hotkey : undefined,
    icon: kind === 'bar' ? item.icon : undefined,
    activeMarker: activeTab ? '▸' : undefined,
    prefixGap: kind === 'bar' && item.icon ? (isGui(surface) ? 0 : 1) : 0,
  })
}

function gridForWidths(widths: readonly number[], availableWidth: number, gap: number): BarGrid {
  const count = widths.length
  if (count === 0) return { columns: 0, rows: [], columnWidths: [], rowWidths: [], fits: true }
  const available = Math.max(1, Math.floor(availableWidth))
  for (let columns = count; columns >= 1; columns--) {
    const columnWidths = Array.from({ length: columns }, () => 0)
    const rows: BarGridRow[] = []
    for (let start = 0; start < count; start += columns) {
      const items = Array.from({ length: Math.min(columns, count - start) }, (_, offset) => start + offset)
      for (const index of items) columnWidths[index % columns] = Math.max(columnWidths[index % columns] ?? 0, widths[index] ?? 0)
      rows.push({ items, width: 0 })
    }
    const rowWidths = rows.map(row => {
      const width = row.items.reduce((sum, index) => sum + (columnWidths[index % columns] ?? 0), 0) + gap * Math.max(0, row.items.length - 1)
      row.width = width
      return width
    })
    if (rowWidths.every(width => width <= available)) return { columns, rows, columnWidths, rowWidths, fits: true }
  }
  const columnWidths = [Math.max(...widths)]
  const rows = widths.map((width, index) => ({ items: [index], width }))
  return { columns: 1, rows, columnWidths, rowWidths: rows.map(row => row.width), fits: false }
}

// Choose the largest readable grid first. A shorter tier is allowed to keep
// more columns, but only after the full tier fails for that column count.
export function barGrid(widths: readonly number[], availableWidth: number, gap = 1): BarGrid {
  return gridForWidths(widths, availableWidth, gap)
}

function tierLabels(items: BarItem[], tier: BarLabels['tier']): string[] {
  return items.map(item => tier === 'full' ? item.label : tier === 'short' ? (item.short ?? item.label) : (item.compact ?? item.icon ?? item.short ?? item.label.slice(0, 1)))
}

export function barWidth(labels: string[], gap = 1): number {
  return labels.reduce((sum, label, i) => sum + cellWidth(label) + (i ? gap : 0), 0)
}

function itemWidths(items: BarItem[], labels: string[], surface: Surface, kind: BarKind, hotkeys: boolean): number[] {
  return items.map((item, i) => measuredBarItem(item, labels[i] ?? '', surface, kind, hotkeys))
}

function truncateLabelsToGrid(items: BarItem[], labels: string[], width: number, surface: Surface, kind: BarKind): string[] {
  const available = Math.max(1, Math.floor(width))
  return labels.map((label, i) => {
    const item = items[i]
    if (!item) return label
    const fixed = measuredBarItem(item, '', surface, kind, false)
    return truncateCells(label, Math.max(1, available - fixed))
  })
}

// All items remain in the returned list. At the last tier labels collapse to a
// short readable form rather than dropping a tab or the Mark action.
export function collapseBarLabels(items: BarItem[], width: number, surface: Surface, gap = 1, kind: BarKind = 'bar'): BarLabels {
  // The grid gives up columns before it gives up readable words. Compact
  // glyph/count labels are only an emergency fallback when even one full or
  // short item cannot fit in the available pane.
  const tiers: BarLabels['tier'][] = isGui(surface) ? ['short'] : ['full', 'short']
  const columns = Math.max(1, items.length)
  for (let desiredColumns = columns; desiredColumns >= 1; desiredColumns--) {
    for (const tier of tiers) {
      const labels = tierLabels(items, tier)
      const widths = itemWidths(items, labels, surface, kind, true)
      const grid = barGrid(widths, width, gap)
      if (grid.fits && grid.columns === desiredColumns) return { tier, labels, itemWidths: widths, grid }
    }
  }
  const compact = truncateLabelsToGrid(items, tierLabels(items, 'compact'), width, surface, kind)
  const widths = itemWidths(items, compact, surface, kind, false)
  return { tier: 'compact', labels: compact, itemWidths: widths, grid: barGrid(widths, width, gap) }
}

export function Tabs(ctx: UiContext, items: BarItem[], gap = 1): RenderElement {
  const { Box, Button, Text } = ctx.el
  const choice = collapseBarLabels(items, ctx.width, ctx.surface, gap, 'tabs')
  return (
    <Box key="tab-bar" flexDirection="column" gap={0} overflow="hidden" flexShrink={0}>
      {choice.grid.rows.map((row, rowIndex) => (
        <Box key={`tab-row-${rowIndex}`} flexDirection="row" gap={gap} flexShrink={0} overflow="hidden">
          {row.items.map(index => {
            const item = items[index]
            const label = choice.labels[index] ?? ''
            return (
              <Box key={`tab-cell-${item?.key ?? index}`} width={choice.grid.columnWidths[index % choice.grid.columns]} flexShrink={0} overflow="hidden">
                {item?.active
                  ? <Text key={item.key} bold color={item.activeColor} wrap="truncate-end">{`▸${label}`}</Text>
                  : <Button key={item?.key ?? String(index)} plain hotkey={choice.tier === 'compact' ? undefined : item?.hotkey} label={label} onPress={() => item?.onPress()} />}
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

export function Bar(ctx: UiContext, items: BarItem[], gap = 1): RenderElement {
  const { Box, Button, Text } = ctx.el
  const choice = collapseBarLabels(items, ctx.width, ctx.surface, gap, 'bar')
  return (
    <Box key="bottom-bar" flexDirection="column" gap={0} overflow="hidden" flexShrink={0}>
      {choice.grid.rows.map((row, rowIndex) => (
        <Box key={`bar-row-${rowIndex}`} flexDirection="row" gap={gap} flexShrink={0} overflow="hidden">
          {row.items.map(index => {
            const item = items[index]
            const label = choice.labels[index] ?? ''
            return (
              <Box key={`bar-cell-${item?.key ?? index}`} width={choice.grid.columnWidths[index % choice.grid.columns]} flexShrink={0} overflow="hidden">
                <Box flexDirection="row" gap={isGui(ctx.surface) ? 0 : 1} flexShrink={0} overflow="hidden">
                  {item?.icon ? <Text dimColor={!item.active} wrap="truncate-end">{item.icon}</Text> : null}
                  <Button
                    key={item?.key === 'mark' ? 'mark' : `bar-${item?.key ?? index}`}
                    {...(isGui(ctx.surface) ? {} : { plain: true as const })}
                    variant={isGui(ctx.surface) ? 'secondary' : undefined}
                    hotkey={choice.tier === 'compact' ? undefined : item?.hotkey}
                    dimColor={!item?.active}
                    label={label}
                    onPress={() => item?.onPress()}
                  />
                </Box>
              </Box>
            )
          })}
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

export function Row(ctx: UiContext, row: UiRow): RenderElement {
  const { Box, Text, Button } = ctx.el
  return (
    <Box key={row.key} flexDirection="row" gap={1} flexShrink={0}>
      {row.glyph ? (
        <Text color={row.glyphColor} dimColor={row.dim}>
          {row.glyph}
        </Text>
      ) : null}
      <Box flexShrink={1} minWidth={0} overflow="hidden">
        {row.onPress ? (
          <Button key={row.key} plain dimColor={row.dim} label={row.text} onPress={() => row.onPress?.()} />
        ) : (
          <Text bold={row.bold} dimColor={row.dim} wrap="truncate-end">
            {row.text}
          </Text>
        )}
      </Box>
      <Box flexGrow={1} />
      {row.right ? (
        <Text dimColor wrap="truncate-end">
          {row.right}
        </Text>
      ) : null}
    </Box>
  )
}

export function Section(ctx: UiContext, section: UiSection, children: RenderElement): RenderElement {
  const { Box, Text } = ctx.el
  return (
    <Box key={section.key} flexDirection="column" marginTop={1}>
      <Box flexDirection="row" flexShrink={0}>
        <Text bold color={section.color} dimColor={section.dim} wrap="truncate-end">
          {section.heading}
        </Text>
        <Box flexGrow={1} />
        {section.count ? (
          <Text dimColor wrap="truncate-end">
            {section.count}
          </Text>
        ) : null}
        {section.right ? (
          <Box flexDirection="row">
            <Text> </Text>
            {typeof section.right === 'string' ? <Text dimColor wrap="truncate-end">{section.right}</Text> : section.right}
          </Box>
        ) : null}
      </Box>
      {section.explain ? (
        <Text dimColor italic wrap="wrap">
          {section.explain}
        </Text>
      ) : null}
      {children}
    </Box>
  )
}

export function ScrollBox(ctx: UiContext, children: RenderElement[], options: { height: number; backgroundColor?: string } ): RenderElement {
  const { Box } = ctx.el
  return <Box key="popup-body" flexDirection="column" height={options.height} overflow="hidden" backgroundColor={options.backgroundColor}>{children.map((child, i) => <Box key={`popup-row-${i}`} backgroundColor={options.backgroundColor} flexShrink={0}>{child}</Box>)}</Box>
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
