// The pane shell and surface renderers. Tab content is pure data from
// hooks/screens; this module decides only how that data is laid out.

import type { Elements, RenderElement } from 'claude-code'
import type { AtlasMode, AtlasScanState, AtlasSnapshot, AtlasTab, AtlasView } from '../types'
import type { LiveRow } from './live'
import { openQuestions } from './model'
import {
  cellWidth,
  layoutRow as uiLayoutRow,
  type BarItem,
  type GlyphSet,
  type UiContext,
  type UiSection,
} from './ui/shared'
import { buildEvidence } from './screens/evidence'
import { buildMap } from './screens/map'
import { buildOpen } from './screens/open'
import { buildTrail, SOURCE_MARK, trailViewPopup } from './screens/trail'
import { ago } from './screens/shared'
import type {
  Action,
  GlyphKey,
  ScreenAction,
  ScreenBuilder,
  ScreenModel,
  ScreenPopup,
  ScreenRow,
  ScreenSection,
  ScreenView,
} from './screens/types'

export type { Action } from './screens/types'

export const C = {
  goal: '#7dcfff',
  action: '#7dcfff',
  path: '#bb9af7',
  trail: '#b9f27c',
  map: 'yellowBright',
  detour: '#e0af68',
  decision: '#9ece6a',
  question: '#f7768e',
  checkpoint: '#7aa2f7',
  fail: '#f7768e',
  ok: '#9ece6a',
  read: '#bb9af7',
  write: '#ff9e64',
} as const

type Glyph = { char: string; color?: string }
export const GLYPH: Record<GlyphKey, Glyph> = {
  goal: { char: '◎', color: C.goal },
  suggestion: { char: '○' },
  currentTopic: { char: '●', color: C.path },
  detour: { char: '↳', color: C.detour },
  returned: { char: '↩', color: C.detour },
  observedDecision: { char: '◇', color: C.decision },
  settledDecision: { char: '◆', color: C.decision },
  checkpoint: { char: '⚑', color: C.checkpoint },
  openQuestion: { char: '?', color: C.question },
  resolved: { char: '✓', color: C.ok },
  ok: { char: '✓', color: C.ok },
  fail: { char: '✗', color: C.fail },
  editedFile: { char: '✎', color: C.write },
  readFile: { char: '·', color: C.read },
  fresh: { char: '✦' },
  expanded: { char: '▾', color: C.goal },
  prompt: { char: '›' },
  next: { char: '▸', color: C.goal },
  resume: { char: '◎', color: C.goal },
  handoff: { char: '→', color: C.checkpoint },
  reportBack: { char: '←', color: C.ok },
}
const TAB_ACCENT: Record<AtlasTab, string> = { map: C.detour, trail: C.decision, open: C.question, evidence: C.checkpoint }
export const TONES: Record<string, string[]> = {
  violet: ['#6d5a9c', '#8f78c9', '#b9a3f0', '#efe6ff'],
  orange: ['#9c5a2c', '#c9783e', '#f0a46e', '#fff0e0'],
  amber: ['#8c6a2c', '#b8903e', '#e0b86e', '#fff4d6'],
  green: ['#4f7a3a', '#6fa052', '#9ece6a', '#e8ffd6'],
  blue: ['#3d5a9c', '#5a7ac9', '#8aa8f0', '#e0eaff'],
}

type GuiElements = Elements[Exclude<keyof Elements, 'terminal' | 'mobile' | 'vscode'>]
type El = Pick<GuiElements, 'Box' | 'Text' | 'Button'> & {
  Input?: GuiElements['Input']
  Markdown?: GuiElements['Markdown']
  Svg?: GuiElements['Svg']
}
export type Ctx = {
  el: El
  width: number
  rows: number
  bodyViewport?: number
  now: number
  mode: AtlasMode
  setupDefault: AtlasMode
  scan: AtlasScanState
  view: AtlasView & { hidden?: string[]; settingsPage?: number }
  live: (
    key: string,
    rows: LiveRow[],
    scan?: { active: boolean; startedAt: number; result: string | null; resultAt: number; now: number },
  ) => RenderElement
  act: (action: Action) => void
}
type PaneCtx = Ctx

const OBSERVER_NOTE = 'Needs the Claude observer · /atlas observer claude'
const SCAN_RESULT_MS = 4_000

function childrenOf(node: { children?: unknown; props?: Record<string, unknown> } | null | undefined): unknown {
  return node?.children ?? node?.props?.children
}
function kids(value: unknown): unknown[] {
  if (value === null || value === undefined || value === false || value === true) return []
  if (Array.isArray(value)) return value.flatMap(kids)
  return [value]
}
function textOf(value: unknown): string {
  return kids(value)
    .map(item =>
      typeof item === 'string' || typeof item === 'number'
        ? String(item)
        : textOf(childrenOf(item as { children?: unknown; props?: Record<string, unknown> })),
    )
    .join('')
}

export function rowsOf(value: unknown, width: number): number {
  const list = kids(value)
  if (list.length !== 1) return list.reduce((sum: number, item) => sum + rowsOf(item, width), 0)
  const node = list[0]
  if (typeof node === 'string' || typeof node === 'number') return 1
  const element = node as { type?: string; props?: Record<string, unknown>; children?: unknown }
  const props = element.props ?? {}
  if (props.position === 'absolute') return 0
  const extra =
    (Number(props.marginTop) || 0) +
    (Number(props.marginBottom) || 0) +
    2 * (Number(props.marginY) || 0) +
    2 * (Number(props.paddingY) || 0)
  switch (element.type) {
    case 'Text': {
      const lines = textOf(childrenOf(element)).split('\n')
      return (
        (props.wrap === 'wrap'
          ? lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(8, width))), 0)
          : Math.max(1, lines.length)) + extra
      )
    }
    case 'Button':
    case 'Input':
    case 'Select':
      return 1 + extra
    case 'Client': {
      const client = props.props as { rows?: unknown[]; scan?: { active?: boolean; result?: string | null } } | undefined
      return Math.max(client?.scan?.active ? 2 : client?.scan?.result ? 1 : 0, client?.rows?.length ?? 1) + extra
    }
    case 'Box': {
      if (props.display === 'none') return 0
      if (props.overflow === 'hidden' && typeof props.height === 'number') return props.height + extra
      const children = kids(childrenOf(element)).filter(
        child => (child as { props?: Record<string, unknown> }).props?.position !== 'absolute',
      )
      const inner = Math.max(8, width - 2 * (Number(props.paddingX) || 0) - (Number(props.marginLeft) || 0))
      if (props.flexDirection === 'row') {
        if (props.flexWrap === 'wrap')
          return (
            Math.max(
              1,
              Math.ceil(
                children.reduce(
                  (sum: number, child) =>
                    sum +
                    textOf(
                      (child as { props?: Record<string, unknown> }).props?.label ??
                        childrenOf(child as { props?: Record<string, unknown> }),
                    ).length +
                    5,
                  0,
                ) / inner,
              ),
            ) + extra
          )
        const fixed = children.reduce((sum: number, child) => {
          const childProps = (child as { props?: Record<string, unknown> }).props ?? {}
          return sum + (typeof childProps.width === 'number' ? childProps.width : 0)
        }, 0)
        return Math.max(0, ...children.map(child => {
          const childProps = (child as { props?: Record<string, unknown> }).props ?? {}
          const available = typeof childProps.width === 'number'
            ? childProps.width
            : childProps.flexGrow && childProps.flexShrink ? inner - fixed : inner
          return rowsOf(child, Math.max(8, available))
        })) + extra
      }
      const gap = (Number(props.gap) || 0) * Math.max(0, children.length - 1)
      return children.reduce((sum: number, child) => sum + rowsOf(child, inner), 0) + gap + extra
    }
    default:
      return 1 + extra
  }
}

function toneColor(tone: ScreenRow['tone'] | ScreenSection['tone']): string | undefined {
  return tone ? C[tone] : undefined
}
function glyph(ctx: Ctx, name: GlyphKey): Glyph {
  return { ...GLYPH[name], char: surfaceGlyphs[name] }
}
function actions(
  ctx: Ctx,
  items: ScreenAction[],
  options: { marginLeft?: number; gap?: number; flexWrap?: 'wrap' | 'nowrap' } = {},
): RenderElement | null {
  if (!items.length) return null
  return ActionGroup(
    { el: ctx.el, width: ctx.width },
    items.map(item => ({ key: item.key, label: item.label, primary: item.primary, role: item.role, onPress: () => ctx.act(item.action) })),
    options,
  )
}

function layoutRow(input: Parameters<typeof uiLayoutRow>[0], keepCounts = false): ReturnType<typeof uiLayoutRow> {
  const width = input.metaParts?.length ? Math.max(60, input.width) : input.width
  const layout = uiLayoutRow(keepCounts ? { ...input, width, text: '' } : { ...input, width })
  const parts = layout.metaParts.map(part => part.text)
  const meta = parts.length ? [...parts, ...(layout.right ? [layout.right] : [])].join(' ')
    : [layout.meta, layout.right].filter(Boolean).join(' · ')
  if (!meta) return layout
  const available = Math.max(1, input.width - cellWidth(input.prefix) - cellWidth(meta) - 1)
  const title = uiLayoutRow({ width: available, prefix: '', text: input.text, middle: input.middle })
  return { ...layout, text: title.text }
}

function truncateCells(value: string, budget: number, middle = false): string {
  const width = Math.max(0, budget)
  if (cellWidth(value) <= width) return value
  if (width <= 1) return width === 0 ? '' : '…'
  const room = width - 1
  if (!middle) {
    let out = ''
    for (const char of value) {
      if (cellWidth(out + char) > room) break
      out += char
    }
    return `${out}…`
  }
  let left = ''
  let right = ''
  const leftRoom = Math.ceil(room / 2)
  const rightRoom = Math.floor(room / 2)
  for (const char of value) {
    if (cellWidth(left + char) > leftRoom) break
    left += char
  }
  for (const char of [...value].reverse()) {
    if (cellWidth(char + right) > rightRoom) break
    right = char + right
  }
  return `${left}…${right}`
}

function inlineMeta(ctx: Ctx, row: ScreenRow, layout: ReturnType<typeof layoutRow>): RenderElement | null {
  const { Box, Text } = ctx.el
  if (layout.metaParts.length) {
    return (
      <Box flexDirection="row" gap={1} flexShrink={0}>
        {layout.metaParts.map(part => {
          const source = row.metaParts?.[part.sourceIndex]
          return (
            <Text
              key={`meta-${row.key}-${part.sourceIndex}`}
              color={source?.tone ? toneColor(source.tone) : undefined}
              dimColor={source?.dim}
            >
              {part.text}
            </Text>
          )
        })}
        {layout.right ? <Text dimColor>{layout.right}</Text> : null}
      </Box>
    )
  }
  if (!layout.meta && !layout.right) return null
  return (
    <Box flexDirection="row" gap={1} flexShrink={0}>
      {layout.meta ? <Text dimColor wrap="truncate-end">{layout.meta}</Text> : null}
      {layout.meta && layout.right ? <Text dimColor>·</Text> : null}
      {layout.right ? <Text dimColor wrap="truncate-end">{layout.right}</Text> : null}
    </Box>
  )
}

function renderRow(ctx: Ctx, row: ScreenRow): RenderElement {
  const content = renderRowContent(ctx, row)
  if (!row.expandable || ctx.view.expanded !== row.id) return content
  const { Box, Text } = ctx.el
  return (
    <Box key={`expansion-${row.key}`} flexDirection="column">
      {content}
      <Box key={`expansion-gap-${row.key}`} height={1} flexShrink={0}><Text>{''}</Text></Box>
    </Box>
  )
}

function renderRowContent(ctx: Ctx, row: ScreenRow): RenderElement {
  const { Box, Text, Button } = ctx.el
  if (row.setting) {
    const state = row.meta ?? (row.checkbox === undefined ? '' : row.checkbox ? 'On' : 'Off')
    const label = `${row.text}${state ? ` · ${state}` : ''}`
    const action = row.actions?.[0]?.action
    return <Button key={row.key} label={label} variant="secondary" onPress={() => action && ctx.act(action)} />
  }
  const rawGlyph = row.glyph ? glyph(ctx, row.glyph) : undefined
  const g = rawGlyph ? { ...rawGlyph, char: rawGlyph.char.replace(/\uFE0F/g, '') } : undefined
  const sourceMark = g ? undefined : row.sourceMark?.replace(/\uFE0F/g, '')
  const indent = Math.max(0, row.depth ?? 0) * 2
  const open = row.expandable && ctx.view.expanded === row.id
  const headPress = row.interactive
    ? () =>
        ctx.act(
          row.kind === 'event'
            ? { type: 'expand', id: row.id }
            : { type: 'expand', id: row.id },
        )
    : undefined
  const icon = sourceMark ?? g?.char ?? (row.fresh ? GLYPH.fresh.char : open ? GLYPH.expanded.char : '')
  const metaLayout = layoutRow({ width: ctx.width, prefix: '', text: '', meta: row.meta, metaParts: row.metaParts, right: row.right }, row.kind === 'event' && Boolean(row.metaParts?.length))
  const metaText = [...metaLayout.metaParts.map(part => part.text), metaLayout.meta, metaLayout.right].filter(Boolean).join(' ')
  const titleBudget = Math.max(1, ctx.width - indent - 2 - 3 - 2 - cellWidth(metaText) - 2)
  const rowTitle = truncateCells(row.text, titleBudget, row.kind === 'file')
  const head = (
    <Box key={`head-${row.key}`} flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0} marginLeft={indent}>
      <Box width={3} flexShrink={0} alignItems="center" justifyContent="center">
        <Text color={sourceMark ? row.sourceMarkColor : g?.color ?? (row.fresh ? GLYPH.fresh.color : open ? GLYPH.expanded.color : undefined)} bold={row.bold || open} dimColor={!icon}>{icon}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        {headPress ? (
          <Button
            key={row.key}
            plain
            dimColor={row.dim}
            label={rowTitle}
            onPress={headPress}
          />
        ) : (
          <Text bold={row.bold} dimColor={row.dim} italic={row.italic} wrap="truncate-end">
            {rowTitle}
          </Text>
        )}
      </Box>
      {inlineMeta(ctx, row, metaLayout)}
    </Box>
  )
  if (row.kind === 'text')
    return (
      <Text key={row.key} bold={row.bold} dimColor={row.dim} wrap="wrap">
        {row.text}
      </Text>
    )
  if (row.kind === 'suggestion' && !row.expandable)
    return (
      <Box key={row.key} flexDirection="column" flexGrow={1} minWidth={0}>
        {head}
        {actions(ctx, row.actions ?? [])}
      </Box>
    )
  if (row.kind === 'suggestion' || row.kind === 'recall') {
    const extra = [
      ...(row.actions ?? []),
      { key: `close-${row.key}`, label: 'Close', action: { type: 'expand', id: row.id } as const },
    ]
    return (
      <Box key={row.key} flexDirection="column">
        {head}
        {open ? <Detail ctx={ctx} row={row} /> : null}
        {open ? actions(ctx, extra) : null}
      </Box>
    )
  }
  if (row.kind === 'activity') return <Box key={row.key} flexDirection="column" flexGrow={1} minWidth={0}>{head}</Box>
  if (row.kind === 'detour')
    return (
      <Box key={row.key} flexDirection="column">
        {head}
        {open ? <Detail ctx={ctx} row={row} /> : null}
        {open
          ? actions(ctx, [
              ...(row.actions ?? []),
              { key: `close-${row.key}`, label: 'Close', action: { type: 'expand', id: row.id } },
            ])
          : null}
      </Box>
    )
  if (row.kind === 'next')
    return (
      <Box key={row.key} flexDirection="column">
        {head}
        {actions(ctx, row.actions ?? [])}
        {open ? <Detail ctx={ctx} row={row} /> : null}
      </Box>
    )
  if (!row.expandable)
    return (
      <Box key={row.key} flexDirection="column">
        {head}
        {actions(ctx, row.kind === 'event' ? [] : (row.actions ?? []))}
      </Box>
    )
  if (!open)
    return (
      <Box key={row.key} flexDirection="column">
        {head}
      </Box>
    )
  const extra: ScreenAction[] =
    row.kind === 'goal'
      ? (row.actions ?? [])
      : [
          ...(row.actions ?? []),
          {
            key: `add-${row.key}`,
            label: 'Add to message',
            action: { type: 'attach', ref: { kind: row.kind, id: row.id, text: row.fullText ?? row.text } },
          },
          { key: `close-${row.key}`, label: 'Close', action: { type: 'expand', id: row.id } },
        ]
  return (
    <Box key={row.key} flexDirection="column">
      {head}
      {row.kind === 'event' ? <EventDetail ctx={ctx} row={row} /> : <Detail ctx={ctx} row={row} />}
      {row.suggestedGoals?.length ? (
        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor>Suggested goals:</Text>
          {row.suggestedGoals.map(suggestion => renderRow(ctx, suggestion))}
        </Box>
      ) : null}
      {actions(ctx, extra)}
    </Box>
  )
}

type DetailLine = { text: string; dim?: boolean }

function eventDetailLines(row: ScreenRow): DetailLine[] {
  return (row.detail?.length ? row.detail : ['No additional details recorded.']).flatMap((line, index) =>
    line.split(/\r?\n/).map(text => ({ text, dim: index < 3 })),
  )
}

function guideRow(ctx: Ctx, key: string, content: RenderElement): RenderElement {
  const { Box } = ctx.el
  return (
    <Box key={key} flexDirection="row" flexShrink={0} marginLeft={2}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>{content}</Box>
    </Box>
  )
}

function eventGeometry(ctx: Ctx, row: ScreenRow) {
  const { Text } = ctx.el
  const items = eventDetailLines(row).map((line, index) =>
    guideRow(ctx, `expanded-line-${row.id}-${index}`, <Text dimColor={line.dim} wrap="wrap">
      {['✻', '⌬', '□'].includes(line.text[0] ?? '') && line.text[1] === ' ' ? (
        <Text color={Object.values(SOURCE_MARK).find(source => source.mark === line.text[0])?.color}>{line.text[0]}</Text>
      ) : null}
      {['✻', '⌬', '□'].includes(line.text[0] ?? '') && line.text[1] === ' ' ? line.text.slice(1) : line.text}
    </Text>),
  )
  const itemRows = items.map(item => rowsOf(item, Math.max(8, ctx.width - 2)))
  const total = itemRows.reduce((sum, rows) => sum + rows, 0)
  const visible = Math.min(total, 6)
  return { items, itemRows, total, visible, maxScroll: Math.max(0, total - visible) }
}

function EventDetail({ ctx, row }: { ctx: Ctx; row: ScreenRow }): RenderElement {
  const { Box, Text, Button } = ctx.el
  const geometry = eventGeometry(ctx, row)
  const { visible, maxScroll } = geometry
  const at = Math.min(Math.max(0, ctx.view.expandedScroll), maxScroll)
  const window = rowWindow(geometry.items, geometry.itemRows, at, visible)
  return (
    <Box key={`expanded-detail-${row.id}`} flexDirection="column" marginLeft={2}>
      <Box key={`expanded-body-${row.id}`} flexDirection="column" height={visible} overflow="hidden" flexShrink={0}>
        <Box key={`expanded-window-${row.id}`} flexDirection="column" marginTop={-window.offset} flexShrink={0}>
          {window.items}
        </Box>
      </Box>
      {maxScroll > 0 ? (
        <Box flexDirection="row" justifyContent="space-between">
          <Button key="expanded-up" dimColor={at === 0} label="Previous" onPress={() => ctx.act({ type: 'expanded-scroll', by: -1 })} />
          <Text dimColor>{`${at + 1}/${geometry.total}`}</Text>
          <Button key="expanded-down" dimColor={at >= maxScroll} label="Next" onPress={() => ctx.act({ type: 'expanded-scroll', by: 1 })} />
        </Box>
      ) : null}
    </Box>
  )
}

function Detail({ ctx, row }: { ctx: Ctx; row: ScreenRow }): RenderElement {
  const { Box, Text } = ctx.el
  return (
    <Box flexDirection="column" marginLeft={2}>
      {(row.detail?.length ? row.detail : ['No additional details recorded.']).map((line, index) =>
        guideRow(ctx, `detail-${row.key}-${index}`, <Text dimColor wrap="wrap">{line}</Text>),
      )}
    </Box>
  )
}

function sectionExpansionId(section: ScreenSection): string {
  return `section:${section.key}`
}

function visibleHelpRows(ctx: Ctx, totalRows: number): number {
  const room = ctx.bodyViewport ?? ctx.rows
  const target = room >= 12 ? 5 : 3
  return Math.min(totalRows, target)
}

function helpGeometry(ctx: Ctx, section: ScreenSection) {
  const { Text } = ctx.el
  const items = section.help.map((line, index) =>
    guideRow(ctx, `help-line-${section.key}-${index}`, <Text dimColor wrap="wrap">{line}</Text>),
  )
  const itemRows = items.map(item => rowsOf(item, Math.max(8, ctx.width - 2)))
  const total = itemRows.reduce((sum, rows) => sum + rows, 0)
  const visible = visibleHelpRows(ctx, total)
  return { items, itemRows, total, visible, maxScroll: Math.max(0, total - visible) }
}

function sectionHelp(ctx: Ctx, section: ScreenSection): RenderElement | null {
  if (ctx.view.expanded !== sectionExpansionId(section)) return null
  const { Box, Button, Text } = ctx.el
  const geometry = helpGeometry(ctx, section)
  const { visible, maxScroll: max } = geometry
  const at = Math.min(Math.max(0, ctx.view.expandedScroll), max)
  const window = rowWindow(geometry.items, geometry.itemRows, at, visible)
  return (
    <Box key={`help-${section.key}`} flexDirection="column" marginLeft={2}>
      <Box key={`help-body-${section.key}`} flexDirection="column" height={visible} overflow="hidden" flexShrink={0}>
        <Box key={`help-window-${section.key}`} flexDirection="column" marginTop={-window.offset} flexShrink={0}>
          {window.items}
        </Box>
      </Box>
      {max > 0 ? (
        guideRow(ctx, `help-controls-${section.key}`, <Box flexDirection="row">
          <Button
            key={`help-up-${section.key}`}
            dimColor={at === 0}
            label="Previous"
            onPress={() => ctx.act({ type: 'expanded-scroll', by: -1 })}
          />
          <Text dimColor>{` ${at + 1}/${geometry.total} `}</Text>
          <Button
            key={`help-down-${section.key}`}
            dimColor={at >= max}
            label="Next"
            onPress={() => ctx.act({ type: 'expanded-scroll', by: 1 })}
          />
        </Box>)
      ) : null}
      <Box key={`help-gap-${section.key}`} height={1} flexShrink={0}><Text>{''}</Text></Box>
    </Box>
  )
}

function renderSection(ctx: Ctx, section: ScreenSection): RenderElement {
  const { Box, Text, Input } = ctx.el
  const trailControls = section.key === 'events' ? trailToolbar(ctx) : null
  const rows = section.rows.length
    ? section.rows.map(row => renderRow(ctx, row))
    : section.empty
      ? [
          <Text key={`${section.key}-empty`} dimColor wrap="wrap">
            {section.empty}
          </Text>,
        ]
      : []
  const note = ctx.view.legend ? section.explain : undefined
  const right = section.key === 'events' ? null : section.actions?.length ? (
    actions(ctx, section.actions, { marginLeft: 0, gap: 0, flexWrap: 'nowrap' })
  ) : section.right ? (
    <Text dimColor wrap="truncate-end">
      {section.right}
    </Text>
  ) : null
  const showInput = Boolean(section.input && Input && (ctx.view.editingGoal || section.rows.length === 0))
  return Section(
    { el: ctx.el, width: ctx.width },
    {
      key: section.key,
      heading: section.heading,
      explain: note,
      headingPress: () => ctx.act({ type: 'expand', id: sectionExpansionId(section) }),
      expansion: sectionHelp(ctx, section) ?? undefined,
      count: section.count,
      right: right ?? undefined,
      color: toneColor(section.tone),
      dim: section.dim,
    },
    <Box flexDirection="column" flexGrow={1} minWidth={0}>
      {section.dim ? (
        <Text dimColor wrap="truncate-end">
          {OBSERVER_NOTE}
        </Text>
      ) : null}
      {trailControls}
      {rows}
      {showInput && section.input && Input ? (
        <Input
          key={section.input.key}
          label={section.input.label}
          placeholder={section.input.placeholder}
          submitLabel={section.input.submitLabel}
          onSubmit={(value: string) => ctx.act({ type: 'goal', text: value })}
        />
      ) : null}
    </Box>,
  )
}

function screenFor(snapshot: AtlasSnapshot, view: ScreenView, now: number): ScreenModel {
  const builders: Record<AtlasTab, ScreenBuilder> = { map: buildMap, trail: buildTrail, open: buildOpen, evidence: buildEvidence }
  return builders[view.tab](snapshot, view, now)
}

export const LEGEND: [GlyphKey, string][] = [
  ['goal', 'your goal (confirmed)'],
  ['suggestion', 'suggestion, needs you'],
  ['currentTopic', 'current topic'],
  ['detour', 'detour / possible detour'],
  ['returned', 'returned'],
  ['observedDecision', 'decision, not settled'],
  ['settledDecision', 'settled decision'],
  ['checkpoint', 'checkpoint / evidence'],
  ['openQuestion', 'open question'],
  ['ok', 'done'],
  ['fail', 'failed'],
  ['editedFile', 'file edited'],
  ['readFile', 'file read'],
  ['fresh', 'just changed'],
  ['resolved', 'resolved question'],
  ['next', 'next step'],
  ['resume', 'resume earlier session'],
  ['handoff', 'hand-off running'],
  ['reportBack', 'report back'],
]
export function legendPanel(ctx: Ctx, height?: number, at = 0): RenderElement {
  const { Box, Text } = ctx.el
  const content = (
    <Box key="legend-content" flexDirection="column" flexShrink={0}>
      <Box flexShrink={0}><Text bold>HOW TO USE</Text></Box>
      <Box flexShrink={0}><Text dimColor wrap="wrap">
        Plain rows expand structured details inline. Desktop actions use native controls.
      </Text></Box>
      <Box flexShrink={0}><Text dimColor wrap="wrap">
        Topics from the start of the work to now stay observed; press an action to confirm intent.
      </Text></Box>
      <Box flexShrink={0}><Text wrap="wrap">
        Marks: <Text color={SOURCE_MARK.person.color}>›</Text> you ·{' '}
        <Text color={SOURCE_MARK.claude.color}>✻</Text> Claude · <Text color={SOURCE_MARK.codex.color}>⌬</Text> Codex ·{' '}
        <Text color={SOURCE_MARK.other.color}>□</Text> other
      </Text></Box>
      <Box flexShrink={0}><Text bold>OBSERVER</Text></Box>
      <Box flexDirection="row" flexShrink={0}>
        {actions(
          ctx,
          [
            {
              key: 'observer-toggle',
              label: ctx.mode === 'claude' ? 'Claude' : 'Engine only',
              primary: ctx.mode === 'claude',
              action: { type: 'toggle-observer' },
            },
          ],
          { marginLeft: 0, gap: 0 },
        )}
      </Box>
      <Box flexShrink={0}><Text bold>LEGEND</Text></Box>
      <Box flexShrink={0}><Text wrap="wrap">
        counts: <Text color={C.write}>e</Text> edits <Text color={C.read}>r</Text> reads{' '}
        <Text color={C.path}>t</Text> topics <Text color={C.decision}>d</Text> decisions{' '}
        <Text color={C.question}>q</Text> questions <Text color={C.checkpoint}>h</Text> hand-offs{' '}
        <Text color={C.checkpoint}>b</Text> report-backs
      </Text></Box>
      <Box flexDirection="row" flexGrow={1} flexShrink={1}>
      {(ctx.width >= 64 ? [LEGEND.slice(0, Math.ceil(LEGEND.length / 2)), LEGEND.slice(Math.ceil(LEGEND.length / 2))] : [LEGEND]).map((column, columnIndex) => (
        <Box key={`legend-columns-${columnIndex}`} flexDirection="column" flexGrow={1} flexShrink={1}>
        {column.map(([name, meaning]) => {
        const g = glyph(ctx, name)
        return (
          <Box key={`lg-${name}`} flexDirection="row" gap={1} flexShrink={0}>
            <Box width={3} flexShrink={0}><Text color={g.color} bold>{g.char}</Text></Box>
            <Text wrap="truncate-end">{meaning}</Text>
          </Box>
        )
      })}
        </Box>
      ))}
      </Box>
    </Box>
  )
  const frame = (
    <Box
      key="legend-panel"
      flexDirection="column"
      flexShrink={0}
      height={height ?? rowsOf(content, Math.max(8, ctx.width - 2))}
      overflow="hidden"
    >
      {height === undefined ? content : <Box flexDirection="column" marginTop={-at} flexShrink={0}>{content}</Box>}
    </Box>
  )
  return frame
}
function setupScreen(ctx: Ctx): RenderElement {
  const { Box, Text } = ctx.el
  return (
    <Box key="setup-screen" flexDirection="column" marginTop={2}>
      <Text bold color={C.goal}>
        Set up Atlas
      </Text>
      <Text dimColor wrap="wrap">
        Claude observer adds topics and path, possible detours, Claude-reported decisions and questions, a detected goal, and a suggested
        next step.
      </Text>
      <Text dimColor wrap="wrap">
        When something changes, it uses a small amount of Claude usage: one extra tool step plus a cached rules section.
      </Text>
      <Text dimColor wrap="wrap">
        This choice applies in every project.
      </Text>
      <Text dimColor wrap="wrap">
        Engine only is free and keeps activity, files, tests, commits, prompt trail, wording cues, recovery, chips and return packets.
      </Text>
      {ctx.setupDefault === 'engine' ? <Text dimColor>Default from /config: Engine only.</Text> : null}
      <Box marginTop={1}>
        {actions(
          ctx,
          [
            { key: 'setup-claude', label: 'Use Claude observer', action: { type: 'set-observer', mode: 'claude' }, primary: true },
            { key: 'setup-engine', label: 'Engine only (free)', action: { type: 'set-observer', mode: 'engine' } },
          ],
          { marginLeft: 0 },
        )}
      </Box>
    </Box>
  )
}

function rowWindow(items: RenderElement[], itemRows: number[], at: number, bodyRows: number) {
  let start = 0
  let skipped = 0
  while (start < items.length && skipped + (itemRows[start] ?? 1) <= at) {
    skipped += itemRows[start] ?? 1
    start++
  }
  let end = start
  let used = skipped
  while (end < items.length && used < at + bodyRows) {
    used += itemRows[end] ?? 1
    end++
  }
  return { items: items.slice(start, end), start, offset: at - skipped }
}
export function popupShell(ctx: Ctx, popup: ScreenPopup, _placement: { top?: number; bottom?: number; left?: number }): RenderElement {
  const { Box } = ctx.el
  return <Box flexDirection="column">{popup.rows.map(row => renderRow(ctx, row))}</Box>
}

function trailToolbar(ctx: Ctx): RenderElement {
  const { Box, Button, Text } = ctx.el
  const pages = [0, 1, 2].map(page => trailViewPopup(ctx.view.trailView, ctx.view.trailNewest, ctx.view.hidden ?? [], page))
  const viewRows = pages[0]?.rows ?? []
  const orderRow = pages[1]?.rows.find(row => row.actions?.some(item => item.key === 'trail-sort'))
  const filterRows = pages[2]?.rows ?? []
  const setting = (rows: ScreenRow[], key: string) => rows.find(row => row.actions?.some(item => item.key === key))
  const story = setting(viewRows, 'trail-view-story')
  const log = setting(viewRows, 'trail-view-log')
  const reports = setting(filterRows, 'trail-filter-b-toggle')
  const handoffs = setting(filterRows, 'trail-filter-h-toggle')
  const button = (row: ScreenRow | undefined, key: string, label: string, primary = false, dimColor?: boolean) => {
    const action = row?.actions?.[0]?.action
    return <Button key={key} label={label} variant={primary ? 'primary' : 'secondary'} dimColor={dimColor ?? false} onPress={() => action && ctx.act(action)} />
  }
  const stateLabel = (row: ScreenRow | undefined) => `${row?.checkbox ? '○' : '✓'} ${row?.text ?? ''}`
  const Select = (ctx.el as any).Select
  const viewControl = Select
    ? <Select key="trail-view-select" options={[{ value: 'story', label: 'Story' }, { value: 'log', label: 'Log' }]} value={ctx.view.trailView} onSelect={(value: string) => {
        const row = value === 'log' ? log : story
        const action = row?.actions?.[0]?.action
        if (action) ctx.act(action)
      }} />
    : <Box flexDirection="row" gap={1}>
        {button(story, 'trail-view-story', 'Story', story?.checkbox === true)}
        {button(log, 'trail-view-log', 'Log', log?.checkbox === true)}
      </Box>
  return (
    <Box key="trail-toolbar" flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {viewControl}
        {button(reports, 'trail-filter-b-toggle', stateLabel(reports), false, reports?.checkbox === true)}
        {button(handoffs, 'trail-filter-h-toggle', stateLabel(handoffs), false, handoffs?.checkbox === true)}
      </Box>
      <Box flexGrow={1} />
      {button(orderRow, 'trail-sort', orderRow?.meta === 'oldest first' ? 'Oldest ▲' : 'Newest ▼')}
    </Box>
  )
}

function renderBody(ctx: Ctx, model: ScreenModel): RenderElement {
  const { Box, Button, Text } = ctx.el
  const popup = ctx.view.popup
  return (
    <Box flexDirection="column">
      {popup ? (
        <Box key="terminal-popup-notice" flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
          <Text dimColor>A panel from the terminal view is open</Text>
          <Button
            key="popup-close"
            label="Close it"
            onPress={() => ctx.act({ type: 'popup', popup: { kind: popup.kind, ...(popup.id ? { id: popup.id } : {}) } })}
          />
        </Box>
      ) : null}
      {model.sections.map(section => (
        <Box key={`screen-${section.key}`} flexDirection="column" flexGrow={1} minWidth={0}>
          {renderSection(ctx, section)}
        </Box>
      ))}
    </Box>
  )
}
function tabItems(ctx: Ctx, snapshot: AtlasSnapshot): BarItem[] {
  const pending =
    snapshot.suggestions.length + snapshot.decisions.filter(item => item.status === 'observed').length + openQuestions(snapshot).length
  return [
    {
      key: 'tab-map',
      label: 'Map',
      short: 'Map',
      compact: 'M',
      hotkey: 'm',
      active: ctx.view.tab === 'map',
      activeColor: TAB_ACCENT.map,
      onPress: () => ctx.act({ type: 'tab', tab: 'map' }),
    },
    {
      key: 'tab-trail',
      label: 'Trail',
      short: 'Trail',
      compact: 'T',
      hotkey: 't',
      active: ctx.view.tab === 'trail',
      activeColor: TAB_ACCENT.trail,
      onPress: () => ctx.act({ type: 'tab', tab: 'trail' }),
    },
    {
      key: 'tab-open',
      label: pending ? `Open ${pending}` : 'Open',
      short: pending ? `Open ${pending}` : 'Open',
      compact: 'O',
      hotkey: 'o',
      active: ctx.view.tab === 'open',
      activeColor: TAB_ACCENT.open,
      onPress: () => ctx.act({ type: 'tab', tab: 'open' }),
    },
    {
      key: 'tab-evidence',
      label: 'Evidence',
      short: 'Evid',
      compact: 'E',
      hotkey: 'e',
      active: ctx.view.tab === 'evidence',
      activeColor: TAB_ACCENT.evidence,
      onPress: () => ctx.act({ type: 'tab', tab: 'evidence' }),
    },
  ]
}
function tabBar(ctx: Ctx, snapshot: AtlasSnapshot, scroll: { max: number; at: number; page: number }): RenderElement {
  const { Box, Button, Text, Svg } = ctx.el
  const items = tabItems(ctx, snapshot)
  return (
    <Box key="tab-bar" flexDirection="column" flexShrink={0} minWidth={0}>
      <Box flexDirection="row" gap={1} flexWrap="wrap" flexShrink={0}>
        {items.map(item => (
          <Box key={`tab-${item.key}`} flexDirection="column" flexShrink={0}>
            <Button key={item.key} label={item.label} hotkey={item.hotkey} variant={item.active ? 'primary' : 'secondary'} onPress={item.onPress} />
          </Box>
        ))}
        {scroll.max > 0 || scroll.page <= 10 ? (
          <Box flexDirection="row" gap={1} flexShrink={0}>
          <Button
            key="scroll-up"
            dimColor={scroll.max === 0 || scroll.at === 0}
            label="Up"
            onPress={() => ctx.act({ type: 'scroll', by: -scroll.page })}
          />
          <Button
            key="scroll-down"
            dimColor={scroll.max === 0 || scroll.at >= scroll.max}
            label="Down"
            onPress={() => ctx.act({ type: 'scroll', by: scroll.page })}
          />
          </Box>
        ) : null}
      </Box>
      {Svg ? <Svg
        key="tab-baseline"
        source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 2" preserveAspectRatio="none"><path d="M0 1H100" stroke="${TAB_ACCENT[ctx.view.tab]}" stroke-width="2"/></svg>`}
        alt="Tab strip baseline"
        width={Math.max(1, ctx.width * 8)}
        height={2}
      /> : <Text dimColor>{'_'.repeat(Math.max(1, ctx.width - 2))}</Text>}
    </Box>
  )
}
function tabBarRows(ctx: Ctx, snapshot: AtlasSnapshot, max: number): number {
  return rowsOf(tabBar(ctx, snapshot, { at: 0, max: 0, page: Math.max(11, ctx.width) }), ctx.width) + 1
}
function appBarItems(ctx: Ctx, snapshot: AtlasSnapshot): BarItem[] {
  return [
    { key: 'legend', label: 'Legend', short: 'Legend', compact: '≡', hotkey: 'l', onPress: () => ctx.act({ type: 'legend' }) },
    { key: 'mark', label: '+ Mark', short: '+ Mark', compact: '+', hotkey: 'k', onPress: () => ctx.act({ type: 'mark' }) },
  ]
}
function appBar(ctx: Ctx, snapshot: AtlasSnapshot): RenderElement {
  const { Box, Button, Text } = ctx.el
  const items = appBarItems(ctx, snapshot)
  return (
    <Box key="app-bar" flexDirection="row" gap={1} flexWrap="wrap" flexShrink={0} marginTop={1}>
      {items.map(item => (
        <Box key={`bar-${item.key}`} flexDirection="column" flexShrink={0}>
          <Button key={item.key === 'mark' ? 'mark' : 'bar-legend'} label={item.label} hotkey={item.hotkey} variant={item.key === 'legend' && ctx.view.legend ? 'primary' : 'secondary'} onPress={item.onPress} />
          {item.key === 'legend' && ctx.view.legend ? <Text color={TAB_ACCENT[ctx.view.tab]} bold>━━━━━━</Text> : null}
        </Box>
      ))}
    </Box>
  )
}
function appBarRows(ctx: Ctx, snapshot: AtlasSnapshot): number {
  return ctx.view.legend ? 3 : 2
}
function scrollbarCells(ctx: Ctx, viewport: number, content: number, at: number, maxScroll: number): RenderElement {
  const { Box, Button, Svg } = ctx.el
  const size = Math.min(viewport, Math.max(1, Math.round((viewport * viewport) / content)))
  const top = maxScroll ? Math.round((at / maxScroll) * (viewport - size)) : 0
  return (
    <Box key="scrollbar" flexDirection="column" width={2} flexShrink={0} height={viewport} overflow="hidden">
      {Svg ? <Svg
        key="scrollbar-track"
        source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 ${viewport * 16}" preserveAspectRatio="none"><rect x="1" y="0" width="2" height="${viewport * 16}" rx="1" fill="#41414a"/><rect x="0" y="${top * 16}" width="4" height="${Math.max(16, size * 16)}" rx="2" fill="#7aa2f7"/></svg>`}
        alt={`Scroll position ${at + 1} of ${maxScroll + 1}`}
        width={8}
        height={viewport * 16}
      /> : null}
      <Button
        key="sb-thumb"
        plain
        label={`● ${top + 1}/${viewport}`}
        onPress={() => ctx.act({ type: 'scroll-to', at: Math.round((top / Math.max(1, viewport - size)) * maxScroll) })}
      />
    </Box>
  )
}
function scanBanner(ctx: Ctx): RenderElement | null {
  const visible = ctx.scan.active || (Boolean(ctx.scan.result) && ctx.now - ctx.scan.resultAt < SCAN_RESULT_MS)
  if (!visible) return null
  return ctx.live('scan', [{ segs: [{ t: ctx.scan.active ? 'Mapping earlier conversation…' : (ctx.scan.result ?? '') }] }], {
    ...ctx.scan,
    result: ctx.scan.active ? null : ctx.scan.result,
    now: ctx.now,
  })
}

function expandedEvent(ctx: Ctx, model: ScreenModel): ScreenRow | undefined {
  if (!ctx.view.expanded) return undefined
  return model.sections.flatMap(section => section.rows).find(row => row.id === ctx.view.expanded && row.kind === 'event')
}

export function pane(input: PaneCtx, snapshot: AtlasSnapshot): {
  tree: RenderElement
  maxScroll: number
  maxPopupScroll: number
  maxLegendScroll: number
  maxExpandedScroll: number
} {
  const ctx: Ctx = input
  const { Box, Text } = ctx.el
  if (ctx.view.setup)
    return {
      tree: (
        <Box flexDirection="column" paddingX={1}>
          {setupScreen(ctx)}
        </Box>
      ),
      maxScroll: 0,
      maxPopupScroll: 0,
      maxExpandedScroll: 0,
      maxLegendScroll: 0,
    }
  const model = screenFor(snapshot, { ...ctx.view, mode: ctx.mode }, ctx.now)
  const appRows = appBarRows(ctx, snapshot)
  const scan = scanBanner(ctx)
  const scanRows = scan ? rowsOf(scan, ctx.width) : 0
  const legend = ctx.view.legend ? legendPanel(ctx) : null
  const fixedWithoutLegend = tabBarRows(ctx, snapshot, 1) + scanRows + appRows
  const legendContentRows = legend ? rowsOf(legend, ctx.width) : 0
  const legendRows = legend ? Math.min(legendContentRows, Math.max(1, ctx.rows - fixedWithoutLegend)) : 0
  const maxLegendScroll = Math.max(0, legendContentRows - legendRows)
  const legendAt = Math.min(Math.max(0, ctx.view.legendScroll), maxLegendScroll)
  const fixed = fixedWithoutLegend + legendRows
  const viewport = ctx.rows - fixed
  const pinned = viewport >= 4
  const bodyCtx: Ctx = { ...ctx, bodyViewport: viewport }
  const expandedSection = model.sections.find(section => sectionExpansionId(section) === ctx.view.expanded)
  const expanded = expandedEvent(bodyCtx, model)
  let body = renderBody(bodyCtx, model)
  let content = rowsOf(body, ctx.width)
  const bar = pinned && content > viewport
  const drawCtx = bar ? { ...bodyCtx, width: ctx.width - 2 } : bodyCtx
  if (bar) {
    body = renderBody(drawCtx, model)
    content = rowsOf(body, ctx.width - 2)
  }
  const maxExpandedScroll = expandedSection
    ? helpGeometry(drawCtx, expandedSection).maxScroll
    : expanded
      ? eventGeometry(drawCtx, expanded).maxScroll
      : 0
  const maxScroll = pinned ? Math.max(0, content - viewport) : 0
  const at = Math.min(Math.max(0, ctx.view.scroll), maxScroll)
  const scrollbar = bar && maxScroll > 0 ? scrollbarCells(ctx, viewport, content, at, maxScroll) : null
  const maxPopupScroll = 0
  const bodyTree = pinned ? (
    <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        <Box flexDirection="column" flexShrink={0} minWidth={0} marginTop={-at}>
          {body}
        </Box>
      </Box>
      {scrollbar}
    </Box>
  ) : (
    <Box flexDirection="column">
      {body}
    </Box>
  )
  const tree = (
    <Box key="pane-root" flexDirection="column" minWidth={0} overflow="hidden" paddingX={1} {...(pinned ? { height: ctx.rows } : {})}>
      {tabBar(ctx, snapshot, { at, max: maxScroll, page: Math.max(1, viewport - 2) })}
      <Box height={1} flexShrink={0}><Text>{''}</Text></Box>
      {bodyTree}
      {legend ? (
        <Box flexDirection="column" flexShrink={0} height={legendRows} overflow="hidden">
          {legendPanel(ctx, legendRows, legendAt)}
        </Box>
      ) : null}
      {scan}
      {appBar(ctx, snapshot)}
    </Box>
  )
  return { tree, maxScroll, maxPopupScroll, maxLegendScroll, maxExpandedScroll }
}

export function oneLine(snapshot: AtlasSnapshot): string {
  const current = snapshot.currentTopicId ? snapshot.topics.find(topic => topic.id === snapshot.currentTopicId) : undefined
  if (snapshot.detour) return `↳ ${snapshot.detour.reason}`
  if (current) return `● ${current.title}`
  if (snapshot.goal) return `◎ ${snapshot.goal.text}`
  return 'Atlas'
}
export { ago }


type ActionItem = { key: string; label: string; primary?: boolean; role?: 'dismiss'; onPress: () => void }
type ActionGroupOptions = { marginLeft?: number; gap?: number; flexWrap?: 'wrap' | 'nowrap' }
function Section(ctx: UiContext, section: UiSection, children: RenderElement): RenderElement {
  const { Box, Text, Button } = ctx.el
  return (
    <Box key={section.key} flexDirection="column" minWidth={0} marginTop={1}>
      <Box flexDirection="row" gap={1} flexShrink={0} minWidth={0}>
        <Box flexDirection="row" flexGrow={0} flexShrink={1} minWidth={0} overflow="hidden">
          <Text bold color={section.color} dimColor={section.dim} wrap="truncate-end">
            {section.heading}
          </Text>
        </Box>
        {section.headingPress ? (
          <Button
            key={`${section.key}-heading`}
            variant="secondary"
            dimColor={section.dim}
            label="?"
            onPress={section.headingPress}
          />
        ) : null}
        <Box flexGrow={1} flexShrink={1} minWidth={0} />
        {section.count ? (
          <Box flexShrink={0}><Text dimColor>{section.count}</Text></Box>
        ) : null}
        {section.right ? (
          <Box flexDirection="row" gap={1} flexShrink={0}>
            {typeof section.right === 'string' ? <Text dimColor wrap="truncate-end">{section.right}</Text> : section.right}
          </Box>
        ) : null}
      </Box>
      {section.explain ? (
        <Text dimColor italic wrap="wrap">
          {section.explain}
        </Text>
      ) : null}
      {section.expansion}
      {children}
    </Box>
  )
}

const surfaceGlyphs: GlyphSet = {
  goal: '◎', suggestion: '○', currentTopic: '●', detour: '↳', returned: '↩',
  observedDecision: '◇', settledDecision: '◆', checkpoint: '⚑', openQuestion: '?', resolved: '✓',
  ok: '✓', fail: '×', editedFile: '✎', readFile: '·', fresh: '✦', expanded: '▾', prompt: '•',
  next: '▸', resume: '◎', handoff: '→', reportBack: '←',
}

function ActionGroup(
  ctx: UiContext,
  items: ActionItem[],
  options: ActionGroupOptions = {},
): RenderElement {
  const { Box, Button } = ctx.el
  const marginLeft = options.marginLeft ?? 2
  const gap = options.gap ?? 1
  const flexWrap = options.flexWrap ?? 'wrap'
  return (
    <Box flexDirection="row" gap={gap} marginLeft={marginLeft} flexWrap={flexWrap}>
      {items.map(item => (
        <Button
          key={item.key}
          label={item.label}
          variant={item.primary ? 'primary' : 'secondary'}
          {...(item.role ? { role: item.role } : {})}
          onPress={() => item.onPress()}
        />
      ))}
    </Box>
  )
}

