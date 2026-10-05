// The pane shell and surface renderers. Tab content is pure data from
// hooks/screens; this module decides only how that data is laid out.

import type { Elements, RenderElement } from 'claude-code'
import type { AtlasMode, AtlasScanState, AtlasSnapshot, AtlasTab, AtlasView } from '../types'
import type { LiveRow } from './live'
import { openQuestions } from './model'
import {
  collapseBarLabelsWith,
  cellWidth,
  layoutRow as uiLayoutRow,
  measuredBarItemWidth,
  type BarItem,
  type BarKind,
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
const TAB_ACCENT: Record<AtlasTab, string> = { map: C.map, trail: C.trail, open: C.question, evidence: C.checkpoint }
export const TONES: Record<string, string[]> = {
  violet: ['#6d5a9c', '#8f78c9', '#b9a3f0', '#efe6ff'],
  orange: ['#9c5a2c', '#c9783e', '#f0a46e', '#fff0e0'],
  amber: ['#8c6a2c', '#b8903e', '#e0b86e', '#fff4d6'],
  green: ['#4f7a3a', '#6fa052', '#9ece6a', '#e8ffd6'],
  blue: ['#3d5a9c', '#5a7ac9', '#8aa8f0', '#e0eaff'],
}

type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & { Input?: Elements['terminal']['Input'] }
export type Ctx = {
  el: El
  width: number
  rows: number
  bodyViewport?: number
  inPopup?: boolean
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

// Owner decision "Option A": flip to true to restore expansion close buttons.
const EXPANSION_CLOSE_BUTTON = false

const OBSERVER_NOTE = 'Needs the Claude observer · /atlas observer claude'
const POPUP_BG = '#16161e'
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

// Reserve the close cell before allowing the left-hand actions to wrap.
function expansionActions(ctx: Ctx, row: ScreenRow, items: ScreenAction[]): RenderElement | null {
  const { Box, Button } = ctx.el
  const close = items.find(item => item.action.type === 'expand' && item.action.id === row.id)
  const left = items.filter(item => item !== close)
  if (!EXPANSION_CLOSE_BUTTON) return actions(ctx, left)
  return (
    <Box key={`expansion-actions-${row.key}`} flexDirection="row" gap={1} marginLeft={2} flexShrink={0}>
      <Box key={`expansion-actions-left-${row.key}`} flexGrow={1} flexShrink={1} minWidth={0}>
        {actions({ ...ctx, width: Math.max(1, ctx.width - 4) }, left, { marginLeft: 0 })}
      </Box>
      <Box key={`expansion-close-cell-${row.key}`} width={1} flexShrink={0}>
        <Button key={close?.key ?? `close-${row.key}`} plain label="✕"
          onPress={() => ctx.act(close?.action ?? { type: 'expand', id: row.id })} />
      </Box>
    </Box>
  )
}

function layoutRow(input: Parameters<typeof uiLayoutRow>[0], keepCounts = false): ReturnType<typeof uiLayoutRow> {
  const layout = uiLayoutRow(keepCounts ? { ...input, text: '' } : input)
  const parts = layout.metaParts.map(part => part.text)
  const droppedShortMeta = !parts.length && !layout.meta && !input.metaParts?.length && input.meta?.trim() === 'auto'
    ? input.meta
    : undefined
  const meta = parts.length ? [...parts, ...(layout.right ? [layout.right] : [])].join(' ')
    : [layout.meta ?? droppedShortMeta, layout.right].filter(Boolean).join(' · ')
  if (!meta) return layout
  const available = Math.max(1, input.width - cellWidth(input.prefix) - cellWidth(meta) - 1)
  const title = uiLayoutRow({ width: available, prefix: '', text: input.text, middle: input.middle })
  return { ...layout, text: title.text, meta: layout.meta ?? droppedShortMeta }
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
  if (ctx.inPopup || !row.expandable || ctx.view.expanded !== row.id) return content
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
    const mark = row.checkbox === undefined ? '' : row.checkbox ? '[x] ' : '[ ] '
    const prefix = `${row.direction ? (row.direction === 'desc' ? '▼ ' : '▲ ') : ''}${mark}`
    const layout = uiLayoutRow({ width: ctx.width, prefix, text: row.text, right: row.meta })
    const tail = layout.right ?? ''
    const used = cellWidth(prefix + layout.text) + (tail ? cellWidth(tail) + 1 : 0)
    const label = `${prefix}${layout.text}${tail ? `${' '.repeat(Math.max(1, ctx.width - used))}${tail}` : ''}`
    const action = row.actions?.[0]?.action
    return <Button key={row.key} plain label={label} onPress={() => action && ctx.act(action)} />
  }
  const rawGlyph = row.glyph ? glyph(ctx, row.glyph) : undefined
  const g = rawGlyph ? { ...rawGlyph, char: rawGlyph.char.replace(/\uFE0F/g, '') } : undefined
  const sourceMark = g ? undefined : row.sourceMark?.replace(/\uFE0F/g, '')
  const indent = row.depth ? '  '.repeat(row.depth) : ''
  const open = row.expandable && ctx.view.expanded === row.id
  const headPress = row.interactive
    ? () =>
        ctx.act(
          row.kind === 'event' || open
            ? { type: 'expand', id: row.id }
            : row.overflowPopup
              ? { type: 'popup', popup: { kind: 'item', id: row.id } }
              : { type: 'expand', id: row.id },
        )
    : undefined
  const prefix = [
    indent,
    row.fresh ? `${GLYPH.fresh.char} ` : '',
    sourceMark ? `${sourceMark} ` : '',
    g ? `${g.char} ` : '',
    row.marker ? `${row.marker} ` : '',
    open ? `${GLYPH.expanded.char} ` : '',
  ].join('')
  const layout = layoutRow({
    width: ctx.width,
    prefix,
    text: row.text,
    meta: row.meta,
    metaParts: row.metaParts,
    right: row.right,
    middle: row.kind === 'file' || (row.kind === 'activity' && /[\\/]/.test(row.text)),
  }, row.kind === 'event' && Boolean(row.metaParts?.length))
  const head = (
    <Box key={`head-${row.key}`} flexDirection="row" flexShrink={0}>
      {indent ? <Text dimColor>{indent}</Text> : null}
      {row.fresh ? (
        <Text color={GLYPH.fresh.color} bold>{`${GLYPH.fresh.char} `}</Text>
      ) : null}
      {sourceMark ? (
        <Text color={row.sourceMarkColor}>{`${sourceMark} `}</Text>
      ) : null}
      {g ? (
        <Text color={g.color} bold={row.bold || open}>{`${g.char} `}</Text>
      ) : null}
      {row.marker ? <Text color={row.marker === '!' ? C.decision : row.marker === '✦' ? C.goal : undefined} dimColor={row.marker === '·'} bold={row.marker !== '·'}>{`${row.marker} `}</Text> : null}
      {open ? <Text color={GLYPH.expanded.color}>{`${GLYPH.expanded.char} `}</Text> : null}
      <Box flexShrink={1} minWidth={0} overflow="hidden">
        {headPress ? (
          <Button
            key={row.key}
            plain
            dimColor={row.dim}
            label={layout.text}
            onPress={headPress}
          />
        ) : (
          <Text bold={row.bold} dimColor={row.dim} italic={row.italic} wrap="truncate-end">
            {layout.text}
          </Text>
        )}
      </Box>
      <Box flexGrow={1}>
        {layout.meta || layout.metaParts.length || layout.right ? <Text>{' '}</Text> : null}
      </Box>
      {inlineMeta(ctx, row, layout)}
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
      <Box key={row.key} flexDirection="column">
        {head}
        {actions(ctx, row.actions ?? [])}
      </Box>
    )
  if (row.kind === 'suggestion' || row.kind === 'recall') {
    const extra = [
      ...(row.actions ?? []),
      { key: `close-${row.key}`, label: '✕', action: { type: 'expand', id: row.id } as const },
    ]
    return (
      <Box key={row.key} flexDirection="column">
        {head}
        {open ? <Detail ctx={ctx} row={row} /> : null}
        {open ? expansionActions(ctx, row, extra) : null}
      </Box>
    )
  }
  if (row.kind === 'activity') return <Box key={row.key}>{head}</Box>
  if (row.kind === 'detour')
    return (
      <Box key={row.key} flexDirection="column">
        {head}
        {open ? <Detail ctx={ctx} row={row} /> : null}
        {open
          ? expansionActions(ctx, row, [
              ...(row.actions ?? []),
              { key: `close-${row.key}`, label: '✕', action: { type: 'expand', id: row.id } },
            ])
          : null}
      </Box>
    )
  if (row.kind === 'next')
    return (
      <Box key={row.key} flexDirection="column">
        {head}
        {open ? expansionActions(ctx, row, row.actions ?? []) : actions(ctx, row.actions ?? [])}
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
            label: 'Chat ⇒',
            action: { type: 'attach', ref: { kind: row.kind, id: row.id, text: row.fullText ?? row.text } },
          },
          { key: `close-${row.key}`, label: '✕', action: { type: 'expand', id: row.id } },
        ]
  return (
    <Box key={row.key} flexDirection="column">
      {head}
      {row.kind === 'event' ? <EventDetail ctx={ctx} row={row} /> : <Detail ctx={ctx} row={row} />}
      {row.suggestedGoals?.length
        ? suggestedGoalBlock(ctx, row, extra)
        : expansionActions(ctx, row, extra)}
    </Box>
  )
}

function suggestedGoalBlock(ctx: Ctx, row: ScreenRow, extra: ScreenAction[]): RenderElement {
  const { Box, Text } = ctx.el
  const inner = { ...ctx, width: Math.max(8, ctx.width - 6) }
  return (
    <Box key="suggested-goals" flexDirection="column" marginLeft={2}>
      {guideRow(ctx, 'suggested-goals-heading', <Text dimColor>Suggested goals:</Text>)}
      {(row.suggestedGoals ?? []).map(suggestion => (
        <Box key={`suggested-${suggestion.key}`} flexDirection="column">
          {guideRow(ctx, `suggested-guide-${suggestion.key}`, <Box marginLeft={2}>
            {renderRow(inner, { ...suggestion, actions: [] })}
          </Box>)}
          {guideRow(ctx, `suggested-actions-${suggestion.key}`, <Box marginLeft={2}>
            {actions(inner, suggestion.actions ?? [])}
          </Box>)}
          {guideRow(ctx, `suggested-spacer-guide-${suggestion.key}`,
            <Box key={`suggested-spacer-${suggestion.key}`} height={1} />)}
        </Box>
      ))}
      {guideRow(ctx, 'suggested-goals-use', <Box>{expansionActions(ctx, row, extra)}</Box>)}
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
  const { Box, Text } = ctx.el
  return (
    <Box key={key} flexDirection="row" flexShrink={0}>
      <Box width={2} flexShrink={0}><Text dimColor>│ </Text></Box>
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
          <Button key="expanded-up" plain dimColor={at === 0} label="▲" onPress={() => ctx.act({ type: 'expanded-scroll', by: -1 })} />
          <Text dimColor>{`${at + 1}/${geometry.total}`}</Text>
          <Button key="expanded-down" plain dimColor={at >= maxScroll} label="▼" onPress={() => ctx.act({ type: 'expanded-scroll', by: 1 })} />
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
            plain
            dimColor={at === 0}
            label="▲"
            onPress={() => ctx.act({ type: 'expanded-scroll', by: -1 })}
          />
          <Text dimColor>{` ${at + 1}/${geometry.total} `}</Text>
          <Button
            key={`help-down-${section.key}`}
            plain
            dimColor={at >= max}
            label="▼"
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
  const right = section.actions?.length ? (
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
    <Box flexDirection="column">
      {section.dim ? (
        <Text dimColor wrap="truncate-end">
          {OBSERVER_NOTE}
        </Text>
      ) : null}
      {rows}
      {showInput && section.input && Input ? (
        <Input
          key={section.input.key}
          label={section.input.label}
          placeholder={section.input.placeholder}
          submitLabel={section.input.submitLabel}
          value={section.input.value}
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

export const LEGEND: [GlyphKey | '!' | '·', string][] = [
  ['goal', 'your goal (confirmed)'],
  ['suggestion', 'suggestion, needs you'],
  ['currentTopic', 'current topic'],
  ['detour', 'detour / possible detour'],
  ['returned', 'returned'],
  ['observedDecision', 'decision, not settled'],
  ['settledDecision', 'settled decision'],
  ['!', 'major decision'],
  ['·', 'minor decision'],
  ['checkpoint', 'checkpoint / evidence'],
  ['openQuestion', 'open question'],
  ['ok', 'done'],
  ['fail', 'failed'],
  ['editedFile', 'file edited'],
  ['readFile', 'file read'],
  ['fresh', 'before an icon: just changed'],
  ['resolved', 'resolved question'],
  ['next', 'next step'],
  ['resume', 'resume earlier session'],
  ['handoff', 'hand-off running'],
  ['reportBack', 'report back'],
]
export function legendPanel(ctx: Ctx, height?: number, at = 0): RenderElement {
  const { Box, Text, Button } = ctx.el
  const columns = ctx.width >= 64 ? 2 : 1
  const width = Math.max(8, Math.floor((ctx.width - 4) / columns))
  const legendRows: [GlyphKey | '!' | '·', string][][] = []
  for (let index = 0; index < LEGEND.length; index += columns) legendRows.push(LEGEND.slice(index, index + columns))
  const content = (
    <Box key="legend-content" flexDirection="column" flexShrink={0}>
      <Box flexShrink={0}><Text bold>LEGEND</Text></Box>
      <Box flexShrink={0}><Text wrap="wrap">
        Marks: <Text color={SOURCE_MARK.person.color}>›</Text> you ·{' '}
        <Text color={SOURCE_MARK.claude.color}>✻</Text> Claude · <Text color={SOURCE_MARK.codex.color}>⌬</Text> Codex ·{' '}
        <Text color={SOURCE_MARK.other.color}>□</Text> other
      </Text></Box>
      <Box flexShrink={0}><Button key="legend-howto" plain
        label={`${ctx.view.legendHowTo ? '▾' : '▸'} How to use`}
        onPress={() => ctx.act({ type: 'legend-howto' })} /></Box>
      {ctx.view.legendHowTo ? <Box flexDirection="column" marginLeft={2} flexShrink={0}>
        <Box flexShrink={0}><Text dimColor wrap="wrap">1. Each row is one thing Atlas saw: an icon, a title, counts and age.</Text></Box>
        <Box flexShrink={0}><Text dimColor wrap="wrap">2. Press a row to open its details; press it again to close.</Text></Box>
        <Box flexShrink={0}><Text dimColor wrap="wrap">3. [Bracketed] buttons do something when pressed.</Text></Box>
        <Box flexShrink={0}><Text dimColor wrap="wrap">4. Nothing is confirmed until you press Confirm; observed items stay auto.</Text></Box>
        <Box flexDirection="row" gap={1} flexShrink={0}>
          <Text dimColor>Observer mode:</Text>
          {actions(
            ctx,
            [
              {
                key: 'observer-toggle',
                label: ctx.mode === 'claude' ? 'Observer: Claude' : 'Observer: Engine only',
                action: { type: 'toggle-observer' },
              },
            ],
            { marginLeft: 0, gap: 0 },
          )}
        </Box>
        <Box flexShrink={0}><Text wrap="wrap">
          counts: <Text color={C.write}>e</Text> edits <Text color={C.read}>r</Text> reads{' '}
          <Text color={C.path}>t</Text> topics <Text color={C.decision}>d</Text> decisions{' '}
          <Text color={C.question}>q</Text> questions <Text color={C.checkpoint}>h</Text> hand-offs{' '}
          <Text color={C.checkpoint}>b</Text> report-backs
        </Text></Box>
      </Box> : null}
      <Box flexShrink={0}><Text wrap="wrap">✦ suggested / goal detected</Text></Box>
      {legendRows.map((line, index) => (
        <Box key={`lg-${index}`} flexDirection="row" flexShrink={0}>
          {line.map(([name, meaning]) => {
            const g = name === '!' || name === '·' ? { char: name, color: name === '!' ? C.decision : undefined } : glyph(ctx, name)
            return (
              <Box key={`lg-${name}`} width={width} flexDirection="row" flexShrink={0}>
                <Text color={g.color} dimColor={name === '·'} bold={name !== '·'}>{`${g.char} `}</Text>
                <Text wrap="truncate-end">{meaning}</Text>
              </Box>
            )
          })}
        </Box>
      ))}
      <Box flexShrink={0}><Text dimColor wrap="wrap">{`pane: ${ctx.width + 2} columns`}</Text></Box>
    </Box>
  )
  const frame = (
    <Box
      key="legend-panel"
      flexDirection="column"
      borderStyle="round"
      borderColor={C.path}
      paddingX={1}
      flexShrink={0}
      height={height ?? rowsOf(content, Math.max(8, ctx.width - 4)) + 2}
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

function popupWidth(ctx: Ctx, popup?: ScreenPopup): number {
  const max = popup?.kind === 'trail-view' ? 64 : 52
  return Math.max(8, Math.min(max, ctx.width - 4))
}
function popupMaxHeight(ctx: Ctx, popup?: ScreenPopup): number {
  const available = Math.max(1, ctx.bodyViewport ?? ctx.rows)
  const max = popup?.kind === 'trail-view' ? 18 : 10
  const ratio = popup?.kind === 'trail-view' ? 0.6 : 0.4
  return Math.max(1, Math.min(max, available, Math.floor(available * ratio)))
}
function popupContext(ctx: Ctx, popup?: ScreenPopup): Ctx {
  return { ...ctx, width: Math.max(8, popupWidth(ctx, popup) - 4), inPopup: true }
}
function popupGeometry(ctx: Ctx, items: RenderElement[], popup?: ScreenPopup) {
  const trailSettings = popup?.kind === 'trail-view'
  const itemRows = items.flatMap((item, index) => [
    ...(trailSettings && index > 0 && popup?.rows[index]?.checkbox === undefined ? [1] : []),
    Math.max(1, rowsOf(item, popupContext(ctx, popup).width)),
  ])
  const total = itemRows.reduce((sum, value) => sum + value, 0)
  const maxHeight = popupMaxHeight(ctx, popup)
  const base = trailSettings ? 5 : 4
  const fitHeight = Math.max(5, total + base)
  const height = Math.min(maxHeight, fitHeight)
  const bodyRows = Math.max(1, height - base - (trailSettings && total + base > maxHeight ? 1 : 0))
  return { height, bodyRows, maxScroll: Math.max(0, total - bodyRows), itemRows, total }
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
export function popupShell(ctx: Ctx, popup: ScreenPopup, placement: { top?: number; bottom?: number; left?: number }): RenderElement {
  const { Box, Button, Text } = ctx.el
  const pctx = popupContext(ctx, popup)
  const items = popup.rows.map(row => renderRow(pctx, row))
  const geometry = popupGeometry(ctx, items, popup)
  const at = Math.min(Math.max(0, ctx.view.popupScroll), geometry.maxScroll)
  const { left: requestedLeft = 0, ...placementProps } = placement
  const left = Math.max(0, Math.min(requestedLeft, ctx.width - popupWidth(ctx, popup)))
  const trailSettings = popup.kind === 'trail-view'
  const visibleItems = trailSettings
    ? items.flatMap((item, index) => index > 0 && popup.rows[index]?.checkbox === undefined
      ? [<Box key={`trail-settings-gap-${index}`} height={1} overflow="hidden" flexShrink={0}><Text>{''}</Text></Box>, item]
      : [item])
    : items
  const window = rowWindow(visibleItems, geometry.itemRows, at, geometry.bodyRows)
  const position = popup.rows.length ? Math.min(popup.rows.length, window.start + 1) : 0
  const scrollControls = geometry.maxScroll > 0
  const closeAction = {
    key: 'popup-close',
    label: popup.closeGlyph ? '✕' : 'Close',
    role: 'dismiss' as const,
    action: { type: 'popup' as const, popup: { kind: popup.kind, ...(popup.id ? { id: popup.id } : {}) } },
  }
  const header = (
    <Box
      flexDirection="row"
      justifyContent={trailSettings ? 'flex-start' : 'space-between'}
      flexShrink={0}
      backgroundColor={POPUP_BG}
    >
      <Box flexDirection="row" gap={1}>
        <Text bold>{popup.title}</Text>
        {popup.titleCount ? <Text dimColor>{popup.titleCount}</Text> : null}
      </Box>
      {trailSettings && popup.page ? (
        <Box flexDirection="row" gap={1}>
          <Button
            key="settings-page-prev"
            plain
            dimColor={popup.page.current <= 0}
            label="‹"
            onPress={() => ctx.act({ type: 'trail-settings-page', page: popup.page!.current - 1 })}
          />
          <Text dimColor>{`${popup.page.current + 1}/${popup.page.total}`}</Text>
          <Button
            key="settings-page-next"
            plain
            dimColor={popup.page.current >= popup.page.total - 1}
            label="›"
            onPress={() => ctx.act({ type: 'trail-settings-page', page: popup.page!.current + 1 })}
          />
        </Box>
      ) : null}
      {!trailSettings && popup.page ? (
        <Box flexDirection="row" gap={1}>
          <Button
            key="settings-page-prev"
            plain
            dimColor={popup.page.current <= 0}
            label="‹"
            onPress={() => ctx.act({ type: 'trail-settings-page', page: popup.page!.current - 1 })}
          />
          <Text dimColor>{`${popup.page.current + 1}/${popup.page.total}`}</Text>
          <Button
            key="settings-page-next"
            plain
            dimColor={popup.page.current >= popup.page.total - 1}
            label="›"
            onPress={() => ctx.act({ type: 'trail-settings-page', page: popup.page!.current + 1 })}
          />
        </Box>
      ) : null}
      {trailSettings ? <Box flexGrow={1} /> : null}
      {trailSettings ? (
        <Button key={closeAction.key} plain label={closeAction.label} onPress={() => ctx.act(closeAction.action)} />
      ) : actions(ctx, [closeAction], { marginLeft: 0, gap: 0, flexWrap: 'nowrap' })}
    </Box>
  )
  const pager = !trailSettings && popup.page ? (
    <Box flexDirection="row" gap={1} flexShrink={0} backgroundColor={POPUP_BG}>
      <Button
        key="settings-page-prev"
        plain
        dimColor={popup.page.current <= 0}
        label="‹"
        onPress={() => ctx.act({ type: 'trail-settings-page', page: popup.page!.current - 1 })}
      />
      <Text dimColor>{`${popup.page.current + 1}/${popup.page.total}`}</Text>
      <Button
        key="settings-page-next"
        plain
        dimColor={popup.page.current >= popup.page.total - 1}
        label="›"
        onPress={() => ctx.act({ type: 'trail-settings-page', page: popup.page!.current + 1 })}
      />
      <Text dimColor>{popup.page.name}</Text>
    </Box>
  ) : null
  const popupChildren: RenderElement[] = [header]
  if (trailSettings && popup.page) {
    popupChildren.push(
      <Text key="trail-settings-page-name" bold>{`» ${popup.page.name}`}</Text>,
      <Box key="trail-settings-header-gap" height={1} overflow="hidden" flexShrink={0}>
        <Text>{''}</Text>
      </Box>,
    )
  }
  popupChildren.push(ScrollBox(ctx, [
    <Box key="popup-window" flexDirection="column" marginTop={-window.offset} flexShrink={0}>
      {window.items}
    </Box>,
  ], { height: geometry.bodyRows, backgroundColor: POPUP_BG }))
  if (scrollControls || !trailSettings) {
    popupChildren.push(
      <Box
        key="popup-footer"
        flexDirection="row"
        justifyContent="space-between"
        flexShrink={0}
        backgroundColor={POPUP_BG}
      >
        {popup.footerActions?.length ? actions(ctx, popup.footerActions, { marginLeft: 0 }) : <Text dimColor>{popup.footer ?? ''}</Text>}
        {scrollControls ? <Box flexDirection="row" gap={1}>
          <Button key="popup-up" plain dimColor={at === 0} label="▲" onPress={() => ctx.act({ type: 'popup-scroll', by: -1 })} />
          <Text dimColor>{`${position}/${popup.rows.length}`}</Text>
          <Button
            key="popup-down"
            plain
            dimColor={at >= geometry.maxScroll}
            label="▼"
            onPress={() => ctx.act({ type: 'popup-scroll', by: 1 })}
          />
        </Box> : null}
      </Box>,
    )
  }
  return Popup(
    ctx,
    popupChildren,
    { width: popupWidth(ctx, popup), height: geometry.height, backgroundColor: POPUP_BG, borderColor: C.path, left, ...placementProps },
  )
}

function popupPlacement(ctx: Ctx, popup: ScreenPopup, rowTop: number): { top: number; left: number } {
  const items = popup.rows.map(row => renderRow(popupContext(ctx, popup), row))
  const height = popupGeometry(ctx, items, popup).height
  const bodyRows = Math.max(1, ctx.bodyViewport ?? ctx.rows)
  const below = rowTop + 1
  const top = below + height <= bodyRows ? below : Math.max(0, rowTop - height - 1)
  return { top: Math.max(0, Math.min(top, Math.max(0, bodyRows - height))), left: 2 }
}

function itemPopup(row: ScreenRow): ScreenPopup {
  return {
    kind: 'item',
    id: row.id,
    title: row.kind === 'item' ? 'ITEM' : row.kind.toUpperCase(),
    rows: [
      { id: `${row.id}-summary`, key: `${row.key}-summary`, kind: 'text', text: row.text, bold: true },
      ...(row.detail ?? []).map((text, index) => ({
        id: `${row.id}-detail-${index}`,
        key: `${row.key}-detail-${index}`,
        kind: 'text' as const,
        text,
        dim: true,
      })),
    ],
    footerActions: [
      {
        key: `add-${row.key}`,
        label: 'Chat ⇒',
        action: { type: 'attach', ref: { kind: row.kind, id: row.id, text: row.text } },
      },
      { key: `close-${row.key}`, label: 'Close', action: { type: 'popup', popup: { kind: 'item', id: row.id } } },
    ],
  }
}
function activePopup(ctx: Ctx, model: ScreenModel): ScreenPopup | undefined {
  if (ctx.view.popup?.kind === 'trail-view') return trailViewPopup(ctx.view.trailView, ctx.view.trailNewest, ctx.view.hidden ?? [], ctx.view.settingsPage ?? 0)
  if (ctx.view.popup?.kind === 'item') {
    const row = model.sections.flatMap(section => section.rows).find(candidate => candidate.id === ctx.view.popup?.id)
    return row ? itemPopup(row) : undefined
  }
  return undefined
}
function renderBody(ctx: Ctx, model: ScreenModel): RenderElement {
  const { Box } = ctx.el
  let sectionTop = 0
  return (
    <Box flexDirection="column" position="relative">
      {model.sections.map(section => {
        const selectedIndex = section.rows.findIndex(row => row.overflowPopup && ctx.view.popup?.kind === 'item' && ctx.view.popup.id === row.id)
        const sectionTree = renderSection(ctx, section)
        const prefix = selectedIndex >= 0
          ? renderSection(ctx, { ...section, rows: section.rows.slice(0, selectedIndex), empty: undefined, input: undefined })
          : null
        const sectionPopup = section.key === 'events' && ctx.view.popup?.kind === 'trail-view'
        const popup = selectedIndex >= 0 || sectionPopup ? activePopup(ctx, model) : undefined
        const rowTop = sectionPopup ? sectionTop : sectionTop + (prefix ? rowsOf(prefix, ctx.width) : 0)
        sectionTop += rowsOf(sectionTree, ctx.width)
        const placement = popup ? popupPlacement(ctx, popup, rowTop) : undefined
        return (
          <Box key={`screen-${section.key}`} flexDirection="column">
            {sectionTree}
            {popup && placement ? popupShell(ctx, popup, placement) : null}
          </Box>
        )
      })}
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
  const { Box, Button } = ctx.el
  const width = Math.max(1, ctx.width - (scroll.max > 0 ? 5 : 0))
  return (
    <Box flexDirection="row" gap={1} flexShrink={0} overflow="hidden">
      {Tabs({ el: ctx.el, width }, tabItems(ctx, snapshot))}
      {scroll.max > 0 ? (
        <Box flexDirection="row" gap={1} flexShrink={0}>
          <Button
            key="scroll-up"
            plain
            dimColor={scroll.at === 0}
            label="▲"
            onPress={() => ctx.act({ type: 'scroll', by: -scroll.page })}
          />
          <Button
            key="scroll-down"
            plain
            dimColor={scroll.at >= scroll.max}
            label="▼"
            onPress={() => ctx.act({ type: 'scroll', by: scroll.page })}
          />
        </Box>
      ) : null}
    </Box>
  )
}
function tabBarRows(ctx: Ctx, snapshot: AtlasSnapshot, max: number): number {
  return (
    collapseBarLabels(tabItems(ctx, snapshot), Math.max(1, ctx.width - (max > 0 ? 5 : 0)), 1, 'tabs').grid.rows.length +
    (ctx.view.legend ? 1 : 0)
  )
}
function appBarItems(ctx: Ctx, snapshot: AtlasSnapshot): BarItem[] {
  return [
    { key: 'legend', label: 'Legend', short: 'Legend', compact: '≡', hotkey: 'l', onPress: () => ctx.act({ type: 'legend' }) },
    { key: 'mark', label: '+ Mark', short: '+ Mark', compact: '+', hotkey: 'k', onPress: () => ctx.act({ type: 'mark' }) },
  ]
}
function appBar(ctx: Ctx, snapshot: AtlasSnapshot): RenderElement {
  const { Box } = ctx.el
  const items = appBarItems(ctx, snapshot)
  return (
    <Box key="app-bar" position="relative" flexDirection="column" flexShrink={0}>
      {Bar({ el: ctx.el, width: ctx.width }, items.map(item => ({ ...item, active: item.key === 'legend' ? ctx.view.legend : false })))}
    </Box>
  )
}
function appBarRows(ctx: Ctx, snapshot: AtlasSnapshot): number {
  return collapseBarLabels(appBarItems(ctx, snapshot), ctx.width, 1, 'bar').grid.rows.length
}
function scrollbarCells(ctx: Ctx, viewport: number, content: number, at: number, maxScroll: number): RenderElement {
  const { Box, Button } = ctx.el
  const size = Math.min(viewport, Math.max(1, Math.round((viewport * viewport) / content)))
  const top = maxScroll ? Math.round((at / maxScroll) * (viewport - size)) : 0
  return (
    <Box flexDirection="column" width={1} flexShrink={0} height={viewport} overflow="hidden">
      {Array.from({ length: viewport }, (_, index) => (
        <Button
          key={`sb-${index}`}
          plain
          dimColor={!(index >= top && index < top + size)}
          label={index >= top && index < top + size ? '┃' : '│'}
          onPress={() => ctx.act({ type: 'scroll-to', at: Math.round((index / Math.max(1, viewport - 1)) * maxScroll) })}
        />
      ))}
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
  const { Box } = ctx.el
  if (ctx.view.setup)
    return {
      tree: (
        <Box flexDirection="column" paddingX={1}>
          {titleRule({ el: ctx.el, width: ctx.width }, ctx.width, C.goal)}
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
  const fixedWithoutLegend = 1 + tabBarRows(ctx, snapshot, 1) + 1 + scanRows + appRows
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
  const popup = activePopup(ctx, model)
  const popupItems = popup ? popup.rows.map(row => renderRow(popupContext(drawCtx, popup), row)) : []
  const maxPopupScroll = popup ? popupGeometry(drawCtx, popupItems, popup).maxScroll : 0
  const bodyTree = pinned ? (
    <Box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden" position="relative">
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="visible">
        <Box flexDirection="column" flexShrink={0} marginTop={-at}>
          {body}
        </Box>
      </Box>
      {scrollbar}
    </Box>
  ) : (
    <Box flexDirection="column" position="relative">
      {body}
    </Box>
  )
  const tree = (
    <Box flexDirection="column" paddingX={1} {...(pinned ? { height: ctx.rows } : {})}>
      {titleRule({ el: ctx.el, width: ctx.width }, ctx.width, C.goal)}
      {tabBar(ctx, snapshot, { at, max: maxScroll, page: Math.max(1, viewport - 2) })}
      {bodyTree}
      {rule({ el: ctx.el, width: ctx.width })}
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
    <Box key={section.key} flexDirection="column" marginTop={1}>
      <Box flexDirection="row" flexShrink={0}>
        <Text bold color={section.color} dimColor={section.dim} wrap="truncate-end">
          {section.heading}
        </Text>
        {section.headingPress ? <Text> </Text> : null}
        {section.headingPress ? (
          <Button
            key={`${section.key}-heading`}
            plain
            dimColor={section.dim}
            label="ⓘ"
            onPress={section.headingPress}
          />
        ) : null}
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
      {section.expansion}
      {children}
    </Box>
  )
}

function ScrollBox(
  ctx: UiContext,
  children: RenderElement[],
  options: { height: number; backgroundColor?: string },
): RenderElement {
  const { Box } = ctx.el
  return (
    <Box key="popup-body" flexDirection="column" height={options.height} overflow="hidden" backgroundColor={options.backgroundColor}>
      {children.map((child, i) => (
        <Box key={`popup-row-${i}`} backgroundColor={options.backgroundColor} flexShrink={0}>{child}</Box>
      ))}
    </Box>
  )
}

function Popup(
  ctx: UiContext,
  children: RenderElement[],
  options: { width: number; height: number; backgroundColor: string; borderColor?: string; top?: number; left?: number; bottom?: number },
): RenderElement {
  const { Box } = ctx.el
  // The shell and each flow region carry the fill. This is intentional: an
  // absolute panel must paint every cell, including gaps beside short rows.
  return (
      <Box
        key="atlas-popup"
        position="absolute"
        top={options.top}
        left={options.left}
        bottom={options.bottom}
        width={options.width}
        height={options.height}
        overflow="hidden"
        borderStyle="round"
        borderColor={options.borderColor}
        backgroundColor={options.backgroundColor}
        paddingX={1}
        flexDirection="column"
      >
      {children.map((child, i) => (
        <Box key={`popup-fill-${i}`} backgroundColor={options.backgroundColor} flexShrink={0}>{child}</Box>
      ))}
    </Box>
  )
}


const surfaceGlyphs: GlyphSet = {
  goal: '◎', suggestion: '○', currentTopic: '●', detour: '↳', returned: '↩',
  observedDecision: '◇', settledDecision: '◆', checkpoint: '⚑', openQuestion: '?', resolved: '✓',
  ok: '✓', fail: '✗', editedFile: '✎', readFile: '·', fresh: '✦', expanded: '▾', prompt: '›',
  next: '▸', resume: '◎', handoff: '→', reportBack: '←',
}

function tuiMeasuredBarItem(item: BarItem, label: string, kind: BarKind, hotkeys = true): number {
  const activeTab = kind === 'tabs' && item.active
  return measuredBarItemWidth({
    label,
    hotkey: hotkeys && !activeTab ? item.hotkey : undefined,
    icon: kind === 'bar' ? item.icon : undefined,
    activeMarker: activeTab ? '▸' : undefined,
    prefixGap: kind === 'bar' && item.icon ? 1 : 0,
  })
}

export function tuiCollapseBarLabels(items: BarItem[], width: number, gap = 1, kind: BarKind = 'bar') {
  return collapseBarLabelsWith(items, width, ['full', 'short'], tuiMeasuredBarItem, gap, kind)
}
function collapseBarLabels(items: BarItem[], width: number, gap = 1, kind: BarKind = 'bar') {
  return tuiCollapseBarLabels(items, width, gap, kind)
}

function Tabs(ctx: UiContext, items: BarItem[], gap = 1): RenderElement {
  const { Box, Button, Text } = ctx.el
  const choice = tuiCollapseBarLabels(items, ctx.width, gap, 'tabs')
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
                  : <Button
                      key={item?.key ?? String(index)}
                      plain
                      hotkey={choice.tier === 'compact' ? undefined : item?.hotkey}
                      label={label}
                      onPress={() => item?.onPress()}
                    />}
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

function Bar(ctx: UiContext, items: BarItem[], gap = 1): RenderElement {
  const { Box, Button, Text } = ctx.el
  const choice = tuiCollapseBarLabels(items, ctx.width, gap, 'bar')
  return (
    <Box key="bottom-bar" flexDirection="column" gap={0} overflow="hidden" flexShrink={0}>
      {choice.grid.rows.map((row, rowIndex) => (
        <Box key={`bar-row-${rowIndex}`} flexDirection="row" gap={gap} flexShrink={0} overflow="hidden">
          {row.items.map(index => {
            const item = items[index]
            const label = choice.labels[index] ?? ''
            return (
              <Box key={`bar-cell-${item?.key ?? index}`} width={choice.grid.columnWidths[index % choice.grid.columns]} flexShrink={0} overflow="hidden">
                <Box flexDirection="row" gap={1} flexShrink={0} overflow="hidden">
                  {item?.icon ? <Text dimColor={!item.active} wrap="truncate-end">{item.icon}</Text> : null}
                  <Button
                    key={item?.key === 'mark' ? 'mark' : `bar-${item?.key ?? index}`}
                    plain
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

function ActionGroup(
  ctx: UiContext,
  items: ActionItem[],
  options: ActionGroupOptions = {},
): RenderElement {
  const { Box, Text, Button } = ctx.el
  const marginLeft = options.marginLeft ?? 2
  const gap = options.gap ?? 1
  const flexWrap = options.flexWrap ?? 'wrap'
  return (
    <Box flexDirection="row" gap={gap} marginLeft={marginLeft} flexWrap={flexWrap}>
      {items.map(item => item.primary
        ? <Button
            key={item.key}
            label={item.label}
            variant="primary"
            {...(item.role ? { role: item.role } : {})}
            onPress={() => item.onPress()}
          />
        : <Box key={`action-${item.key}`} flexDirection="row">
            <Text color="#7dcfff">[</Text>
            <Button key={item.key} plain label={item.label} hover={{ color: '#7dcfff' }}
              {...(item.role ? { role: item.role } : {})} onPress={() => item.onPress()} />
            <Text color="#7dcfff">]</Text>
          </Box>)}
    </Box>
  )
}

function rule(ctx: UiContext): RenderElement {
  const { Text } = ctx.el
  return <Text dimColor>{'─'.repeat(Math.max(1, ctx.width))}</Text>
}

function titleRule(ctx: UiContext, width: number, color: string): RenderElement {
  const { Box, Text } = ctx.el
  const name = width >= 34 ? ' Conversation Atlas ' : ' Atlas '
  const left = Math.max(1, Math.floor((width - name.length) / 2))
  return (
    <Box flexDirection="row" flexShrink={0} height={1}>
      <Text dimColor>{'─'.repeat(left)}</Text>
      <Text bold color={color}>{name}</Text>
      <Text dimColor>{'─'.repeat(Math.max(1, width - name.length - left))}</Text>
    </Box>
  )
}

