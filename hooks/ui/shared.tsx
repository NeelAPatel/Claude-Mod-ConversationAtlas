// Pure UI primitives shared by the terminal and desktop renderers.
//
// These functions only receive element constructors and plain render data. They
// do not know about Atlas state and never touch `$`.

import type { Elements, RenderElement } from 'claude-code'

export type Surface = string
export type UiElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type UiContext = {
  el: UiElements
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
  headingPress?: () => void
  expansion?: RenderElement
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

function takeStartCells(value: string, width: number): string {
  const limit = Math.max(0, Math.floor(width))
  let out = ''
  for (const ch of value) {
    if (cellWidth(`${out}${ch}`) > limit) break
    out += ch
  }
  return out
}

function takeEndCells(value: string, width: number): string {
  const limit = Math.max(0, Math.floor(width))
  let out = ''
  for (const ch of Array.from(value).reverse()) {
    if (cellWidth(`${ch}${out}`) > limit) break
    out = `${ch}${out}`
  }
  return out
}

// Keep a path's filename intact while preserving the beginning and a small
// amount of the tail. The filename is only truncated when it cannot fit by
// itself, which makes this useful for both absolute and project-relative paths.
export function truncateMiddleCells(value: string, width: number): string {
  const limit = Math.max(1, Math.floor(width))
  if (cellWidth(value) <= limit) return value
  const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  const filename = slash >= 0 ? value.slice(slash + 1) : value
  if (cellWidth(filename) + 1 >= limit) return truncateCells(filename, limit)

  const before = slash >= 0 ? value.slice(0, slash + 1) : ''
  const spare = limit - cellWidth(filename) - 1
  const tailBudget = Math.min(spare, Math.max(1, Math.floor(spare / 2)))
  const tail = takeEndCells(before, tailBudget)
  const suffix = `${tail}${filename}`
  const head = takeStartCells(value, Math.max(0, limit - cellWidth(suffix) - 1))
  const result = head ? `${head}…${suffix}` : `…${suffix}`
  return cellWidth(result) <= limit ? result : truncateCells(filename, limit)
}

export type RowMetaInput = { text: string; compact?: string }

export type RowLayoutInput = {
  width: number
  prefix: string
  text: string
  meta?: string
  metaParts?: readonly RowMetaInput[]
  right?: string
  middle?: boolean
}

export type RowMetaOutput = { text: string; sourceIndex: number }

export type RowLayout = {
  text: string
  meta?: string
  metaParts: RowMetaOutput[]
  right?: string
}

type MetaChoice = { meta?: string; parts: RowMetaOutput[]; width: number; separator: number }

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function shortMetaPart(value: string): string {
  const colon = value.indexOf(':')
  if (colon > 0) return value.slice(colon + 1).trim()
  return value.replace(/^turn\s+/i, 't').replace(/\bsuggestion\b/gi, 'suggestion')
}

function metaChoices(input: RowLayoutInput): MetaChoice[] {
  if (input.metaParts?.length) {
    const compact = input.width < 60
    const parts = input.metaParts.map((part, sourceIndex) => ({
      text: oneLine(compact ? part.compact ?? part.text : part.text),
      sourceIndex,
    }))
    const choices: MetaChoice[] = []
    for (let count = parts.length; count >= 0; count--) {
      const selected = parts.slice(0, count)
      choices.push({
        parts: selected,
        width: selected.reduce((sum, part, index) => sum + cellWidth(part.text) + (index ? 1 : 0), 0),
        separator: selected.length ? 1 : 0,
      })
    }
    return choices
  }

  const words = input.meta ? oneLine(input.meta).split(' · ').filter(Boolean) : []
  const choices: MetaChoice[] = []
  for (let count = words.length; count >= 0; count--) {
    const selected = words.slice(0, count)
    const value = selected.join(' · ')
    const short = selected.map(shortMetaPart).join(' · ')
    choices.push({ meta: value || undefined, parts: [], width: cellWidth(value), separator: value && input.right ? 3 : 0 })
    if (short && short !== value) {
      choices.push({ meta: short, parts: [], width: cellWidth(short), separator: short && input.right ? 3 : 0 })
    }
  }
  return choices.length ? choices : [{ parts: [], width: 0, separator: 0 }]
}

function choiceWidth(choice: MetaChoice, right: string): number {
  return choice.width + choice.separator + cellWidth(right)
}

// Layout the four row segments in priority order: prefix/glyph, text, low
// priority metadata, and the right-side time or status. The renderer uses the
// returned metadata indexes to keep each file count's color intact.
export function layoutRow(input: RowLayoutInput): RowLayout {
  const width = Math.max(1, Math.floor(input.width))
  const prefix = input.prefix.replace(/[\r\n\t]+/g, ' ')
  const text = oneLine(input.text)
  const rightRaw = input.right ? oneLine(input.right) : ''
  const prefixWidth = cellWidth(prefix)
  const choices = metaChoices(input)
  const fits = (choice: MetaChoice, candidateText: string, right: string): boolean =>
    prefixWidth + cellWidth(candidateText) + choiceWidth(choice, right) <= width
  const chosen = choices.find(choice => fits(choice, text, rightRaw)) ?? choices.at(-1) ?? { parts: [], width: 0, separator: 0 }
  const availableText = Math.max(1, width - prefixWidth - choiceWidth(chosen, rightRaw))
  const candidateText = input.middle ? truncateMiddleCells(text, availableText) : truncateCells(text, availableText)
  const displayText = cellWidth(candidateText) <= availableText
    ? candidateText
    : availableText === 1
      ? '…'
      : `${takeStartCells(candidateText, availableText - 1)}…`
  const right = prefixWidth + cellWidth(displayText) + choiceWidth(chosen, rightRaw) <= width
    ? rightRaw || undefined
    : rightRaw
      ? truncateCells(rightRaw, Math.max(1, width - prefixWidth - cellWidth(displayText) - chosen.width - chosen.separator))
      : undefined
  return {
    text: displayText,
    meta: chosen.meta,
    metaParts: chosen.parts,
    right,
  }
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
  const brackets = measure.buttonChrome === 'bracketed' ? 2 : 0
  return prefix + marker + hotkey + brackets + cellWidth(measure.label)
}

export type BarKind = 'tabs' | 'bar'

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
  return items.map(item => tier === 'full'
    ? item.label
    : tier === 'short'
      ? (item.short ?? item.label)
      : (item.compact ?? item.icon ?? item.short ?? item.label.slice(0, 1)))
}

export function barWidth(labels: string[], gap = 1): number {
  return labels.reduce((sum, label, i) => sum + cellWidth(label) + (i ? gap : 0), 0)
}


export function collapseBarLabelsWith(
  items: BarItem[],
  width: number,
  tiers: BarLabels['tier'][],
  measure: (item: BarItem, label: string, kind: BarKind, hotkeys: boolean) => number,
  gap = 1,
  kind: BarKind = 'bar',
): BarLabels {
  const widthsFor = (labels: string[], hotkeys: boolean) => items.map((item, i) => measure(item, labels[i] ?? '', kind, hotkeys))
  const columns = Math.max(1, items.length)
  for (let desiredColumns = columns; desiredColumns >= 1; desiredColumns--) {
    for (const tier of tiers) {
      const tieredLabels = tierLabels(items, tier)
      const widths = widthsFor(tieredLabels, true)
      const grid = barGrid(widths, width, gap)
      if (grid.fits && grid.columns === desiredColumns) return { tier, labels: tieredLabels, itemWidths: widths, grid }
    }
  }
  const compact = tierLabels(items, 'compact').map((label, i) => {
    const fixed = measure(items[i]!, '', kind, false)
    return truncateCells(label, Math.max(1, Math.max(1, Math.floor(width)) - fixed))
  })
  const widths = widthsFor(compact, false)
  return { tier: 'compact', labels: compact, itemWidths: widths, grid: barGrid(widths, width, gap) }
}

