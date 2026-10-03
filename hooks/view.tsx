// The Atlas pane, drawn from a snapshot. Pure apart from the `act` callback it hands to
// Buttons; the hooks module turns each action into a state write.
//
// Layout, top to bottom, sized to the pane's rows so the bar never scrolls away:
//   tab bar        Map · Trail · Open · Evidence, and ▲▼ while the body overflows
//   body           the tab, scrolled by the pane itself (ui.scroll → view.scroll)
//   popup          a small anchored bordered event/menu over the body or app bar
//   app bar        Legend toggle, decisions/questions menus, and Mark
// While the Legend is on every section heading also shows what that section is for.

import type { Elements, RenderElement } from 'claude-code'

import type { AtlasCheckpoint, AtlasItem, AtlasMode, AtlasPopup, AtlasRecall, AtlasSelection, AtlasSnapshot, AtlasSuggestion, AtlasTab, AtlasTopic, AtlasView } from '../types'
import { base, rel } from './activity'
import type { LiveRow, LiveSeg } from './live'
import { activeDecisions, currentTopic, openQuestions, pathOf, resumeHint, sentences } from './model'

export const C = {
  goal: '#7dcfff',
  action: '#7dcfff',
  path: '#bb9af7',
  trail: '#b9f27c',
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

// One glyph table drives both the Legend and every rendered row/event.
export const GLYPH = {
  goal: { char: '◎', color: C.goal },
  suggestion: { char: '○', color: undefined },
  currentTopic: { char: '●', color: C.path },
  detour: { char: '↳', color: C.detour },
  returned: { char: '↩', color: C.detour },
  observedDecision: { char: '◇', color: C.decision },
  settledDecision: { char: '◆', color: C.checkpoint },
  openQuestion: { char: '?', color: C.question },
  resolved: { char: '✓', color: C.ok },
  ok: { char: '✓', color: C.ok },
  fail: { char: '✗', color: C.fail },
  editedFile: { char: '✎', color: C.write },
  readFile: { char: '·', color: C.read },
  fresh: { char: '✦', color: undefined },
  expanded: { char: '▾', color: C.goal },
  prompt: { char: '›', color: undefined },
  next: { char: '▸', color: C.goal },
  resume: { char: '◎', color: C.goal },
} as const

const TAB_ACCENT: Record<AtlasTab, string> = {
  map: C.path,
  trail: C.trail,
  open: C.question,
  evidence: C.checkpoint,
}

export const TONES: Record<string, string[]> = {
  violet: ['#6d5a9c', '#8f78c9', '#b9a3f0', '#efe6ff'],
  orange: ['#9c5a2c', '#c9783e', '#f0a46e', '#fff0e0'],
  amber: ['#8c6a2c', '#b8903e', '#e0b86e', '#fff4d6'],
  green: ['#4f7a3a', '#6fa052', '#9ece6a', '#e8ffd6'],
  blue: ['#3d5a9c', '#5a7ac9', '#8aa8f0', '#e0eaff'],
}

export type Action =
  | { type: 'tab'; tab: AtlasTab }
  | { type: 'legend' }
  | { type: 'popup'; popup: AtlasPopup }
  | { type: 'popup-scroll'; by: number }
  | { type: 'scroll'; by: number }
  | { type: 'scroll-to'; at: number }
  | { type: 'trail-sort' }
  | { type: 'expand'; id: string }
  | { type: 'confirm'; id: string }
  | { type: 'dismiss'; id: string }
  | { type: 'settle'; id: string }
  | { type: 'exclude'; id: string }
  | { type: 'drop'; id: string }
  | { type: 'restore'; id: string }
  | { type: 'resolve'; id: string }
  | { type: 'reopen'; id: string }
  | { type: 'attach'; ref: { kind: string; id: string; text: string } }
  | { type: 'return' }
  | { type: 'promote' }
  | { type: 'mark' }
  | { type: 'goal'; text: string }
  | { type: 'pin'; text: string }
  | { type: 'edit-goal' }
  | { type: 'adopt'; id: string }
  | { type: 'scan' }
  | { type: 'open-setup' }
  | { type: 'set-observer'; mode: AtlasMode }
  | { type: 'toggle-observer' }

type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & { Input?: Elements['terminal']['Input'] }

export type Ctx = {
  el: El
  width: number
  rows: number
  bodyViewport?: number
  now: number
  mode: AtlasMode
  setupDefault: AtlasMode
  view: AtlasView
  live: (key: string, rows: LiveRow[]) => RenderElement
  act: (action: Action) => void
}

// What each section is for, shown under its heading while the Legend is open.
const EXPLAIN: Record<string, string> = {
  SETUP: 'Choose whether Claude helps Atlas observe topics, decisions and questions, or keep the free engine-only map.',
  GOAL: 'What you are trying to do. Only you set it: confirm a suggestion, type one, or explicitly adopt Atlas’s detected aim.',
  'CURRENT PATH': 'Topics from the start of the work to now; ● is where you are. Claude keeps it current.',
  DETOUR: 'A side trip you chose. Return hands Claude a recap of where you left off.',
  'POSSIBLE DETOUR': 'Looks like a side trip. Take it to get a return point, or say it is not one.',
  ACTIVITY: 'What Claude is doing: spinner = running, ✓ done, ✗ failed.',
  'WORKING SET': 'Files touched lately: ✎ edited, · read. Click one to point Claude at it.',
  LATEST: 'Newest decisions (◇) and questions (?). Confirm them in the Open tab.',
  'RESUME NEXT': 'Where to pick up. "pinned" is yours; "suggested" is Claude\'s guess.',
  'MAP OF TOPICS': 'Every topic so far, nested where it branched. Click one for kind, status, turns, children, decisions, questions and actions. t3 = first seen on turn 3.',
  TRAIL: 'What happened: › prompts, ● topics, ◇ decisions, ◆ checkpoints. Click any event for its full text; the button beside the heading flips the order.',
  'NEEDS YOUR CALL': 'Suggestions from Claude or your wording. Nothing changes until you press.',
  'OBSERVED DECISIONS': 'Things that sounded decided. Settle = true from now on; Drop = it was not a decision.',
  'DETOUR FINDINGS': 'Keep = an outcome you take back; Exclude = explored, do not rely on it.',
  'OPEN QUESTIONS': 'Unanswered questions from Claude or you. Mark them resolved when answered.',
  CHECKPOINTS: 'Moments to come back to: commits, tests passing after edits, milestones, your marks.',
  'SETTLED (LEDGER)': 'Decisions you settled. Treated as true until you reopen them.',
  RESOLVED: 'Questions already answered.',
  DETOURS: 'Past detours: ↩ returned, ◎ made into the goal.',
  'EARLIER SESSIONS': 'Earlier sessions in this project (Atlas or Trailhead). Resume brings back their goal, next step and decisions.',
  FILES: 'Every file touched this session, most edited first.',
  'HOW TO USE': 'Plain rows expand inline; bracketed controls act immediately; ◇ decisions and ? open questions use boxed popups.',
}

const OBSERVER_NOTE = 'Needs the Claude observer · /atlas observer claude'

const TAB_HELP: Record<AtlasTab, string> = {
  map: 'Map: where you are right now.',
  trail: 'Trail: how you got here.',
  open: 'Open: things waiting for your yes or no.',
  evidence: 'Evidence: proof, settled facts, earlier sessions.',
}

const LEGEND: [Glyph, string][] = [
  [GLYPH.goal, 'your goal (confirmed)'],
  [GLYPH.suggestion, 'suggestion, needs you'],
  [GLYPH.currentTopic, 'current topic'],
  [GLYPH.detour, 'detour / possible detour'],
  [GLYPH.returned, 'returned'],
  [GLYPH.observedDecision, 'decision, not settled'],
  [GLYPH.settledDecision, 'settled decision · checkpoint'],
  [GLYPH.openQuestion, 'open question'],
  [GLYPH.ok, 'done'],
  [GLYPH.fail, 'failed'],
  [GLYPH.editedFile, 'file edited'],
  [GLYPH.readFile, 'file read'],
  [GLYPH.fresh, 'just changed'],
  [GLYPH.expanded, 'expanded inline · Add to message puts a chip in your draft'],
]

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 45) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}

function fit(text: string, width: number): string {
  const w = Math.max(4, width)
  return text.length <= w ? text : `${text.slice(0, w - 1)}…`
}

// ------------------------------------------------------------------ measuring

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown }

function kids(v: unknown): unknown[] {
  if (v === null || v === undefined || v === false || v === true) return []
  if (Array.isArray(v)) return v.flatMap(kids)
  return [v]
}

function textOf(v: unknown): string {
  return kids(v)
    .map(k => (typeof k === 'string' || typeof k === 'number' ? String(k) : textOf(childrenOf(k as Node))))
    .join('')
}

// A built element keeps its children beside its props; a JSX call may leave them in props.
function childrenOf(n: Node): unknown {
  return n.children ?? n.props?.children
}

// Rows a tree takes at `width`, close enough to clamp the pane's own scrolling.
export function rowsOf(v: unknown, width: number): number {
  const list = kids(v)
  if (list.length !== 1) return list.reduce<number>((a, k) => a + rowsOf(k, width), 0)
  const n = list[0]
  if (typeof n === 'string' || typeof n === 'number') return 1
  const el = n as Node
  const p = el.props ?? {}
  if (p.position === 'absolute') return 0
  const extra = (Number(p.marginTop) || 0) + (Number(p.marginBottom) || 0) + 2 * (Number(p.marginY) || 0) + 2 * (Number(p.paddingY) || 0)
  switch (el.type) {
    case 'Text':
      if (p.wrap !== 'wrap') return Math.max(1, textOf(childrenOf(el)).split('\n').length) + extra
      return textOf(childrenOf(el)).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(8, width))), 0) + extra
    case 'Button':
    case 'Input':
    case 'Select':
      return 1 + extra
    case 'Client': {
      const props = p.props as { rows?: unknown[] } | undefined
      return (props?.rows?.length ?? 1) + extra
    }
    case 'Box': {
      if (p.display === 'none') return 0
      const children = kids(childrenOf(el)).filter(c => (c as Node).props?.position !== 'absolute')
      const inner = Math.max(8, width - 2 * (Number(p.paddingX) || 0) - (Number(p.marginLeft) || 0))
      if (p.flexDirection === 'row') {
        if (p.flexWrap === 'wrap') {
          const len = children.reduce<number>((a, c) => a + textOf((c as Node).props?.label ?? childrenOf(c as Node)).length + 5, 0)
          return Math.max(1, Math.ceil(len / inner)) + extra
        }
        return Math.max(0, ...children.map(c => rowsOf(c, inner))) + extra
      }
      const gap = (Number(p.gap) || 0) * Math.max(0, children.length - 1)
      return children.reduce<number>((a, c) => a + rowsOf(c, inner), 0) + gap + extra
    }
    default:
      return 1 + extra
  }
}

// ------------------------------------------------------------------ small parts

function heading(ctx: Ctx, label: string, color?: string, right?: string | RenderElement, dim = false) {
  const { Box, Text } = ctx.el
  const note = ctx.view.legend ? EXPLAIN[label] : undefined
  const headingColor = color ?? TAB_ACCENT[ctx.view.tab]
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text bold color={headingColor} dimColor={dim}>
          {label}
        </Text>
        <Box flexGrow={1} />
        {right ? typeof right === 'string' ? <Text dimColor>{right}</Text> : right : null}
      </Box>
      {note ? (
        <Text dimColor italic wrap="wrap">
          {note}
        </Text>
      ) : null}
    </Box>
  )
}

type RowAction = { key: string; label: string; act: Action; primary?: boolean; role?: 'dismiss' }

type ActionLayout = { marginLeft?: number; gap?: number; flexWrap?: 'wrap' | 'nowrap' }

function actions(ctx: Ctx, items: RowAction[], layout: ActionLayout = {}) {
  const { Box, Text, Button } = ctx.el
  const marginLeft = layout.marginLeft ?? 2
  const gap = layout.gap ?? 1
  const flexWrap = layout.flexWrap ?? 'wrap'
  return (
    <Box flexDirection="row" gap={gap} marginLeft={marginLeft} flexWrap={flexWrap}>
      {items.map(i => (
        i.primary ? (
          <Button key={i.key} label={i.label} variant="primary" {...(i.role ? { role: i.role } : {})} onPress={() => ctx.act(i.act)} />
        ) : (
          <Box key={`action-${i.key}`} flexDirection="row">
            <Text color={C.action}>[</Text>
            <Button key={i.key} plain label={` ${i.label} `} hover={{ color: C.action }} {...(i.role ? { role: i.role } : {})} onPress={() => ctx.act(i.act)} />
            <Text color={C.action}>]</Text>
          </Box>
        )
      ))}
    </Box>
  )
}

function selectable(ctx: Ctx, key: string, selection: AtlasSelection, label: string, color?: string, fresh = false, details: string[] = [], extra: RowAction[] = [], glyph?: Glyph) {
  const { Box, Text, Button } = ctx.el
  const open = ctx.view.expanded === selection.id
  const text = fit(label, ctx.width - 2)
  const head = (
    <Box key={`head-${key}`} flexDirection="row" gap={1}>
      {fresh ? <Text color={GLYPH.fresh.color} bold>{GLYPH.fresh.char}</Text> : null}
      {glyph ? <Text color={glyph.color} bold={open}>{glyph.char}</Text> : null}
      {open ? <Text color={GLYPH.expanded.color}>{GLYPH.expanded.char}</Text> : null}
      <Button
        key={key}
        plain
        dimColor={!open && !fresh && !color}
        label={text}
        onPress={() => ctx.act({ type: 'expand', id: selection.id })}
      />
    </Box>
  )
  if (!open) return head
  return (
    <Box key={`x-${key}`} flexDirection="column">
      {head}
      <Box flexDirection="column" marginLeft={2}>
        {(details.length ? details : [`kind: ${selection.kind}`]).map((line, i) => (
          <Text key={`detail-${key}-${i}`} dimColor wrap="wrap">{`│ ${line}`}</Text>
        ))}
      </Box>
      {extra.length ? actions(ctx, extra) : null}
      {actions(ctx, [
        { key: `add-${key}`, label: 'Add to message', act: { type: 'attach', ref: { kind: selection.kind, id: selection.id, text: selection.text } }, primary: true },
        { key: `close-${key}`, label: 'Close', act: { type: 'expand', id: selection.id } },
      ])}
    </Box>
  )
}

function suggestionRow(ctx: Ctx, s: AtlasSnapshot, x: AtlasSuggestion) {
  const { Box, Text } = ctx.el
  const fresh = s.fresh.includes(x.id)
  const confirm: Record<AtlasSuggestion['kind'], string> = { goal: 'Set as goal', detour: 'Take detour', return: 'Return', next: 'Pin next', resume: 'Resume' }
  const dismiss: Record<AtlasSuggestion['kind'], string> = { goal: 'Not my goal', detour: 'Not a detour', return: 'Stay', next: 'Dismiss', resume: 'Dismiss' }
  const glyph = x.kind === 'detour' ? GLYPH.detour : x.kind === 'return' ? GLYPH.returned : GLYPH.suggestion
  const color = x.kind === 'detour' || x.kind === 'return' ? C.detour : x.kind === 'goal' || x.kind === 'resume' ? C.goal : undefined
  const who = x.source === 'claude' ? 'Claude' : x.source === 'cue' ? 'your words' : 'Atlas'
  return (
    <Box key={`sg-${x.id}`} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={glyph.color} bold={fresh}>{glyph.char}</Text>
        {fresh ? <Text color={GLYPH.fresh.color}>{GLYPH.fresh.char}</Text> : null}
        <Text color={color} bold={fresh} wrap="truncate-end">{fit(x.text, ctx.width - 4)}</Text>
      </Box>
      <Text dimColor wrap="truncate-end">
        {`  ${fit(`${x.kind} suggestion · from ${who}${x.why ? ` · ${x.why}` : ''}`, ctx.width - 2)}`}
      </Text>
      {actions(ctx, [
        { key: `ok-${x.id}`, label: confirm[x.kind], act: { type: 'confirm', id: x.id }, primary: true },
        { key: `no-${x.id}`, label: dismiss[x.kind], act: { type: 'dismiss', id: x.id } },
      ])}
    </Box>
  )
}

function sourceName(source: string): string {
  return source === 'claude' ? 'Claude' : source === 'cue' ? 'your wording' : source === 'engine' ? 'engine' : source === 'person' ? 'you' : source
}

function topicName(s: AtlasSnapshot, id: string | null): string | null {
  return id ? s.topics.find(t => t.id === id)?.title ?? null : null
}

function whenLine(ctx: Ctx, at: number, turn: number): string {
  return `when: ${ago(ctx.now - at)} · turn ${turn}`
}

function decisionRow(ctx: Ctx, s: AtlasSnapshot, d: AtlasItem, withActions: boolean) {
  const { Box } = ctx.el
  const settled = d.status === 'settled'
  const excluded = d.status === 'excluded'
  const inDetour = Boolean(s.detour) && d.at >= (s.detour?.at ?? 0)
  const glyph = settled ? GLYPH.settledDecision : GLYPH.observedDecision
  const details = [
    ...(d.text.length > Math.max(24, ctx.width - 8) ? [`text: ${d.text}`] : []),
    `kind: ${settled ? 'settled decision' : excluded ? 'excluded decision' : 'observed decision'}`,
    `source: ${sourceName(d.source)}`,
    whenLine(ctx, d.at, d.turn),
    `status: ${d.status}`,
    ...(topicName(s, d.topicId) ? [`topic: ${topicName(s, d.topicId)}`] : []),
  ]
  const extra: RowAction[] = !withActions
    ? []
    : settled || excluded
      ? [{ key: `restore-${d.id}`, label: excluded ? 'Restore' : 'Reopen', act: { type: 'restore', id: d.id } }]
      : inDetour
        ? [
            { key: `set-${d.id}`, label: 'Keep', act: { type: 'settle', id: d.id }, primary: true },
            { key: `exc-${d.id}`, label: 'Exclude', act: { type: 'exclude', id: d.id } },
          ]
        : [
            { key: `set-${d.id}`, label: 'Settle', act: { type: 'settle', id: d.id }, primary: true },
            { key: `drp-${d.id}`, label: 'Drop', act: { type: 'drop', id: d.id } },
          ]
  return (
    <Box key={`d-${d.id}`} flexDirection="column">
      {selectable(ctx, `dsel-${d.id}`, { kind: settled ? 'Settled decision' : excluded ? 'Excluded decision' : 'Observed decision', id: d.id, text: d.text }, d.text, settled ? C.decision : excluded ? undefined : C.decision, s.fresh.includes(d.id), details, extra, glyph)}
    </Box>
  )
}

function questionRow(ctx: Ctx, s: AtlasSnapshot, q: AtlasItem, withActions: boolean) {
  const { Box } = ctx.el
  const open = q.status === 'open'
  const details = [
    ...(q.text.length > Math.max(24, ctx.width - 8) ? [`text: ${q.text}`] : []),
    `kind: ${open ? 'open question' : 'resolved question'}`,
    `source: ${sourceName(q.source)}`,
    whenLine(ctx, q.at, q.turn),
    `status: ${q.status}`,
    ...(topicName(s, q.topicId) ? [`topic: ${topicName(s, q.topicId)}`] : []),
  ]
  return (
    <Box key={`q-${q.id}`} flexDirection="column">
      {selectable(ctx, `qsel-${q.id}`, { kind: open ? 'Open question' : 'Resolved question', id: q.id, text: q.text }, q.text, open ? C.question : undefined, s.fresh.includes(q.id), details, withActions ? [open ? { key: `res-${q.id}`, label: 'Resolved', act: { type: 'resolve', id: q.id } } : { key: `reo-${q.id}`, label: 'Reopen', act: { type: 'reopen', id: q.id } }] : [], open ? GLYPH.openQuestion : GLYPH.resolved)}
    </Box>
  )
}

// ------------------------------------------------------------------ tab bar

// A centered rule naming the product, spanning the pane: ─── Conversation Atlas ───.
function titleRule(ctx: Ctx) {
  const { Box, Text } = ctx.el
  const name = ctx.width >= 34 ? ' Conversation Atlas ' : ' Atlas '
  const left = Math.max(1, Math.floor((ctx.width - name.length) / 2))
  const right = Math.max(1, ctx.width - name.length - left)
  return (
    <Box flexDirection="row" flexShrink={0} height={1}>
      <Text dimColor>{'─'.repeat(left)}</Text>
      <Text bold color={C.goal}>{name}</Text>
      <Text dimColor>{'─'.repeat(right)}</Text>
    </Box>
  )
}

function tabBar(ctx: Ctx, s: AtlasSnapshot, scroll: { at: number; max: number; page: number }) {
  const { Box, Button, Text } = ctx.el
  const pending = s.suggestions.length + s.decisions.filter(d => d.status === 'observed').length + openQuestions(s).length
  const tiers: { name: 'full' | 'mid' | 'tiny'; labels: string[] }[] = [
    { name: 'full', labels: ['Map', 'Trail', pending ? `Open ${pending}` : 'Open', 'Evidence'] },
    { name: 'mid', labels: ['Map', 'Trail', pending ? `Open ${pending}` : 'Open', 'Evid'] },
    { name: 'tiny', labels: ['M', 'T', 'O', 'E'] },
  ]
  const gap = 1
  const scrollNeed = scroll.max > 0 ? 4 : 0
  const needed = (labels: string[]) => labels.reduce((n, label, i) => n + label.length + (ctx.view.tab === ['map', 'trail', 'open', 'evidence'][i] ? 1 : 0) + (i ? gap : 0), 0) + scrollNeed + (scroll.max > 0 ? gap : 0)
  const tier = tiers.find(x => needed(x.labels) <= ctx.width)?.name ?? 'tiny'
  const labels = tiers.find(x => x.name === tier)?.labels ?? ['M', 'T', 'O', 'E']
  const wrapped = tier === 'tiny' && needed(labels) > ctx.width
  const list: { tab: AtlasTab; label: string; hotkey: string }[] = [
    { tab: 'map', label: labels[0] ?? 'M', hotkey: 'm' },
    { tab: 'trail', label: labels[1] ?? 'T', hotkey: 't' },
    { tab: 'open', label: labels[2] ?? 'O', hotkey: 'o' },
    { tab: 'evidence', label: labels[3] ?? 'E', hotkey: 'e' },
  ]
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" gap={gap} flexWrap={wrapped ? 'wrap' : 'nowrap'}>
        {list.map(t => {
          const on = ctx.view.tab === t.tab
          return on
            ? <Text key={`tab-${t.tab}`} bold color={TAB_ACCENT[t.tab]}>{`▸${t.label}`}</Text>
            : <Button key={`tab-${t.tab}`} plain hotkey={tier === 'tiny' ? undefined : t.hotkey} dimColor label={t.label} onPress={() => ctx.act({ type: 'tab', tab: t.tab })} />
        })}
        {scroll.max > 0 ? (
          <Box flexDirection="row" gap={1}>
            <Button key="scroll-up" plain dimColor={scroll.at === 0} label="▲" onPress={() => ctx.act({ type: 'scroll', by: -scroll.page })} />
            <Button key="scroll-down" plain dimColor={scroll.at >= scroll.max} label="▼" onPress={() => ctx.act({ type: 'scroll', by: scroll.page })} />
          </Box>
        ) : null}
      </Box>
      {ctx.view.legend ? (
        <Text dimColor italic wrap="truncate-end">
          {fit(TAB_HELP[ctx.view.tab], ctx.width)}
        </Text>
      ) : null}
    </Box>
  )
}

function tabBarRows(ctx: Ctx, s: AtlasSnapshot, scroll: { max: number }): number {
  const pending = s.suggestions.length + s.decisions.filter(d => d.status === 'observed').length + openQuestions(s).length
  const gap = 1
  const scrollNeed = scroll.max > 0 ? 4 : 0
  const needed = (labels: string[]) => labels.reduce((n, label, i) => n + label.length + (ctx.view.tab === ['map', 'trail', 'open', 'evidence'][i] ? 1 : 0) + (i ? gap : 0), 0) + scrollNeed + (scroll.max > 0 ? gap : 0)
  const full = ['Map', 'Trail', pending ? `Open ${pending}` : 'Open', 'Evidence']
  const mid = ['Map', 'Trail', pending ? `Open ${pending}` : 'Open', 'Evid']
  const tiny = ['M', 'T', 'O', 'E']
  const wrapped = needed(full) > ctx.width && needed(mid) > ctx.width && needed(tiny) > ctx.width
  return 1 + (wrapped ? 1 : 0) + (ctx.view.legend ? 1 : 0)
}

// ------------------------------------------------------------------ app bar + legend + popups

function appBar(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Button, Text } = ctx.el
  const decisions = activeDecisions(s).length
  const open = openQuestions(s).length
  const tiers: { name: 'full' | 'mid' | 'tiny'; labels: string[] }[] = [
    { name: 'full', labels: ['Legend', `${decisions} decisions →`, `${open} open →`, '+ Mark'] },
    { name: 'mid', labels: ['Legend', `${decisions} dec →`, `${open} open →`, '+ Mark'] },
    { name: 'tiny', labels: ['≡', `${decisions}→`, `${open}→`, '+ Mark'] },
  ]
  const gap = 1
  const need = (labels: string[]) => labels.reduce((n, label, i) => n + label.length + (i ? gap : 0), 0)
  const tier = tiers.find(x => need(x.labels) <= ctx.width)?.name ?? 'tiny'
  const chosen = tiers.find(x => x.name === tier) ?? { name: 'tiny' as const, labels: ['≡', `${decisions}→`, `${open}→`, '+ Mark'] }
  const wrapped = tier === 'tiny' && need(chosen.labels) > ctx.width
  const items: { kind: 'legend' | 'decisions' | 'questions'; hotkey?: string; label: string }[] = [
    { kind: 'legend', hotkey: 'l', label: chosen.labels[0] ?? '≡' },
    { kind: 'decisions', hotkey: 'd', label: chosen.labels[1] ?? `${decisions}→` },
    { kind: 'questions', hotkey: 'q', label: chosen.labels[2] ?? `${open}→` },
  ]
  const popupKind = ctx.view.popup?.kind === 'decisions' || ctx.view.popup?.kind === 'questions' ? ctx.view.popup.kind : null
  const popupLeft = popupKind === 'decisions'
    ? (chosen.labels[0]?.length ?? 0) + gap
    : (chosen.labels[0]?.length ?? 0) + gap + (chosen.labels[1]?.length ?? 0) + gap
  return (
    <Box key="app-bar" position="relative" flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" gap={gap} flexWrap={wrapped ? 'wrap' : 'nowrap'} flexShrink={0} height={wrapped ? 2 : 1} overflow="hidden">
        {items.map(i => {
          const on = i.kind === 'legend' ? ctx.view.legend : ctx.view.popup?.kind === i.kind
          const action: Action = i.kind === 'legend' ? { type: 'legend' } : { type: 'popup', popup: { kind: i.kind } }
          const glyph = i.kind === 'decisions' ? GLYPH.observedDecision : i.kind === 'questions' ? GLYPH.openQuestion : null
          return (
            <Box key={`bar-${i.kind}`} flexDirection="row" gap={1}>
              {glyph ? <Text color={glyph.color}>{glyph.char}</Text> : null}
              <Button key={`bar-${i.kind}`} plain hotkey={tier === 'tiny' ? undefined : i.hotkey} dimColor={!on} label={i.label} onPress={() => ctx.act(action)} />
            </Box>
          )
        })}
        <Button key="mark" plain hotkey={tier === 'tiny' ? undefined : 'k'} label={chosen.labels[3] ?? '+ Mark'} onPress={() => ctx.act({ type: 'mark' })} />
      </Box>
      {popupKind === 'decisions' ? decisionsPopup(ctx, s, { bottom: 1, left: popupLeft }) : popupKind === 'questions' ? questionsPopup(ctx, s, { bottom: 1, left: popupLeft }) : null}
    </Box>
  )
}

function legendPanel(ctx: Ctx) {
  const { Box, Text } = ctx.el
  const cols = ctx.width >= 64 ? 2 : 1
  const colWidth = Math.floor(ctx.width / cols) - 1
  const rows: [Glyph, string][][] = []
  for (let i = 0; i < LEGEND.length; i += cols) rows.push(LEGEND.slice(i, i + cols))
  return (
    <Box key="legend-panel" flexDirection="column" borderStyle="round" borderColor={C.path} paddingX={1} flexShrink={0}>
      <Text bold>HOW TO USE</Text>
      <Text dimColor wrap="wrap">Plain rows = click to expand structured details inline. [Bracketed] controls are actions. ◇ decisions and ? open questions open a boxed popup; ✕ Close or any other action dismisses it. Legend and Trail sort are toggles.</Text>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>Observer mode:</Text>
        {actions(ctx, [{ key: 'observer-toggle', label: ctx.mode === 'claude' ? 'Observer: Claude' : 'Observer: Engine only', act: { type: 'toggle-observer' } }], { marginLeft: 0, gap: 0 })}
      </Box>
      <Text bold>LEGEND</Text>
      {rows.map((row, r) => (
        <Box key={`lg-${r}`} flexDirection="row">
          {row.map(([glyph, meaning]) => (
            <Box key={`lg-${glyph.char}`} width={colWidth} flexDirection="row" gap={1}>
              <Text color={glyph.color} bold>{glyph.char}</Text>
              <Text wrap="truncate-end">{fit(meaning, colWidth - 5)}</Text>
            </Box>
          ))}
        </Box>
      ))}
      <Text dimColor wrap="wrap">
        Colors: violet path · amber detour · green decision · pink question · blue checkpoint. Nothing reaches Claude unless you add its chip to your message.
      </Text>
    </Box>
  )
}

function setupScreen(ctx: Ctx) {
  const { Box, Text } = ctx.el
  const engineDefault = ctx.setupDefault === 'engine'
  return (
    <Box key="setup-screen" flexDirection="column" marginTop={2}>
      <Text bold color={C.goal}>Set up Atlas</Text>
      <Text dimColor wrap="wrap">Claude observer adds topics and path, possible detours, Claude-reported decisions and questions, a detected goal, and a suggested next step.</Text>
      <Text dimColor wrap="wrap">When something changes, it uses a small amount of Claude usage: one extra tool step plus a cached rules section.</Text>
      <Text dimColor wrap="wrap">This choice applies in every project.</Text>
      <Text dimColor wrap="wrap">Engine only is free and keeps activity, files, tests, commits, prompt trail, wording cues, recovery, chips and return packets.</Text>
      {engineDefault ? <Text dimColor>Default from /config: Engine only.</Text> : null}
      <Box marginTop={1}>
        {actions(ctx, [
          { key: 'setup-claude', label: 'Use Claude observer', act: { type: 'set-observer', mode: 'claude' }, primary: true },
          { key: 'setup-engine', label: 'Engine only (free)', act: { type: 'set-observer', mode: 'engine' } },
        ], { marginLeft: 0 })}
      </Box>
    </Box>
  )
}

function popupWidth(ctx: Ctx): number {
  return Math.max(8, Math.min(52, ctx.width - 4))
}

function popupMaxHeight(ctx: Ctx): number {
  const viewport = Math.max(1, ctx.bodyViewport ?? ctx.rows)
  return Math.max(5, Math.min(10, Math.floor(viewport * 0.4)))
}

function popupContext(ctx: Ctx): Ctx {
  return { ...ctx, width: Math.max(8, popupWidth(ctx) - 4) }
}

type PopupPlacement = { top?: number; bottom?: number; left: number }

type PopupGeometry = {
  height: number
  bodyRows: number
  maxScroll: number
  itemRows: number[]
  totalRows: number
}

function popupGeometry(ctx: Ctx, items: RenderElement[]): PopupGeometry {
  const itemRows = items.map(item => Math.max(1, rowsOf(item, popupContext(ctx).width)))
  const totalRows = itemRows.reduce((sum, rows) => sum + rows, 0)
  const height = Math.min(popupMaxHeight(ctx), Math.max(5, totalRows + 4))
  const bodyRows = Math.max(1, height - 4)
  return { height, bodyRows, maxScroll: Math.max(0, totalRows - bodyRows), itemRows, totalRows }
}

function popupWindow(items: RenderElement[], itemRows: number[], at: number, bodyRows: number): { visible: RenderElement[]; start: number } {
  let start = 0
  let skipped = 0
  while (start < items.length && skipped + (itemRows[start] ?? 1) <= at) {
    skipped += itemRows[start] ?? 1
    start += 1
  }
  let end = start
  let used = 0
  while (end < items.length && (used === 0 || used + (itemRows[end] ?? 1) <= bodyRows)) {
    used += itemRows[end] ?? 1
    end += 1
  }
  return { visible: items.slice(start, Math.max(start + (items.length ? 1 : 0), end)), start }
}

function popupShell(ctx: Ctx, title: string, items: RenderElement[], popupState: AtlasPopup, placement: PopupPlacement, itemCount: number, footer?: RenderElement) {
  const { Box, Button, Text } = ctx.el
  const geometry = popupGeometry(ctx, items)
  const at = Math.min(Math.max(0, ctx.view.popupScroll), geometry.maxScroll)
  const window = popupWindow(items, geometry.itemRows, at, geometry.bodyRows)
  const position = itemCount === 0 ? 0 : Math.min(itemCount, window.start + 1)
  const left = Math.max(0, Math.min(placement.left, ctx.width - popupWidth(ctx)))
  const anchored = { ...placement, left }
  return (
    <Box key="atlas-popup" position="absolute" {...anchored} width={popupWidth(ctx)} height={geometry.height} overflow="hidden" borderStyle="round" borderColor={C.path} backgroundColor="#16161e" paddingX={1} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Text bold>{title}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="popup-up" plain dimColor={at === 0} label="▲" onPress={() => ctx.act({ type: 'popup-scroll', by: -1 })} />
          {actions(ctx, [{ key: 'popup-close', label: 'Close', role: 'dismiss', act: { type: 'popup', popup: popupState } }], { marginLeft: 0, gap: 0, flexWrap: 'nowrap' })}
        </Box>
      </Box>
      <Box flexDirection="column" height={geometry.bodyRows} overflow="hidden">
        {window.visible}
      </Box>
      <Box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        {footer ?? <Text dimColor />}
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{`${position}/${itemCount}`}</Text>
          <Button key="popup-down" plain dimColor={at >= geometry.maxScroll} label="▼" onPress={() => ctx.act({ type: 'popup-scroll', by: 1 })} />
        </Box>
      </Box>
    </Box>
  )
}

function allDecisions(s: AtlasSnapshot): AtlasItem[] {
  const rank = (d: AtlasItem) => (d.status === 'settled' ? 0 : d.status === 'observed' ? 1 : 2)
  return [...s.decisions].filter(d => d.status === 'settled' || d.status === 'observed' || d.status === 'excluded').sort((a, b) => rank(a) - rank(b) || b.at - a.at)
}

type PopupContent = { items: RenderElement[]; itemCount: number; footer?: RenderElement }

function decisionsPopupContent(ctx: Ctx, s: AtlasSnapshot): PopupContent {
  const { Box, Text } = ctx.el
  const list = allDecisions(s)
  const pctx = popupContext(ctx)
  return {
    items: list.length
      ? [...list.map(d => decisionRow(pctx, s, d, true)), (
          <Box flexDirection="row" gap={1}>
            <Text color={GLYPH.settledDecision.color}>{GLYPH.settledDecision.char}</Text>
            <Text dimColor>settled first ·</Text>
            <Text color={GLYPH.observedDecision.color}>{GLYPH.observedDecision.char}</Text>
            <Text dimColor>observed · excluded dim</Text>
          </Box>
        )]
      : [<Text dimColor>No decisions yet.</Text>],
    itemCount: list.length,
  }
}

function decisionsPopup(ctx: Ctx, s: AtlasSnapshot, placement: PopupPlacement) {
  const content = decisionsPopupContent(ctx, s)
  return popupShell(ctx, 'DECISIONS', content.items, { kind: 'decisions' }, placement, content.itemCount)
}

function questionsPopupContent(ctx: Ctx, s: AtlasSnapshot): PopupContent {
  const { Text } = ctx.el
  const list = [...openQuestions(s)].reverse()
  const pctx = popupContext(ctx)
  return { items: list.length ? list.map(q => questionRow(pctx, s, q, true)) : [<Text dimColor>No open questions.</Text>], itemCount: list.length }
}

function questionsPopup(ctx: Ctx, s: AtlasSnapshot, placement: PopupPlacement) {
  const content = questionsPopupContent(ctx, s)
  return popupShell(ctx, 'OPEN QUESTIONS', content.items, { kind: 'questions' }, placement, content.itemCount)
}

function eventPopupContent(ctx: Ctx, ev: AtlasSnapshot['events'][number]): PopupContent {
  const { Text } = ctx.el
  const details = ev.detail ?? []
  const items = [
    <Text dimColor>{`${ev.kind} · turn ${ev.turn} · ${ago(ctx.now - ev.at)}`}</Text>,
    // The summary first (it is what the popup is for), the full text below it.
    ...(details.length
      ? [
          <Text bold wrap="wrap">{sentences(ev.text)[0] ?? ev.text}</Text>,
          <Text bold>Points</Text>,
          <Text dimColor wrap="wrap">{details.map(d => `• ${d}`).join('\n')}</Text>,
          <Text bold>Full text</Text>,
        ]
      : []),
    <Text wrap="wrap">{ev.text}</Text>,
  ]
  const footer = ev.kind === 'prompt'
    ? actions(ctx, [{ key: `add-ev-${ev.id}`, label: 'Add to message', primary: true, act: { type: 'attach', ref: { kind: 'Prompt', id: ev.id, text: [ev.text, ...details].join('\n') } } }], { marginLeft: 0 })
    : undefined
  return { items, itemCount: items.length, footer }
}

function eventPopup(ctx: Ctx, ev: AtlasSnapshot['events'][number], anchorOffset: number) {
  const content = eventPopupContent(ctx, ev)
  const items = content.items
  const geometry = popupGeometry(ctx, items)
  const viewport = Math.max(1, ctx.bodyViewport ?? ctx.rows)
  const visibleRow = anchorOffset - ctx.view.scroll
  const below = visibleRow + 1 + geometry.height <= viewport
  const above = visibleRow - geometry.height >= 0
  const preferred = below ? 1 : above ? -geometry.height : 1
  // `top` is relative to the row; clamp so the popup's absolute top stays in [0, viewport - height].
  const top = Math.max(-visibleRow, Math.min(preferred, viewport - geometry.height - visibleRow))
  const left = Math.max(0, Math.min(2, ctx.width - popupWidth(ctx)))
  return popupShell(ctx, 'EVENT', items, { kind: 'event', id: ev.id }, { top, left }, content.itemCount, content.footer)
}

function popupScrollLimit(ctx: Ctx, s: AtlasSnapshot): number {
  const p = ctx.view.popup
  if (!p) return 0
  if (p.kind === 'decisions') return popupGeometry(ctx, decisionsPopupContent(ctx, s).items).maxScroll
  if (p.kind === 'questions') return popupGeometry(ctx, questionsPopupContent(ctx, s).items).maxScroll
  const ev = s.events.find(x => x.id === p.id)
  return ev ? popupGeometry(ctx, eventPopupContent(ctx, ev).items).maxScroll : 0
}

// ------------------------------------------------------------------ MAP

function goalSection(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text, Input, Button } = ctx.el
  const suggestion = [...s.suggestions].reverse().find(x => x.kind === 'goal' || x.kind === 'resume')
  const editing = ctx.view.editingGoal || (!s.goal && !suggestion)
  const note = ctx.view.legend ? EXPLAIN.GOAL : undefined
  const detected = s.detectedGoal && (!s.goal || s.detectedGoal.text !== s.goal.text) ? s.detectedGoal : null
  const detectedNeedsObserver = ctx.mode === 'engine' && detected?.source === 'claude'
  const goalLabel = s.goal ? fit(s.goal.text, ctx.width - 6) : 'not confirmed yet'
  const goalDetails = s.goal
    ? [
        `confirmed: ${s.goal.text}`,
        `set by: ${sourceName(s.goal.source)} · ${ago(ctx.now - s.goal.at)} · turn ${s.goal.turn}`,
        ...(detected ? [`Atlas currently reads your aim as: ${detected.text}`] : ['Atlas has no different detected aim.']),
      ]
    : [
        'status: not confirmed',
        ...(detected ? [`Atlas currently reads your aim as: ${detected.text}`] : ['Atlas has not detected an overall aim yet.']),
      ]
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold color={GLYPH.goal.color}>{GLYPH.goal.char}</Text>
        <Text bold color={C.goal}> GOAL</Text>
        <Box flexGrow={1} />
        {s.goal && !s.detour && !ctx.view.editingGoal ? actions(ctx, [{ key: 'edit-goal', label: 'change', act: { type: 'edit-goal' } }], { marginLeft: 0, gap: 0, flexWrap: 'nowrap' }) : null}
      </Box>
      {note ? (
        <Text dimColor italic wrap="wrap">
          {note}
        </Text>
      ) : null}
      {!editing ? (
        <Box flexDirection="row" gap={1}>
          <Text color={GLYPH.goal.color}>{GLYPH.goal.char}</Text>
          <Button key="goal-row" plain dimColor={!s.goal} label={goalLabel} onPress={() => ctx.act({ type: 'expand', id: 'goal' })} />
        </Box>
      ) : null}
      {ctx.view.expanded === 'goal' && !editing ? (
        <Box flexDirection="column" marginLeft={2}>
          {goalDetails.map((line, i) => <Text key={`goal-detail-${i}`} dimColor wrap="wrap">{`│ ${line}`}</Text>)}
          {detectedNeedsObserver ? <Text dimColor wrap="truncate-end">{OBSERVER_NOTE}</Text> : null}
          {detectedNeedsObserver ? actions(ctx, [{ key: 'turn-on-goal-observer', label: 'Turn on', primary: true, act: { type: 'open-setup' } }]) : null}
          {detected && !detectedNeedsObserver ? actions(ctx, [{ key: 'use-detected-goal', label: 'Use this as my goal', primary: true, act: { type: 'goal', text: detected.text } }]) : null}
          {actions(ctx, [{ key: 'close-goal', label: 'Close', act: { type: 'expand', id: 'goal' } }])}
        </Box>
      ) : null}
      {!s.goal && suggestion ? suggestionRow(ctx, s, suggestion) : null}
      {editing && Input ? (
        <Input key="goal-input" label={`${GLYPH.goal.char} `} placeholder={s.goal ? 'new goal, Enter to confirm' : 'type your goal, Enter to confirm'} submitLabel="set" onSubmit={(v: string) => ctx.act({ type: 'goal', text: v })} />
      ) : null}
    </Box>
  )
}

function pathRows(ctx: Ctx, s: AtlasSnapshot): LiveRow[] {
  const chain = pathOf(s)
  return chain.map((t, i) => {
    const isCur = i === chain.length - 1
    const indent = i === 0 ? '' : `${'   '.repeat(i - 1)}└─ `
    const color = t.kind === 'main' ? (isCur ? C.path : undefined) : C.detour
    const glyph = isCur ? GLYPH.currentTopic : t.kind !== 'main' ? GLYPH.detour : null
    const fresh = s.fresh.includes(t.id)
    const dim = ctx.mode === 'engine' && t.source === 'claude'
    const segs: LiveSeg[] = [
      { t: indent, d: true },
      { t: glyph ? `${glyph.char} ` : '', c: dim ? undefined : glyph?.color ?? color, b: dim ? false : isCur, d: dim || !isCur },
      { t: fit(t.title, ctx.width - indent.length - 4), c: dim ? undefined : isCur ? color : undefined, b: dim ? false : isCur, d: dim || !isCur, sh: dim ? undefined : fresh ? (t.kind === 'main' ? 'violet' : 'amber') : undefined },
    ]
    return { segs }
  })
}

function pathSection(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text } = ctx.el
  const rows = pathRows(ctx, s)
  const left = s.topics.filter(t => t.status === 'left').length
  const needsObserver = ctx.mode === 'engine' && s.topics.some(t => pathOf(s).some(p => p.id === t.id && p.source === 'claude'))
  return (
    <Box flexDirection="column">
      {heading(ctx, 'CURRENT PATH', needsObserver ? undefined : C.path, left ? `${left} earlier` : undefined, needsObserver)}
      {needsObserver ? <Text dimColor wrap="truncate-end">{OBSERVER_NOTE}</Text> : null}
      {rows.length ? ctx.live('path', rows) : <Text dimColor>Topics appear as the conversation moves.</Text>}
    </Box>
  )
}

function detourSection(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text } = ctx.el
  const d = s.detour
  const possible = [...s.suggestions].reverse().find(x => x.kind === 'detour')
  const ret = [...s.suggestions].reverse().find(x => x.kind === 'return')
  if (!d && !possible) return null
  if (d) {
    const cp = s.checkpoints.find(c => c.id === d.departure.checkpointId)
    const found = [d.outcomes.length ? `${d.outcomes.length} kept` : '', d.exclusions.length ? `${d.exclusions.length} excluded` : ''].filter(Boolean).join(' · ')
    return (
      <Box flexDirection="column">
        {heading(ctx, 'DETOUR', C.detour, ago(ctx.now - d.at))}
        <Box flexDirection="row" gap={1}>
          <Text color={GLYPH.detour.color}>{GLYPH.detour.char}</Text>
          <Text color={C.detour} wrap="wrap">{d.reason}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>returns to {d.departure.topic ?? d.departure.goal ?? 'the main path'}{cp ? ' ·' : ''}</Text>
          {cp ? <Text color={GLYPH.settledDecision.color}>{GLYPH.settledDecision.char}</Text> : null}
          {cp ? <Text dimColor>{cp.name}</Text> : null}
        </Box>
        {found ? <Text dimColor>{found}</Text> : null}
        {ret ? (
          <Box flexDirection="row" gap={1}>
            <Text color={GLYPH.returned.color}>{GLYPH.returned.char}</Text>
            <Text color={C.detour} wrap="truncate-end">{fit(ret.why ?? 'Looks like you are heading back', ctx.width)}</Text>
          </Box>
        ) : null}
        {actions(ctx, [
          { key: 'return', label: 'Return', act: { type: 'return' }, primary: true },
          { key: 'promote', label: 'Make it the goal', act: { type: 'promote' } },
          ...(ret ? [{ key: `stay-${ret.id}`, label: 'Stay', act: { type: 'dismiss', id: ret.id } as Action }] : []),
        ])}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {heading(ctx, 'POSSIBLE DETOUR', possible?.source === 'claude' && ctx.mode === 'engine' ? undefined : C.detour, undefined, possible?.source === 'claude' && ctx.mode === 'engine')}
      {possible?.source === 'claude' && ctx.mode === 'engine' ? (
        <>
          <Box flexDirection="row" gap={1}>
            <Text color={GLYPH.detour.color} dimColor>{GLYPH.detour.char}</Text>
            <Text dimColor wrap="truncate-end">{fit(possible.text, ctx.width)}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">{OBSERVER_NOTE}</Text>
          {actions(ctx, [{ key: 'turn-on-detour-observer', label: 'Turn on', primary: true, act: { type: 'open-setup' } }])}
        </>
      ) : possible ? suggestionRow(ctx, s, possible) : null}
    </Box>
  )
}

function activityRows(ctx: Ctx, s: AtlasSnapshot, max: number): LiveRow[] {
  return s.activity.slice(-max).map(a => {
    const running = a.state === 'running'
    const color = a.state === 'failed' ? C.fail : a.kind === 'edit' ? C.write : a.kind === 'read' || a.kind === 'search' ? C.read : a.kind === 'test' ? C.ok : a.kind === 'agent' ? C.checkpoint : undefined
    const tone = a.kind === 'edit' ? 'orange' : a.kind === 'test' ? 'green' : a.kind === 'agent' ? 'blue' : 'violet'
    const mark = running ? '' : a.state === 'failed' ? `${GLYPH.fail.char} ` : `${GLYPH.ok.char} `
    const markColor = running ? color : a.state === 'failed' ? GLYPH.fail.color : GLYPH.ok.color
    const label = fit(`${a.agent ? `${a.agent} · ` : ''}${a.label}`, ctx.width - 8)
    const segs: LiveSeg[] = [
      running ? { t: '', spin: true, c: color } : { t: mark, c: markColor, d: a.state === 'done' },
      { t: label, c: running ? undefined : a.state === 'failed' ? C.fail : undefined, d: !running && a.state === 'done', sh: running ? tone : undefined, b: running },
      { t: running ? '' : `  ${ago(ctx.now - (a.endedAt ?? a.at))}`, d: true },
    ]
    return { segs }
  })
}

function activitySection(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text } = ctx.el
  const rows = activityRows(ctx, s, 6)
  const running = s.activity.filter(a => a.state === 'running').length
  return (
    <Box flexDirection="column">
      {heading(ctx, 'ACTIVITY', undefined, running ? `${running} running` : undefined)}
      {rows.length ? ctx.live('activity', rows) : <Text dimColor>Waiting for Claude to work.</Text>}
    </Box>
  )
}

function fileLine(ctx: Ctx, s: AtlasSnapshot, f: AtlasSnapshot['files'][number], key: string, full: boolean) {
  const { Box, Text } = ctx.el
  const name = full ? rel(f.path, s.root) : base(f.path)
  const details = [
    ...(name.length > Math.max(24, ctx.width - 14) ? [`path: ${rel(f.path, s.root)}`] : []),
    'kind: working-set file',
    `last operation: ${f.lastOp}`,
    `counts: ${f.reads} read · ${f.writes} written`,
    whenLine(ctx, f.at, f.turn),
  ]
  return (
    <Box key={key} flexDirection="row">
      <Text color={f.lastOp === 'write' ? GLYPH.editedFile.color : GLYPH.readFile.color}>{f.lastOp === 'write' ? GLYPH.editedFile.char : GLYPH.readFile.char}</Text>
      <Box flexShrink={1}>{selectable(ctx, `sel-${key}`, { kind: 'File', id: f.path, text: rel(f.path, s.root) }, fit(name, ctx.width - 14), undefined, false, details)}</Box>
      <Box flexGrow={1} />
      <Box flexDirection="row" gap={1}>
        {f.writes ? <><Text color={GLYPH.editedFile.color}>{GLYPH.editedFile.char}</Text><Text dimColor>{f.writes}</Text></> : null}
        {f.reads ? <><Text color={GLYPH.readFile.color}>{GLYPH.readFile.char}</Text><Text dimColor>{f.reads}</Text></> : null}
      </Box>
    </Box>
  )
}

function filesSection(ctx: Ctx, s: AtlasSnapshot) {
  const { Box } = ctx.el
  const recent = [...s.files].sort((a, b) => b.at - a.at).slice(0, 5)
  if (!recent.length) return null
  return (
    <Box flexDirection="column">
      {heading(ctx, 'WORKING SET', undefined, `${s.files.length} files`)}
      {recent.map(f => fileLine(ctx, s, f, `f-${f.path}`, false))}
    </Box>
  )
}

function nextSection(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text } = ctx.el
  const hint = resumeHint(s)
  const suggestion = [...s.suggestions].reverse().find(x => x.kind === 'next')
  if (!hint) return null
  const pinnable = hint.source === 'suggested' && suggestion
  const needsObserver = Boolean(suggestion && suggestion.source === 'claude' && ctx.mode === 'engine')
  return (
    <Box flexDirection="column">
      {heading(ctx, 'RESUME NEXT', needsObserver ? undefined : C.goal, needsObserver ? undefined : hint.source, needsObserver)}
      <Box flexDirection="row" gap={1}>
        <Text color={needsObserver ? undefined : GLYPH.next.color} dimColor={needsObserver}>{GLYPH.next.char}</Text>
        <Text dimColor={needsObserver} wrap="wrap" color={!needsObserver && hint.source === 'pinned' ? C.goal : undefined}>{hint.text}</Text>
      </Box>
      {needsObserver ? (
        <>
          <Text dimColor wrap="truncate-end">{OBSERVER_NOTE}</Text>
          {actions(ctx, [{ key: 'turn-on-next-observer', label: 'Turn on', primary: true, act: { type: 'open-setup' } }])}
        </>
      ) : pinnable
        ? actions(ctx, [
            { key: `pin-${suggestion.id}`, label: 'Pin as next step', act: { type: 'confirm', id: suggestion.id }, primary: true },
            { key: `nop-${suggestion.id}`, label: 'Dismiss', act: { type: 'dismiss', id: suggestion.id } },
          ])
        : null}
    </Box>
  )
}

function mapTab(ctx: Ctx, s: AtlasSnapshot) {
  const { Box } = ctx.el
  const decisions = activeDecisions(s).slice(-2)
  const questions = openQuestions(s).slice(-2)
  return (
    <Box flexDirection="column">
      {goalSection(ctx, s)}
      {pathSection(ctx, s)}
      {detourSection(ctx, s)}
      {activitySection(ctx, s)}
      {filesSection(ctx, s)}
      {decisions.length || questions.length ? heading(ctx, 'LATEST', undefined, 'confirm in Open') : null}
      {decisions.map(d => decisionRow(ctx, s, d, false))}
      {questions.map(q => questionRow(ctx, s, q, false))}
      {nextSection(ctx, s)}
    </Box>
  )
}

// ------------------------------------------------------------------ TRAIL

function treeLines(s: AtlasSnapshot): { topic: AtlasTopic; depth: number }[] {
  const out: { topic: AtlasTopic; depth: number }[] = []
  const children = new Map<string | null, AtlasTopic[]>()
  const ids = new Set(s.topics.map(t => t.id))
  for (const t of s.topics) {
    const parent = t.parentId && ids.has(t.parentId) ? t.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), t])
  }
  const walk = (parent: string | null, depth: number) => {
    for (const t of children.get(parent) ?? []) {
      out.push({ topic: t, depth })
      if (depth < 12) walk(t.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

const EVENT_GLYPH: Record<string, Glyph> = {
  prompt: GLYPH.prompt,
  topic: GLYPH.currentTopic,
  goal: GLYPH.goal,
  detour: GLYPH.detour,
  return: GLYPH.returned,
  promote: GLYPH.goal,
  decision: GLYPH.observedDecision,
  question: GLYPH.openQuestion,
  resolved: GLYPH.resolved,
  checkpoint: GLYPH.settledDecision,
  next: GLYPH.next,
  resume: GLYPH.resume,
  dismiss: GLYPH.readFile,
}

function trailTab(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text } = ctx.el
  const tree = treeLines(s)
  const cur = currentTopic(s)
  const events = ctx.view.trailNewest ? s.events.slice(-40).reverse() : s.events.slice(-40)
  const { Button } = ctx.el
  const sort = <Button key="trail-sort" plain dimColor label={ctx.view.trailNewest ? 'newest first' : 'oldest first'} onPress={() => ctx.act({ type: 'trail-sort' })} />
  const topicRows = tree.map(({ topic: t, depth }) => {
    const isCur = t.id === cur?.id
    const glyph = isCur ? GLYPH.currentTopic : t.kind !== 'main' ? GLYPH.detour : t.status === 'returned' ? GLYPH.returned : GLYPH.suggestion
    const color = t.kind !== 'main' ? C.detour : isCur ? C.path : undefined
    const children = s.topics.filter(x => x.parentId === t.id).length
    const decisions = s.decisions.filter(x => x.topicId === t.id).length
    const questions = s.questions.filter(x => x.topicId === t.id).length
    const details = [
      ...(t.title.length > Math.max(24, ctx.width - depth * 2 - 10) ? [`title: ${t.title}`] : []),
      `kind: ${t.kind}`,
      `status: ${t.status}`,
      `turns: ${t.firstTurn === t.lastTurn ? t.firstTurn : `${t.firstTurn}–${t.lastTurn}`}`,
      `children: ${children}`,
      `decisions: ${decisions} · questions: ${questions}`,
      `source: ${sourceName(t.source)}`,
    ]
    if (ctx.mode === 'engine' && t.source === 'claude') {
      return (
        <Box key={`tr-${t.id}`} flexDirection="row" gap={1}>
          <Text dimColor>{'  '.repeat(depth)}</Text>
          <Text color={glyph.color} dimColor>{glyph.char}</Text>
          <Text dimColor wrap="truncate-end">{fit(`${t.title}  t${t.firstTurn}`, ctx.width)}</Text>
        </Box>
      )
    }
    return (
      <Box key={`tr-${t.id}`} flexDirection="row">
        <Text dimColor>{'  '.repeat(depth)}</Text>
        <Box flexShrink={1}>{selectable(ctx, `tsel-${t.id}`, { kind: t.kind === 'main' ? 'Topic' : 'Detour topic', id: t.id, text: t.title }, fit(t.title, ctx.width - depth * 2 - 10), color, s.fresh.includes(t.id), details, [], glyph)}</Box>
        <Box flexGrow={1} />
        <Text dimColor>{t.firstTurn === t.lastTurn ? `t${t.firstTurn}` : `t${t.firstTurn}-${t.lastTurn}`}</Text>
      </Box>
    )
  })
  const needsObserver = ctx.mode === 'engine' && tree.some(({ topic }) => topic.source === 'claude')
  const prefix = (
    <Box flexDirection="column">
      {heading(ctx, 'MAP OF TOPICS', needsObserver ? undefined : C.trail, `${s.topics.length}`, needsObserver)}
      {needsObserver ? <Text dimColor wrap="truncate-end">{OBSERVER_NOTE}</Text> : null}
      {s.scanned !== 'claude' ? actions(ctx, [{ key: 'scan', label: ctx.mode === 'engine' ? 'Map earlier conversation (1 Claude request)' : 'Map earlier conversation', act: { type: 'scan' }, primary: true }]) : null}
      {tree.length === 0 ? <Text dimColor>No topics yet.</Text> : null}
      {topicRows}
      {heading(ctx, 'TRAIL', undefined, sort)}
      {events.length === 0 ? <Text dimColor>Nothing recorded yet.</Text> : null}
    </Box>
  )
  let eventOffset = rowsOf(prefix, ctx.width)
  const eventRows = events.map(ev => {
    const glyph = EVENT_GLYPH[ev.kind] ?? GLYPH.readFile
    const dim = ev.kind === 'prompt' || ev.kind === 'dismiss'
    const open = ctx.view.popup?.kind === 'event' && ctx.view.popup.id === ev.id
    const row = (
      <Box key={`ev-${ev.id}`} position="relative" flexDirection="row">
        <Text color={glyph.color} dimColor={dim}>{glyph.char}</Text>
        <Box flexShrink={1}>
          <Button key={`evb-${ev.id}`} plain dimColor={dim} label={fit(ev.text, ctx.width - 10)} onPress={() => ctx.act({ type: 'popup', popup: { kind: 'event', id: ev.id } })} />
        </Box>
        <Box flexGrow={1} />
        <Text dimColor>{ago(ctx.now - ev.at)}</Text>
        {open ? eventPopup(ctx, ev, eventOffset) : null}
      </Box>
    )
    eventOffset += rowsOf(row, ctx.width)
    return row
  })
  return <Box flexDirection="column">{prefix}{eventRows}</Box>
}

// ------------------------------------------------------------------ OPEN

function openTab(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text } = ctx.el
  const observed = s.decisions.filter(d => d.status === 'observed')
  const open = openQuestions(s)
  const empty = !s.suggestions.length && !observed.length && !open.length
  const inDetour = Boolean(s.detour) && observed.some(d => d.at >= (s.detour?.at ?? 0))
  return (
    <Box flexDirection="column">
      {empty ? <Text dimColor>Nothing waiting for you. Observations that need a yes or no land here.</Text> : null}
      {s.suggestions.length ? heading(ctx, 'NEEDS YOUR CALL', C.goal, `${s.suggestions.length}`) : null}
      {[...s.suggestions].reverse().map(x => suggestionRow(ctx, s, x))}
      {observed.length ? heading(ctx, inDetour ? 'DETOUR FINDINGS' : 'OBSERVED DECISIONS', C.decision, `${observed.length}`) : null}
      {[...observed].reverse().map(d => decisionRow(ctx, s, d, true))}
      {open.length ? heading(ctx, 'OPEN QUESTIONS', C.question, `${open.length}`) : null}
      {[...open].reverse().map(q => questionRow(ctx, s, q, true))}
    </Box>
  )
}

// ------------------------------------------------------------------ EVIDENCE

function checkpointLine(ctx: Ctx, s: AtlasSnapshot, c: AtlasCheckpoint) {
  const { Box, Text } = ctx.el
  const kind = c.kind === 'marked' ? 'mark' : c.kind === 'tests' ? 'tests ✓' : c.kind === 'claude' ? 'milestone' : c.kind
  const text = `${c.name}${c.topic ? ` (topic: ${c.topic})` : ''}${c.files.length ? `; files: ${c.files.map(base).join(', ')}` : ''}`
  const details = [
    ...(c.name.length > Math.max(24, ctx.width - 20) ? [`name: ${c.name}`] : []),
    `kind: ${kind}`,
    whenLine(ctx, c.at, c.turn),
    ...(c.goal ? [`goal: ${c.goal}`] : []),
    ...(c.topic ? [`topic: ${c.topic}`] : []),
    ...(c.files.length ? [`files: ${c.files.map(base).join(', ')}`] : []),
    ...(c.detail ? [`detail: ${c.detail}`] : []),
  ]
  return (
    <Box key={`cpl-${c.id}`} flexDirection="row">
      <Text color={GLYPH.settledDecision.color}>{GLYPH.settledDecision.char}</Text>
      <Box flexShrink={1}>{selectable(ctx, `csel-${c.id}`, { kind: 'Checkpoint', id: c.id, text }, fit(c.name, ctx.width - 20), C.checkpoint, s.fresh.includes(c.id), details, [], GLYPH.settledDecision)}</Box>
      <Box flexGrow={1} />
      <Text dimColor>{`${kind} · ${ago(ctx.now - c.at)}`}</Text>
    </Box>
  )
}

function checkpointRow(ctx: Ctx, s: AtlasSnapshot, c: AtlasCheckpoint) {
  return checkpointLine(ctx, s, c)
}

function recallRow(ctx: Ctx, s: AtlasSnapshot, r: AtlasRecall) {
  const { Box, Text } = ctx.el
  const done = s.adopted.includes(r.id)
  const where = `${r.source === 'trailhead' ? 'Trailhead' : 'Atlas'} · ${r.sessionId.slice(0, 8)} · ${ago(ctx.now - r.at)}`
  return (
    <Box key={`rc-${r.id}`} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={done ? GLYPH.ok.color : GLYPH.resume.color} dimColor={done}>{done ? GLYPH.ok.char : GLYPH.resume.char}</Text>
        <Text color={done ? undefined : C.goal} dimColor={done} wrap="truncate-end">{fit(r.goal ?? 'no goal recorded', ctx.width)}</Text>
      </Box>
      <Text dimColor wrap="truncate-end">
        {fit(`  ${where}${r.detour ? ` · on detour: ${r.detour}` : ''}${r.nextStep ? ` · next: ${r.nextStep}` : ''}`, ctx.width)}
      </Text>
      {done ? null : actions(ctx, [{ key: `adopt-${r.id}`, label: 'Resume this', act: { type: 'adopt', id: r.id }, primary: true }])}
    </Box>
  )
}

function evidenceTab(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text } = ctx.el
  const settled = s.decisions.filter(d => d.status === 'settled')
  const resolved = s.questions.filter(q => q.status === 'resolved').slice(-5)
  const files = [...s.files].sort((a, b) => b.writes - a.writes || b.at - a.at).slice(0, 12)
  return (
    <Box flexDirection="column">
      {heading(ctx, 'CHECKPOINTS', C.checkpoint, `${s.checkpoints.length}`)}
      {s.checkpoints.length === 0 ? <Text dimColor>Commits, passing tests after edits, milestones and your marks.</Text> : null}
      {[...s.checkpoints].reverse().slice(0, 12).map(c => checkpointRow(ctx, s, c))}
      {heading(ctx, 'SETTLED (LEDGER)', C.decision, `${settled.length}`)}
      {settled.length === 0 ? <Text dimColor>Decisions you settle become settled knowledge.</Text> : null}
      {settled.map(d => decisionRow(ctx, s, d, false))}
      {resolved.length ? heading(ctx, 'RESOLVED', C.question) : null}
      {resolved.map(q => questionRow(ctx, s, q, true))}
      {s.detourHistory.length ? heading(ctx, 'DETOURS', C.detour, `${s.detourHistory.length}`) : null}
      {s.detourHistory.slice(-5).map(d => (
        <Box key={`dh-${d.id}`} flexDirection="row" gap={1}>
          <Text color={(d.status === 'promoted' ? GLYPH.goal : GLYPH.returned).color}>{(d.status === 'promoted' ? GLYPH.goal : GLYPH.returned).char}</Text>
          <Text dimColor wrap="truncate-end">{fit(`${d.reason}${d.outcomes.length ? ` · ${d.outcomes.length} kept` : ''}${d.exclusions?.length ? ` · ${d.exclusions.length} excluded` : ''}`, ctx.width)}</Text>
        </Box>
      ))}
      {s.recall.length ? heading(ctx, 'EARLIER SESSIONS', C.goal, `${s.recall.length}`) : null}
      {s.recall.slice(0, 6).map(r => recallRow(ctx, s, r))}
      {heading(ctx, 'FILES', undefined, `${s.files.length}`)}
      {files.map(f => fileLine(ctx, s, f, `ef-${f.path}`, true))}
    </Box>
  )
}

// ------------------------------------------------------------------ pane

// A one-column scrollbar: ┃ thumb, │ track. Each cell is a button that jumps there.
function scrollbarCells(ctx: Ctx, viewport: number, content: number, at: number, maxScroll: number) {
  const { Box, Button } = ctx.el
  const size = Math.min(viewport, Math.max(1, Math.round((viewport * viewport) / content)))
  const top = Math.round((at / maxScroll) * (viewport - size))
  return (
    <Box flexDirection="column" width={1} flexShrink={0} height={viewport} overflow="hidden">
      {Array.from({ length: viewport }, (_, i) => {
        const thumb = i >= top && i < top + size
        return (
          <Button
            key={`sb-${i}`}
            plain
            dimColor={!thumb}
            label={thumb ? '┃' : '│'}
            onPress={() => ctx.act({ type: 'scroll-to', at: Math.round((i / Math.max(1, viewport - 1)) * maxScroll) })}
          />
        )
      })}
    </Box>
  )
}

// The whole pane. Returns the tree and how far the body can scroll, which the hooks
// module keeps to clamp the next wheel or page move.
export function pane(ctx: Ctx, s: AtlasSnapshot): { tree: RenderElement; maxScroll: number; maxPopupScroll: number } {
  const { Box, Text } = ctx.el
  if (ctx.view.setup) {
    const tree = (
      <Box flexDirection="column" paddingX={1}>
        {titleRule(ctx)}
        {setupScreen(ctx)}
      </Box>
    )
    return { tree, maxScroll: 0, maxPopupScroll: 0 }
  }
  const appRows = (() => {
    const decisions = activeDecisions(s).length
    const open = openQuestions(s).length
    const need = (labels: string[]) => labels.reduce((n, label, i) => n + label.length + (i ? 1 : 0), 0)
    const tiny = ['≡', `◇${decisions}→`, `?${open}→`, '+ Mark']
    return 1 + (need(tiny) > ctx.width ? 1 : 0)
  })()
  // The Legend toggle opens a panel pinned just above the bottom bar, outside the scrolling body.
  const legend = ctx.view.legend ? legendPanel(ctx) : null
  const legendRows = legend ? Math.min(rowsOf(legend, ctx.width), Math.max(4, Math.floor(ctx.rows * 0.5))) : 0
  const fixed = 1 + tabBarRows(ctx, s, { max: 1 }) + 1 + appRows + legendRows
  const viewport = ctx.rows - fixed
  const pinned = viewport >= 4
  const bodyCtx: Ctx = { ...ctx, bodyViewport: viewport }
  const build = (c: Ctx) => {
    const content = c.view.tab === 'trail' ? trailTab(c, s) : c.view.tab === 'open' ? openTab(c, s) : c.view.tab === 'evidence' ? evidenceTab(c, s) : mapTab(c, s)
    return content
  }
  let body = build(bodyCtx)
  let content = rowsOf(body, ctx.width)
  const bar = pinned && content > viewport
  const drawCtx = bar ? { ...bodyCtx, width: ctx.width - 2 } : bodyCtx
  if (bar) {
    // Leave a column for the scrollbar: draw and measure the body at the narrower width.
    body = build(drawCtx)
    content = rowsOf(body, ctx.width - 2)
  }
  const maxScroll = pinned ? Math.max(0, content - viewport) : 0
  const at = Math.min(Math.max(0, ctx.view.scroll), maxScroll)
  const scrollbar = bar && maxScroll > 0 ? scrollbarCells(ctx, viewport, content, at, maxScroll) : null
  const maxPopupScroll = popupScrollLimit(ctx.view.tab === 'trail' && bar ? drawCtx : bodyCtx, s)
  const rule = <Text dimColor>{'─'.repeat(Math.max(4, ctx.width))}</Text>
  const tree = (
    <Box flexDirection="column" paddingX={1} {...(pinned ? { height: ctx.rows } : {})}>
      {titleRule(ctx)}
      {tabBar(ctx, s, { at, max: maxScroll, page: Math.max(1, viewport - 2) })}
      {pinned ? (
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
      )}
      {rule}
      {legend ? (
        <Box flexDirection="column" flexShrink={0} height={legendRows} overflow="hidden">
          {legend}
        </Box>
      ) : null}
      {appBar(ctx, s)}
    </Box>
  )
  return { tree, maxScroll, maxPopupScroll }
}

// One-line text for the footer button.
export function oneLine(s: AtlasSnapshot): string {
  const cur = currentTopic(s)
  if (s.detour) return `↳ ${s.detour.reason}`
  if (cur) return `● ${cur.title}`
  if (s.goal) return `◎ ${s.goal.text}`
  return 'Atlas'
}
