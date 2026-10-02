// The atlas pane, drawn from a snapshot. Pure apart from the `act` callback it hands to
// Buttons; the hooks module turns each action into a state write.
//
// Visual grammar, kept the same on every tab:
//   ◎ confirmed intent (goal)       ○ suggested, waiting for you
//   ● where the conversation is     ↳ detour (amber)        ↩ return
//   ◇ observed decision             ◆ settled decision / checkpoint
//   ? open question                 ✦ just observed

import type { Elements, RenderElement } from 'claude-code'

import type { AtlasCheckpoint, AtlasItem, AtlasSelection, AtlasSnapshot, AtlasSuggestion, AtlasTab, AtlasTopic, AtlasView } from '../types'
import { base, rel } from './activity'
import type { LiveRow, LiveSeg } from './live'
import { activeDecisions, currentTopic, openQuestions, pathOf, resumeHint } from './model'

export const C = {
  goal: '#7dcfff',
  path: '#bb9af7',
  detour: '#e0af68',
  decision: '#9ece6a',
  question: '#f7768e',
  checkpoint: '#7aa2f7',
  fail: '#f7768e',
  ok: '#9ece6a',
  read: '#bb9af7',
  write: '#ff9e64',
} as const

export const TONES: Record<string, string[]> = {
  violet: ['#6d5a9c', '#8f78c9', '#b9a3f0', '#efe6ff'],
  orange: ['#9c5a2c', '#c9783e', '#f0a46e', '#fff0e0'],
  amber: ['#8c6a2c', '#b8903e', '#e0b86e', '#fff4d6'],
  green: ['#4f7a3a', '#6fa052', '#9ece6a', '#e8ffd6'],
  blue: ['#3d5a9c', '#5a7ac9', '#8aa8f0', '#e0eaff'],
}

export type Action =
  | { type: 'tab'; tab: AtlasTab }
  | { type: 'confirm'; id: string }
  | { type: 'dismiss'; id: string }
  | { type: 'settle'; id: string }
  | { type: 'drop'; id: string }
  | { type: 'resolve'; id: string }
  | { type: 'reopen'; id: string }
  | { type: 'select'; selection: AtlasSelection }
  | { type: 'unselect' }
  | { type: 'return' }
  | { type: 'promote' }
  | { type: 'mark' }
  | { type: 'goal'; text: string }
  | { type: 'pin'; text: string }
  | { type: 'edit-goal' }

type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & { Input?: Elements['terminal']['Input'] }

export type Ctx = {
  el: El
  width: number
  now: number
  view: AtlasView
  live: (key: string, rows: LiveRow[]) => RenderElement
  act: (action: Action) => void
}

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

// ------------------------------------------------------------------ small parts

function heading(ctx: Ctx, label: string, color?: string, right?: string) {
  const { Box, Text } = ctx.el
  return (
    <Box flexDirection="row" marginTop={1}>
      <Text bold color={color}>
        {label}
      </Text>
      <Box flexGrow={1} />
      {right ? <Text dimColor>{right}</Text> : null}
    </Box>
  )
}

function selectable(ctx: Ctx, key: string, selection: AtlasSelection, label: string, color?: string, fresh = false) {
  const { Button } = ctx.el
  const isSelected = ctx.view.selected?.id === selection.id
  const text = fit(`${fresh ? '✦ ' : ''}${label}`, ctx.width - 2)
  return (
    <Button
      key={key}
      plain
      dimColor={!isSelected && !fresh && !color}
      label={isSelected ? `▸ ${text}` : text}
      onPress={() => ctx.act(isSelected ? { type: 'unselect' } : { type: 'select', selection })}
    />
  )
}

function actions(ctx: Ctx, items: { key: string; label: string; act: Action; primary?: boolean }[]) {
  const { Box, Button } = ctx.el
  return (
    <Box flexDirection="row" gap={1} marginLeft={2} flexWrap="wrap">
      {items.map(i => (
        <Button key={i.key} label={i.label} variant={i.primary ? 'primary' : undefined} onPress={() => ctx.act(i.act)} />
      ))}
    </Box>
  )
}

function suggestionRow(ctx: Ctx, s: AtlasSnapshot, x: AtlasSuggestion) {
  const { Box, Text } = ctx.el
  const fresh = s.fresh.includes(x.id)
  const confirm: Record<AtlasSuggestion['kind'], string> = { goal: 'Set as goal', detour: 'Take detour', return: 'Return', next: 'Pin next', resume: 'Resume' }
  const dismiss: Record<AtlasSuggestion['kind'], string> = { goal: '✕', detour: 'Not a detour', return: 'Stay', next: '✕', resume: '✕' }
  const glyph = x.kind === 'detour' ? '↳' : x.kind === 'return' ? '↩' : '○'
  const color = x.kind === 'detour' || x.kind === 'return' ? C.detour : x.kind === 'goal' || x.kind === 'resume' ? C.goal : undefined
  return (
    <Box key={`sg-${x.id}`} flexDirection="column">
      <Text color={color} bold={fresh} wrap="truncate-end">
        {`${glyph} ${fresh ? '✦ ' : ''}${fit(x.text, ctx.width - 4)}`}
      </Text>
      {x.why ? (
        <Text dimColor wrap="truncate-end">
          {`  ${fit(`${x.why} · ${x.source === 'claude' ? 'Claude' : x.source === 'cue' ? 'your words' : 'atlas'}`, ctx.width - 2)}`}
        </Text>
      ) : null}
      {actions(ctx, [
        { key: `ok-${x.id}`, label: confirm[x.kind], act: { type: 'confirm', id: x.id }, primary: true },
        { key: `no-${x.id}`, label: dismiss[x.kind], act: { type: 'dismiss', id: x.id } },
      ])}
    </Box>
  )
}

function decisionRow(ctx: Ctx, s: AtlasSnapshot, d: AtlasItem, withActions: boolean) {
  const { Box } = ctx.el
  const settled = d.status === 'settled'
  return (
    <Box key={`d-${d.id}`} flexDirection="column">
      {selectable(ctx, `dsel-${d.id}`, { kind: settled ? 'Settled decision' : 'Observed decision', id: d.id, text: d.text }, `${settled ? '◆' : '◇'} ${d.text}`, settled ? C.decision : undefined, s.fresh.includes(d.id))}
      {withActions && !settled
        ? actions(ctx, [
            { key: `set-${d.id}`, label: 'Settle', act: { type: 'settle', id: d.id }, primary: true },
            { key: `drp-${d.id}`, label: 'Drop', act: { type: 'drop', id: d.id } },
          ])
        : null}
    </Box>
  )
}

function questionRow(ctx: Ctx, s: AtlasSnapshot, q: AtlasItem, withActions: boolean) {
  const { Box } = ctx.el
  const open = q.status === 'open'
  return (
    <Box key={`q-${q.id}`} flexDirection="column">
      {selectable(ctx, `qsel-${q.id}`, { kind: 'Open question', id: q.id, text: q.text }, `${open ? '?' : '✓'} ${q.text}`, open ? C.question : undefined, s.fresh.includes(q.id))}
      {withActions
        ? actions(ctx, [open ? { key: `res-${q.id}`, label: 'Resolved', act: { type: 'resolve', id: q.id } } : { key: `reo-${q.id}`, label: 'Reopen', act: { type: 'reopen', id: q.id } }])
        : null}
    </Box>
  )
}

// ------------------------------------------------------------------ header & footer

function tabs(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Button } = ctx.el
  const pending = s.suggestions.length + s.decisions.filter(d => d.status === 'observed').length + openQuestions(s).length
  const list: { tab: AtlasTab; label: string; hotkey: string }[] = [
    { tab: 'map', label: 'Map', hotkey: 'm' },
    { tab: 'trail', label: 'Trail', hotkey: 't' },
    { tab: 'open', label: pending ? `Open ${pending}` : 'Open', hotkey: 'o' },
    { tab: 'evidence', label: 'Evidence', hotkey: 'e' },
  ]
  return (
    <Box flexDirection="row" gap={1}>
      {list.map(t => (
        <Button key={`tab-${t.tab}`} hotkey={t.hotkey} label={t.label} variant={ctx.view.tab === t.tab ? 'primary' : undefined} dimColor={ctx.view.tab !== t.tab} onPress={() => ctx.act({ type: 'tab', tab: t.tab })} />
      ))}
    </Box>
  )
}

function counts(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text, Button } = ctx.el
  const decisions = activeDecisions(s).length
  const open = openQuestions(s).length
  const checkpoints = s.checkpoints.length
  return (
    <Box flexDirection="row" marginTop={1}>
      <Text color={C.decision}>{`◇ ${decisions}`}</Text>
      <Text dimColor>{' decisions  '}</Text>
      <Text color={C.question}>{`? ${open}`}</Text>
      <Text dimColor>{' open  '}</Text>
      <Text color={C.checkpoint}>{`◆ ${checkpoints}`}</Text>
      <Text dimColor>{' checkpoints'}</Text>
      <Box flexGrow={1} />
      <Button key="mark" plain hotkey="k" label="Mark" onPress={() => ctx.act({ type: 'mark' })} />
    </Box>
  )
}

function selectionFooter(ctx: Ctx) {
  const { Box, Text, Button } = ctx.el
  const sel = ctx.view.selected
  if (!sel) return null
  return (
    <Box flexDirection="row" marginTop={1}>
      <Box flexShrink={1}>
        <Text color={C.goal} wrap="truncate-end">
          {fit(`→ Claude sees with your next message: ${sel.kind.toLowerCase()} "${sel.text}"`, ctx.width - 4)}
        </Text>
      </Box>
      <Box flexGrow={1} />
      <Button key="unselect" plain label="✕" onPress={() => ctx.act({ type: 'unselect' })} />
    </Box>
  )
}

// ------------------------------------------------------------------ MAP

function goalSection(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text, Input, Button } = ctx.el
  const suggestion = [...s.suggestions].reverse().find(x => x.kind === 'goal' || x.kind === 'resume')
  const editing = ctx.view.editingGoal || (!s.goal && !suggestion)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold color={C.goal}>
          ◎ GOAL
        </Text>
        <Box flexGrow={1} />
        {s.goal && !s.detour && !ctx.view.editingGoal ? <Button key="edit-goal" plain dimColor label="change" onPress={() => ctx.act({ type: 'edit-goal' })} /> : null}
      </Box>
      {s.goal ? (
        <Text bold wrap="wrap">
          {s.goal.text}
        </Text>
      ) : (
        <Text dimColor>not confirmed yet</Text>
      )}
      {!s.goal && suggestion ? suggestionRow(ctx, s, suggestion) : null}
      {editing && Input ? (
        <Input key="goal-input" label="◎ " placeholder={s.goal ? 'new goal, Enter to confirm' : 'type your goal, Enter to confirm'} submitLabel="set" onSubmit={(v: string) => ctx.act({ type: 'goal', text: v })} />
      ) : null}
    </Box>
  )
}

function pathRows(ctx: Ctx, s: AtlasSnapshot): LiveRow[] {
  const chain = pathOf(s)
  const rows: LiveRow[] = []
  chain.forEach((t, i) => {
    const isCur = i === chain.length - 1
    const indent = i === 0 ? '' : `${'   '.repeat(i - 1)}└─ `
    const color = t.kind === 'main' ? (isCur ? C.path : undefined) : C.detour
    const glyph = isCur ? '● ' : t.kind !== 'main' ? '↳ ' : ''
    const fresh = s.fresh.includes(t.id)
    const segs: LiveSeg[] = [
      { t: indent, d: true },
      { t: glyph, c: color, b: isCur },
      { t: fit(t.title, ctx.width - indent.length - 4), c: isCur ? color : undefined, b: isCur, d: !isCur, sh: fresh ? (t.kind === 'main' ? 'violet' : 'amber') : undefined },
    ]
    rows.push({ segs })
  })
  return rows
}

function pathSection(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text } = ctx.el
  const rows = pathRows(ctx, s)
  const left = s.topics.filter(t => t.status === 'left').length
  return (
    <Box flexDirection="column">
      {heading(ctx, 'CURRENT PATH', C.path, left ? `${left} earlier` : undefined)}
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
    return (
      <Box flexDirection="column">
        {heading(ctx, '↳ DETOUR', C.detour, ago(ctx.now - d.at))}
        <Text color={C.detour} wrap="wrap">
          {d.reason}
        </Text>
        <Text dimColor wrap="truncate-end">
          {fit(`returns to ${d.departure.topic ?? d.departure.goal ?? 'the main path'}${cp ? ` · ◆ ${cp.name}` : ''}`, ctx.width)}
        </Text>
        {d.outcomes.length ? <Text dimColor>{`${d.outcomes.length} accepted outcome${d.outcomes.length > 1 ? 's' : ''}`}</Text> : null}
        {ret ? (
          <Text color={C.detour} wrap="truncate-end">
            {fit(`↩ ${ret.why ?? 'Looks like you are heading back'}`, ctx.width)}
          </Text>
        ) : null}
        {actions(ctx, [
          { key: 'return', label: 'Return', act: { type: 'return' }, primary: Boolean(ret) },
          { key: 'promote', label: 'Make it the goal', act: { type: 'promote' } },
          ...(ret ? [{ key: `stay-${ret.id}`, label: 'Stay', act: { type: 'dismiss', id: ret.id } as Action }] : []),
        ])}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {heading(ctx, '↳ POSSIBLE DETOUR', C.detour)}
      {possible ? suggestionRow(ctx, s, possible) : null}
    </Box>
  )
}

function activityRows(ctx: Ctx, s: AtlasSnapshot, max: number): LiveRow[] {
  const recent = s.activity.slice(-max)
  return recent.map(a => {
    const running = a.state === 'running'
    const color = a.state === 'failed' ? C.fail : a.kind === 'edit' ? C.write : a.kind === 'read' || a.kind === 'search' ? C.read : a.kind === 'test' ? C.ok : a.kind === 'agent' ? C.checkpoint : undefined
    const tone = a.kind === 'edit' ? 'orange' : a.kind === 'test' ? 'green' : a.kind === 'agent' ? 'blue' : 'violet'
    const mark = running ? '' : a.state === 'failed' ? '✗ ' : '✓ '
    const who = a.agent ? `${a.agent} · ` : ''
    const label = fit(`${who}${a.label}`, ctx.width - 8)
    const segs: LiveSeg[] = [
      running ? { t: '', spin: true, c: color } : { t: mark, c: color, d: a.state === 'done' },
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

function filesSection(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text } = ctx.el
  const recent = [...s.files].sort((a, b) => b.at - a.at).slice(0, 5)
  if (!recent.length) return null
  return (
    <Box flexDirection="column">
      {heading(ctx, 'WORKING SET', undefined, `${s.files.length} files`)}
      {recent.map(f => (
        <Box key={`f-${f.path}`} flexDirection="row">
          <Text color={f.lastOp === 'write' ? C.write : C.read}>{f.lastOp === 'write' ? '✎ ' : '· '}</Text>
          <Box flexShrink={1}>{selectable(ctx, `fsel-${f.path}`, { kind: 'File', id: f.path, text: rel(f.path, s.root) }, fit(base(f.path), ctx.width - 14))}</Box>
          <Box flexGrow={1} />
          <Text dimColor>{`${f.writes ? `✎${f.writes} ` : ''}${f.reads ? `·${f.reads}` : ''}`}</Text>
        </Box>
      ))}
    </Box>
  )
}

function nextSection(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text } = ctx.el
  const hint = resumeHint(s)
  const suggestion = [...s.suggestions].reverse().find(x => x.kind === 'next')
  if (!hint) return null
  const pinnable = hint.source === 'suggested' && suggestion
  return (
    <Box flexDirection="column">
      {heading(ctx, 'RESUME NEXT', C.goal, hint.source)}
      <Text wrap="wrap" color={hint.source === 'pinned' ? C.goal : undefined}>
        {`▸ ${hint.text}`}
      </Text>
      {pinnable ? actions(ctx, [
        { key: `pin-${suggestion.id}`, label: 'Pin as next step', act: { type: 'confirm', id: suggestion.id } },
        { key: `nop-${suggestion.id}`, label: '✕', act: { type: 'dismiss', id: suggestion.id } },
      ]) : null}
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
      {decisions.length || questions.length ? heading(ctx, 'LATEST', undefined, 'Open tab to confirm') : null}
      {decisions.map(d => decisionRow(ctx, s, d, false))}
      {questions.map(q => questionRow(ctx, s, q, false))}
      {nextSection(ctx, s)}
    </Box>
  )
}

// ------------------------------------------------------------------ TRAIL

function treeLines(s: AtlasSnapshot): { topic: AtlasTopic; depth: number }[] {
  const out: { topic: AtlasTopic; depth: number }[] = []
  const kids = new Map<string | null, AtlasTopic[]>()
  const ids = new Set(s.topics.map(t => t.id))
  for (const t of s.topics) {
    const parent = t.parentId && ids.has(t.parentId) ? t.parentId : null
    kids.set(parent, [...(kids.get(parent) ?? []), t])
  }
  const walk = (parent: string | null, depth: number) => {
    for (const t of kids.get(parent) ?? []) {
      out.push({ topic: t, depth })
      if (depth < 12) walk(t.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

const EVENT_GLYPH: Record<string, [string, string | undefined]> = {
  prompt: ['›', undefined],
  topic: ['●', C.path],
  goal: ['◎', C.goal],
  detour: ['↳', C.detour],
  return: ['↩', C.detour],
  promote: ['◎', C.detour],
  decision: ['◇', C.decision],
  question: ['?', C.question],
  resolved: ['✓', C.question],
  checkpoint: ['◆', C.checkpoint],
  next: ['▸', C.goal],
  resume: ['◎', C.goal],
  dismiss: ['·', undefined],
}

function trailTab(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text } = ctx.el
  const tree = treeLines(s)
  const cur = currentTopic(s)
  const events = s.events.slice(-40)
  return (
    <Box flexDirection="column">
      {heading(ctx, 'MAP OF TOPICS', C.path, `${s.topics.length}`)}
      {tree.length === 0 ? <Text dimColor>No topics yet.</Text> : null}
      {tree.map(({ topic: t, depth }) => {
        const isCur = t.id === cur?.id
        const glyph = isCur ? '●' : t.kind !== 'main' ? '↳' : t.status === 'returned' ? '↩' : '○'
        const color = t.kind !== 'main' ? C.detour : isCur ? C.path : undefined
        return (
          <Box key={`tr-${t.id}`} flexDirection="row">
            <Text dimColor>{'  '.repeat(depth)}</Text>
            <Text color={color} bold={isCur}>{`${glyph} `}</Text>
            <Box flexShrink={1}>{selectable(ctx, `tsel-${t.id}`, { kind: t.kind === 'main' ? 'Topic' : 'Detour topic', id: t.id, text: t.title }, fit(t.title, ctx.width - depth * 2 - 10), color)}</Box>
            <Box flexGrow={1} />
            <Text dimColor>{t.firstTurn === t.lastTurn ? `t${t.firstTurn}` : `t${t.firstTurn}-${t.lastTurn}`}</Text>
          </Box>
        )
      })}
      {heading(ctx, 'TRAIL', undefined, `turn ${s.turn}`)}
      {events.length === 0 ? <Text dimColor>Nothing recorded yet.</Text> : null}
      {events.map(ev => {
        const [glyph, color] = EVENT_GLYPH[ev.kind] ?? ['·', undefined]
        return (
          <Box key={`ev-${ev.id}`} flexDirection="row">
            <Text color={color}>{`${glyph} `}</Text>
            <Box flexShrink={1}>
              <Text dimColor={ev.kind === 'prompt' || ev.kind === 'dismiss'} wrap="truncate-end">
                {fit(ev.text, ctx.width - 8)}
              </Text>
            </Box>
            <Box flexGrow={1} />
            <Text dimColor>{ago(ctx.now - ev.at)}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

// ------------------------------------------------------------------ OPEN

function openTab(ctx: Ctx, s: AtlasSnapshot) {
  const { Box, Text } = ctx.el
  const observed = s.decisions.filter(d => d.status === 'observed')
  const open = openQuestions(s)
  const empty = !s.suggestions.length && !observed.length && !open.length
  return (
    <Box flexDirection="column">
      {empty ? <Text dimColor>Nothing waiting for you. Observations that need a yes or no land here.</Text> : null}
      {s.suggestions.length ? heading(ctx, 'NEEDS YOUR CALL', C.goal, `${s.suggestions.length}`) : null}
      {[...s.suggestions].reverse().map(x => suggestionRow(ctx, s, x))}
      {observed.length ? heading(ctx, 'OBSERVED DECISIONS', C.decision, 'settle what is true') : null}
      {[...observed].reverse().map(d => decisionRow(ctx, s, d, true))}
      {open.length ? heading(ctx, 'OPEN QUESTIONS', C.question, `${open.length}`) : null}
      {[...open].reverse().map(q => questionRow(ctx, s, q, true))}
    </Box>
  )
}

// ------------------------------------------------------------------ EVIDENCE

function checkpointRow(ctx: Ctx, s: AtlasSnapshot, c: AtlasCheckpoint) {
  const { Box, Text } = ctx.el
  const isSelected = ctx.view.selected?.id === c.id
  const kind = c.kind === 'marked' ? 'mark' : c.kind === 'tests' ? 'tests ✓' : c.kind
  return (
    <Box key={`cp-${c.id}`} flexDirection="column">
      <Box flexDirection="row">
        <Text color={C.checkpoint}>◆ </Text>
        <Box flexShrink={1}>{selectable(ctx, `csel-${c.id}`, { kind: 'Checkpoint', id: c.id, text: `${c.name}${c.topic ? ` (topic: ${c.topic})` : ''}${c.files.length ? `; files: ${c.files.map(base).join(', ')}` : ''}` }, fit(c.name, ctx.width - 18), C.checkpoint, s.fresh.includes(c.id))}</Box>
        <Box flexGrow={1} />
        <Text dimColor>{`${kind} · ${ago(ctx.now - c.at)}`}</Text>
      </Box>
      {isSelected ? (
        <Box flexDirection="column" marginLeft={2}>
          {c.goal ? <Text dimColor wrap="truncate-end">{fit(`goal: ${c.goal}`, ctx.width - 2)}</Text> : null}
          {c.topic ? <Text dimColor wrap="truncate-end">{fit(`topic: ${c.topic}`, ctx.width - 2)}</Text> : null}
          {c.detail ? <Text dimColor wrap="truncate-end">{fit(c.detail, ctx.width - 2)}</Text> : null}
          {c.files.length ? <Text dimColor wrap="wrap">{`files: ${c.files.map(base).join(', ')}`}</Text> : null}
        </Box>
      ) : null}
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
        <Text key={`dh-${d.id}`} dimColor wrap="truncate-end">
          {fit(`${d.status === 'promoted' ? '◎' : '↩'} ${d.reason}${d.outcomes.length ? ` · ${d.outcomes.length} outcomes` : ''}`, ctx.width)}
        </Text>
      ))}
      {heading(ctx, 'FILES', undefined, `${s.files.length}`)}
      {files.map(f => (
        <Box key={`ef-${f.path}`} flexDirection="row">
          <Box flexShrink={1}>{selectable(ctx, `efsel-${f.path}`, { kind: 'File', id: f.path, text: rel(f.path, s.root) }, fit(rel(f.path, s.root), ctx.width - 10), f.writes ? C.write : undefined)}</Box>
          <Box flexGrow={1} />
          <Text dimColor>{`${f.writes ? `✎${f.writes} ` : ''}${f.reads ? `·${f.reads}` : ''}`}</Text>
        </Box>
      ))}
    </Box>
  )
}

// ------------------------------------------------------------------ pane

export function pane(ctx: Ctx, s: AtlasSnapshot) {
  const { Box } = ctx.el
  const body = ctx.view.tab === 'trail' ? trailTab(ctx, s) : ctx.view.tab === 'open' ? openTab(ctx, s) : ctx.view.tab === 'evidence' ? evidenceTab(ctx, s) : mapTab(ctx, s)
  return (
    <Box flexDirection="column" paddingX={1}>
      {tabs(ctx, s)}
      {body}
      {counts(ctx, s)}
      {selectionFooter(ctx)}
    </Box>
  )
}

// One-line text for the footer button and the inline fallback.
export function oneLine(s: AtlasSnapshot): string {
  const cur = currentTopic(s)
  if (s.detour) return `↳ ${s.detour.reason}`
  if (cur) return `● ${cur.title}`
  if (s.goal) return `◎ ${s.goal.text}`
  return 'Atlas'
}
