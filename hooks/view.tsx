// The pane shell and surface renderers. Tab content is pure data from
// hooks/screens; this module decides only how that data is laid out.

import type { Elements, RenderElement } from 'claude-code'
import type { AtlasMode, AtlasScanState, AtlasSnapshot, AtlasTab, AtlasView } from '../types'
import type { LiveRow } from './live'
import { openQuestions } from './model'
import {
  ActionGroup,
  Bar,
  collapseBarLabels,
  glyphsFor,
  isGui,
  Popup as UiPopup,
  ScrollBox,
  Section,
  type BarItem,
  type Surface,
  Tabs,
  rule as uiRule,
} from './ui'
import { buildEvidence } from './screens/evidence'
import { buildMap } from './screens/map'
import { buildOpen } from './screens/open'
import { buildTrail } from './screens/trail'
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
  surface: Surface
  width: number
  rows: number
  bodyViewport?: number
  now: number
  mode: AtlasMode
  setupDefault: AtlasMode
  scan: AtlasScanState
  view: AtlasView
  live: (
    key: string,
    rows: LiveRow[],
    scan?: { active: boolean; startedAt: number; result: string | null; resultAt: number; now: number },
  ) => RenderElement
  act: (action: Action) => void
}

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
        return Math.max(0, ...children.map(child => rowsOf(child, inner))) + extra
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
  return { ...GLYPH[name], char: glyphsFor(ctx.surface)[name] }
}
function actions(
  ctx: Ctx,
  items: ScreenAction[],
  options: { marginLeft?: number; gap?: number; flexWrap?: 'wrap' | 'nowrap' } = {},
): RenderElement | null {
  if (!items.length) return null
  return ActionGroup(
    { el: ctx.el, surface: ctx.surface, width: ctx.width },
    items.map(item => ({ key: item.key, label: item.label, primary: item.primary, role: item.role, onPress: () => ctx.act(item.action) })),
    options,
  )
}

function inlineMeta(ctx: Ctx, row: ScreenRow): RenderElement | null {
  const { Box, Text } = ctx.el
  const compact = ctx.width < 60
  if (row.metaParts?.length) {
    return (
      <Box flexDirection="row" gap={1} flexShrink={0}>
        {row.metaParts.map((part, index) => (
          <Text key={`meta-${row.key}-${index}`} color={part.tone ? toneColor(part.tone) : undefined} dimColor={part.dim}>
            {compact ? part.compact ?? part.text : part.text}
          </Text>
        ))}
        {row.right ? <Text dimColor>{row.right}</Text> : null}
      </Box>
    )
  }
  if (!row.meta && !row.right) return null
  return (
    <Box flexDirection="row" gap={1} flexShrink={0}>
      {row.meta ? <Text dimColor wrap="truncate-end">{row.meta}</Text> : null}
      {row.meta && row.right ? <Text dimColor>·</Text> : null}
      {row.right ? <Text dimColor wrap="truncate-end">{row.right}</Text> : null}
    </Box>
  )
}

function renderRow(ctx: Ctx, row: ScreenRow): RenderElement {
  const { Box, Text, Button } = ctx.el
  const g = row.glyph ? glyph(ctx, row.glyph) : undefined
  const indent = row.depth ? '  '.repeat(row.depth) : ''
  const open = row.expandable && ctx.view.expanded === row.id
  const headPress = row.interactive
    ? () =>
        ctx.act(
          row.kind === 'event'
            ? (row.actions?.[0]?.action ?? { type: 'expand', id: row.id })
            : row.overflowPopup
              ? { type: 'popup', popup: { kind: 'item', id: row.id } }
              : { type: 'expand', id: row.id },
        )
    : undefined
  const head = (
    <Box key={`head-${row.key}`} flexDirection="row" flexShrink={0}>
      {indent ? <Text dimColor>{indent}</Text> : null}
      {row.fresh ? (
        <Text color={GLYPH.fresh.color} bold>{`${GLYPH.fresh.char} `}</Text>
      ) : null}
      {g ? (
        <Text color={g.color} dimColor={row.dim} bold={row.bold || open}>{`${g.char} `}</Text>
      ) : null}
      {open ? <Text color={GLYPH.expanded.color}>{`${GLYPH.expanded.char} `}</Text> : null}
      <Box flexShrink={1} minWidth={0} overflow="hidden">
        {headPress ? (
          <Button
            key={row.key}
            plain
            dimColor={row.dim}
            label={row.text}
            onPress={headPress}
          />
        ) : (
          <Text bold={row.bold} dimColor={row.dim} italic={row.italic} wrap="truncate-end">
            {row.text}
          </Text>
        )}
      </Box>
      <Box flexGrow={1} />
      {inlineMeta(ctx, row)}
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
  if (row.kind === 'activity') return <Box key={row.key}>{head}</Box>
  if (row.kind === 'next' || row.kind === 'detour')
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
            action: { type: 'attach', ref: { kind: row.kind, id: row.id, text: row.text } },
            primary: true,
          },
          { key: `close-${row.key}`, label: 'Close', action: { type: 'expand', id: row.id } },
        ]
  return (
    <Box key={row.key} flexDirection="column">
      {head}
      <Detail ctx={ctx} row={row} />
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

function Detail({ ctx, row }: { ctx: Ctx; row: ScreenRow }): RenderElement {
  const { Box, Text } = ctx.el
  return (
    <Box flexDirection="column" marginLeft={2}>
      {(row.detail?.length ? row.detail : ['No additional details recorded.']).map((line, index) => (
        <Text key={`detail-${row.key}-${index}`} dimColor wrap="wrap">{`│ ${line}`}</Text>
      ))}
    </Box>
  )
}

function sectionExpansionId(section: ScreenSection): string {
  return `section:${section.key}`
}

function visibleHelpRows(ctx: Ctx, helpLength: number): number {
  const room = ctx.bodyViewport ?? ctx.rows
  const target = room >= 12 ? 5 : 3
  return Math.min(helpLength, target)
}

function sectionHelp(ctx: Ctx, section: ScreenSection): RenderElement | null {
  if (ctx.view.expanded !== sectionExpansionId(section)) return null
  const { Box, Button, Text } = ctx.el
  const visible = visibleHelpRows(ctx, section.help.length)
  const max = Math.max(0, section.help.length - visible)
  const at = Math.min(Math.max(0, ctx.view.expandedScroll), max)
  const lines = section.help.slice(at, at + visible)
  return (
    <Box key={`help-${section.key}`} flexDirection="column" marginLeft={2}>
      {lines.map((line, index) => (
        <Text key={`help-line-${section.key}-${index}`} dimColor wrap="truncate-end">{`│ ${line}`}</Text>
      ))}
      {max > 0 ? (
        <Box flexDirection="row">
          <Text dimColor>│ </Text>
          <Button
            key={`help-up-${section.key}`}
            plain
            dimColor={at === 0}
            label="▲"
            onPress={() => ctx.act({ type: 'expanded-scroll', by: -1 })}
          />
          <Text dimColor>{` ${at + 1}/${section.help.length} `}</Text>
          <Button
            key={`help-down-${section.key}`}
            plain
            dimColor={at >= max}
            label="▼"
            onPress={() => ctx.act({ type: 'expanded-scroll', by: 1 })}
          />
        </Box>
      ) : null}
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
    { el: ctx.el, surface: ctx.surface, width: ctx.width },
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

const LEGEND: [GlyphKey, string][] = [
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
  ['handoff', 'hand-off running'],
  ['reportBack', 'report back'],
]
function legendPanel(ctx: Ctx, height?: number, at = 0): RenderElement {
  const { Box, Text } = ctx.el
  const columns = ctx.width >= 64 ? 2 : 1
  const width = Math.max(8, Math.floor(ctx.width / columns) - 1)
  const legendRows: [GlyphKey, string][][] = []
  for (let index = 0; index < LEGEND.length; index += columns) legendRows.push(LEGEND.slice(index, index + columns))
  const content = (
    <Box flexDirection="column">
      <Text bold>HOW TO USE</Text>
      <Text dimColor wrap="wrap">
        Plain rows expand structured details inline. Secondary controls are bracketed on terminal and native on desktop.
      </Text>
      <Text dimColor wrap="wrap">
        Topics from the start of the work to now stay observed; press an action to confirm intent.
      </Text>
      <Box flexDirection="row" gap={1}>
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
      <Text bold>LEGEND</Text>
      {legendRows.map((line, index) => (
        <Box key={`lg-${index}`} flexDirection="row">
          {line.map(([name, meaning]) => {
            const g = glyph(ctx, name)
            return (
              <Box key={`lg-${name}`} width={width} flexDirection="row">
                <Text color={g.color} bold>{`${g.char} `}</Text>
                <Text wrap="truncate-end">{meaning}</Text>
              </Box>
            )
          })}
        </Box>
      ))}
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
      {...(height === undefined ? {} : { height, overflow: 'hidden' as const })}
    >
      {height === undefined ? content : <Box flexDirection="column" marginTop={-at}>{content}</Box>}
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

function popupWidth(ctx: Ctx): number {
  return Math.max(8, Math.min(52, ctx.width - 4))
}
function popupMaxHeight(ctx: Ctx): number {
  const available = Math.max(1, ctx.bodyViewport ?? ctx.rows)
  return Math.max(1, Math.min(10, available, Math.floor(available * 0.4)))
}
function popupContext(ctx: Ctx): Ctx {
  return { ...ctx, width: Math.max(8, popupWidth(ctx) - 4) }
}
function popupGeometry(ctx: Ctx, items: RenderElement[]) {
  const itemRows = items.map(item => Math.max(1, rowsOf(item, popupContext(ctx).width)))
  const total = itemRows.reduce((sum, value) => sum + value, 0)
  const height = Math.min(popupMaxHeight(ctx), Math.max(5, total + 4))
  const bodyRows = Math.max(1, height - 4)
  return { height, bodyRows, maxScroll: Math.max(0, total - bodyRows), itemRows }
}
function popupWindow(items: RenderElement[], itemRows: number[], at: number, bodyRows: number): RenderElement[] {
  let start = 0
  let skipped = 0
  while (start < items.length && skipped + (itemRows[start] ?? 1) <= at) {
    skipped += itemRows[start] ?? 1
    start++
  }
  let end = start
  let used = 0
  while (end < items.length && (used === 0 || used + (itemRows[end] ?? 1) <= bodyRows)) {
    used += itemRows[end] ?? 1
    end++
  }
  return items.slice(start, Math.max(start + (items.length ? 1 : 0), end))
}
function popupShell(ctx: Ctx, popup: ScreenPopup, placement: { top?: number; bottom?: number; left?: number }): RenderElement {
  const { Box, Button, Text } = ctx.el
  const pctx = popupContext(ctx)
  const items = popup.rows.map(row => renderRow(pctx, row))
  const geometry = popupGeometry(ctx, items)
  const at = Math.min(Math.max(0, ctx.view.popupScroll), geometry.maxScroll)
  const visible = popupWindow(items, geometry.itemRows, at, geometry.bodyRows)
  const position = popup.rows.length
    ? Math.min(popup.rows.length, Math.max(1, Math.round((at / Math.max(1, geometry.maxScroll)) * popup.rows.length) + 1))
    : 0
  const { left: requestedLeft = 0, ...placementProps } = placement
  const left = Math.max(0, Math.min(requestedLeft, ctx.width - popupWidth(ctx)))
  return UiPopup(
    ctx,
    [
      <Box flexDirection="row" justifyContent="space-between" flexShrink={0} backgroundColor={POPUP_BG}>
        <Box flexDirection="row" gap={1}>
          <Text bold>{popup.title}</Text>
          {popup.titleCount ? <Text dimColor>{popup.titleCount}</Text> : null}
        </Box>
        {actions(
          ctx,
          [
            {
              key: 'popup-close',
              label: 'Close',
              role: 'dismiss',
              action: { type: 'popup', popup: { kind: popup.kind, ...(popup.id ? { id: popup.id } : {}) } },
            },
          ],
          { marginLeft: 0, gap: 0, flexWrap: 'nowrap' },
        )}
      </Box>,
      ScrollBox(ctx, visible, { height: geometry.bodyRows, backgroundColor: POPUP_BG }),
      <Box flexDirection="row" justifyContent="space-between" flexShrink={0} backgroundColor={POPUP_BG}>
        {popup.footerActions?.length ? actions(ctx, popup.footerActions, { marginLeft: 0 }) : <Text dimColor>{popup.footer ?? ''}</Text>}
        <Box flexDirection="row" gap={1}>
          <Button key="popup-up" plain dimColor={at === 0} label="▲" onPress={() => ctx.act({ type: 'popup-scroll', by: -1 })} />
          <Text dimColor>{`${position}/${popup.rows.length}`}</Text>
          <Button
            key="popup-down"
            plain
            dimColor={at >= geometry.maxScroll}
            label="▼"
            onPress={() => ctx.act({ type: 'popup-scroll', by: 1 })}
          />
        </Box>
      </Box>,
    ],
    { width: popupWidth(ctx), height: geometry.height, backgroundColor: POPUP_BG, borderColor: C.path, left, ...placementProps },
  )
}

function popupPlacement(ctx: Ctx, popup: ScreenPopup, rowTop: number): { top: number; left: number } {
  const items = popup.rows.map(row => renderRow(popupContext(ctx), row))
  const height = popupGeometry(ctx, items).height
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
        label: 'Add to message',
        action: { type: 'attach', ref: { kind: row.kind, id: row.id, text: row.text } },
        primary: true,
      },
      { key: `close-${row.key}`, label: 'Close', action: { type: 'popup', popup: { kind: 'item', id: row.id } } },
    ],
  }
}
function activePopup(ctx: Ctx, model: ScreenModel): ScreenPopup | undefined {
  if (ctx.view.popup?.kind === 'item') {
    const row = model.sections.flatMap(section => section.rows).find(candidate => candidate.id === ctx.view.popup?.id)
    return row ? itemPopup(row) : undefined
  }
  return model.popups.find(popup => popup.kind === ctx.view.popup?.kind && (popup.kind !== 'event' || popup.id === ctx.view.popup?.id))
}
function renderBody(ctx: Ctx, model: ScreenModel): RenderElement {
  const { Box } = ctx.el
  let sectionTop = 0
  return (
    <Box flexDirection="column" position="relative">
      {model.sections.map(section => {
        const selectedIndex = section.rows.findIndex(
          row =>
            (row.kind === 'event' || row.overflowPopup) &&
            ctx.view.popup?.id === row.id &&
            (ctx.view.popup.kind === 'event' || ctx.view.popup.kind === 'item'),
        )
        const sectionTree = renderSection(ctx, section)
        const prefix = selectedIndex >= 0
          ? renderSection(ctx, { ...section, rows: section.rows.slice(0, selectedIndex), empty: undefined, input: undefined })
          : null
        const popup = selectedIndex >= 0 ? activePopup(ctx, model) : undefined
        const rowTop = sectionTop + (prefix ? rowsOf(prefix, ctx.width) : 0)
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

function titleRule(ctx: Ctx): RenderElement {
  const { Box, Text } = ctx.el
  const name = ctx.width >= 34 ? ' Conversation Atlas ' : ' Atlas '
  if (isGui(ctx.surface))
    return (
      <Box flexDirection="row" flexShrink={0} height={1} alignItems="center">
        <Box flexGrow={1} minWidth={1} height={1} borderStyle="single" borderColor={C.goal} />
        <Text bold color={C.goal}>
          {name}
        </Text>
        <Box flexGrow={1} minWidth={1} height={1} borderStyle="single" borderColor={C.goal} />
      </Box>
    )
  const left = Math.max(1, Math.floor((ctx.width - name.length) / 2))
  return (
    <Box flexDirection="row" flexShrink={0} height={1}>
      <Text dimColor>{'─'.repeat(left)}</Text>
      <Text bold color={C.goal}>
        {name}
      </Text>
      <Text dimColor>{'─'.repeat(Math.max(1, ctx.width - name.length - left))}</Text>
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
      {Tabs({ el: ctx.el, surface: ctx.surface, width }, tabItems(ctx, snapshot))}
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
    collapseBarLabels(tabItems(ctx, snapshot), Math.max(1, ctx.width - (max > 0 ? 5 : 0)), ctx.surface, 1, 'tabs').grid.rows.length +
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
      {Bar({ el: ctx.el, surface: ctx.surface, width: ctx.width }, items.map(item => ({ ...item, active: item.key === 'legend' ? ctx.view.legend : false })))}
    </Box>
  )
}
function appBarRows(ctx: Ctx, snapshot: AtlasSnapshot): number {
  return collapseBarLabels(appBarItems(ctx, snapshot), ctx.width, ctx.surface, 1, 'bar').grid.rows.length
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

export function pane(ctx: Ctx, snapshot: AtlasSnapshot): {
  tree: RenderElement
  maxScroll: number
  maxPopupScroll: number
  maxLegendScroll: number
  maxExpandedScroll: number
} {
  const { Box } = ctx.el
  if (ctx.view.setup)
    return {
      tree: (
        <Box flexDirection="column" paddingX={1}>
          {titleRule(ctx)}
          {setupScreen(ctx)}
        </Box>
      ),
      maxScroll: 0,
      maxPopupScroll: 0,
      maxLegendScroll: 0,
      maxExpandedScroll: 0,
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
  const maxExpandedScroll = expandedSection
    ? Math.max(0, expandedSection.help.length - visibleHelpRows(bodyCtx, expandedSection.help.length))
    : 0
  let body = renderBody(bodyCtx, model)
  let content = rowsOf(body, ctx.width)
  const bar = pinned && content > viewport
  const drawCtx = bar ? { ...bodyCtx, width: ctx.width - 2 } : bodyCtx
  if (bar) {
    body = renderBody(drawCtx, model)
    content = rowsOf(body, ctx.width - 2)
  }
  const maxScroll = pinned ? Math.max(0, content - viewport) : 0
  const at = Math.min(Math.max(0, ctx.view.scroll), maxScroll)
  const scrollbar = bar && maxScroll > 0 ? scrollbarCells(ctx, viewport, content, at, maxScroll) : null
  const popup = activePopup(ctx, model)
  const popupItems = popup ? popup.rows.map(row => renderRow(popupContext(bodyCtx), row)) : []
  const maxPopupScroll = popup ? popupGeometry(bodyCtx, popupItems).maxScroll : 0
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
      {titleRule(ctx)}
      {tabBar(ctx, snapshot, { at, max: maxScroll, page: Math.max(1, viewport - 2) })}
      {bodyTree}
      {uiRule({ el: ctx.el, surface: ctx.surface, width: ctx.width }, C.path)}
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
