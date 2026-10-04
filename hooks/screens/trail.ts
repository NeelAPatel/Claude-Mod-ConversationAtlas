// Shows the observed topic map and chronological event trail. Pure; no `$`.

import { collapseEvents, similar, sentences } from '../model'
import type { AtlasEvent, AtlasSnapshot, AtlasSource } from '../../types'
import { ago, action, filterHiddenRows, topicRows } from './shared'
import type { ScreenBuilder, ScreenModel, ScreenPopup, ScreenRow, ScreenSection } from './types'

const explain: Record<string, string> = {
  'MAP OF TOPICS':
    'Every topic so far, nested where it branched. Click one for its kind, status, turns, children, decisions, questions and actions.',
}

const help: Record<string, string[]> = {
  'MAP OF TOPICS': [
    'The observed topic tree for this session.',
    '● marks the current topic; ○ is a normal topic; ↳/↩ show detour movement.',
    'Indentation shows parent and child topics; counts show topic coverage.',
    'Press a topic for status, turns, children and related items.',
  ],
}

const trailHelp = [
  'A chronological record of prompts, topics, decisions and checkpoints.',
  'Press an event to open its full text and points.',
  'Story groups each turn; Log lists today\'s events one per line.',
  'Marks: › you · ✻ Claude · ⌬ Codex. Dim italic rows are observations or guesses.',
  'Use ≡ for Trail settings: view, order and hidden types.',
  'The heading button opens this fuller explanation.',
  'Press the heading again to close it; row detail shares this one-open slot.',
  '≡ Trail settings · ✕ close · ‹ › or wheel for pages.',
]

const trailExplain =
  'A chronological record of prompts, topics, decisions and checkpoints. Use ≡ for Trail settings: view, order and hidden types. ' +
  '↑ = newest first; ↓ = oldest first. Marks: › you · ✻ Claude · ⌬ Codex.'

export const SOURCE_MARK: Record<AtlasSource | 'codex', { mark: string; color: string }> = {
  person: { mark: '›', color: '#7dcfff' },
  cue: { mark: '›', color: '#7dcfff' },
  claude: { mark: '✻', color: '#d97757' },
  engine: { mark: '', color: '#7aa2f7' },
  codex: { mark: '⌬', color: '#7c8cff' },
}

const EVENT_GLYPH: Record<AtlasEvent['kind'], ScreenRow['glyph']> = {
  checkpoint: 'checkpoint',
  handoff: 'handoff',
  'report-back': 'reportBack',
  prompt: undefined,
  topic: 'currentTopic',
  return: 'returned',
  detour: 'detour',
  decision: 'observedDecision',
  question: 'openQuestion',
  resolved: 'resolved',
  goal: 'goal',
  promote: 'goal',
  next: 'next',
  resume: 'resume',
  dismiss: 'readFile',
}

export function eventText(text: string): string {
  return text
    .replace(/<task-id\b[^>]*>[\s\S]*?<\/task-id>/gi, '')
    .replace(/^\s*(?:[→←]\s*)+/, '')
    .replace(/\$[A-Za-z_][\w-]*[\\/][^\s·]*/g, value => {
      const name = value.replace(/\\/g, '/').split('/').at(-1)
      return name && name !== '…' ? name : 'handoff report'
    })
    .trim()
}

function checkpointSource(snapshot: AtlasSnapshot, event: AtlasEvent): AtlasSource | null {
  if (event.kind !== 'checkpoint') return null
  const text = eventText(event.text)
  const checkpoint = [...snapshot.checkpoints]
    .reverse()
    .find(candidate => candidate.turn === event.turn && (text.includes(candidate.name) || candidate.name.includes(text)))
  if (!checkpoint) return 'engine'
  return checkpoint.kind === 'marked' ? 'person' : checkpoint.kind === 'claude' ? 'claude' : 'engine'
}

function itemSource(snapshot: AtlasSnapshot, event: AtlasEvent): AtlasSource | null {
  if (event.kind !== 'decision' && event.kind !== 'question' && event.kind !== 'resolved') return null
  const text = eventText(event.text).replace(/^(?:Settled|Excluded|Resolved|Reopened|Dropped|Marked):\s*/i, '')
  const items = [...snapshot.decisions, ...snapshot.questions]
  return [...items].reverse().find(item => item.turn === event.turn && similar(item.text, text))?.source ?? null
}

function topicSource(snapshot: AtlasSnapshot, event: AtlasEvent): AtlasSource | null {
  if (event.kind !== 'topic' && event.kind !== 'return') return null
  const text = eventText(event.text).replace(/^(?:Possible detour|Topic|Back to):\s*/i, '')
  return [...snapshot.topics]
    .reverse()
    .find(topic => topic.firstTurn <= event.turn && topic.lastTurn >= event.turn && similar(topic.title, text))?.source ?? null
}

function sourceForEvent(snapshot: AtlasSnapshot, event: AtlasEvent): AtlasSource {
  const personKinds: AtlasEvent['kind'][] = ['prompt', 'goal', 'next', 'detour', 'promote', 'resume', 'dismiss']
  if (personKinds.includes(event.kind)) return 'person'
  if (event.kind === 'handoff' || event.kind === 'report-back') return 'engine'
  return checkpointSource(snapshot, event) ?? itemSource(snapshot, event) ?? topicSource(snapshot, event) ?? 'engine'
}

function isGuess(snapshot: AtlasSnapshot, event: AtlasEvent, source: AtlasSource): boolean {
  if (event.kind === 'topic' || event.kind === 'question' || event.kind === 'resolved') return source !== 'person'
  if (event.kind !== 'decision') return source === 'cue'
  const text = eventText(event.text).replace(/^(?:Settled|Excluded|Resolved|Reopened|Dropped|Marked):\s*/i, '')
  const item = [...snapshot.decisions, ...snapshot.questions].reverse().find(candidate => candidate.turn === event.turn && similar(candidate.text, text))
  return source !== 'person' || item?.status === 'observed'
}

function sourceDetails(snapshot: AtlasSnapshot, event: AtlasEvent): { mark: string; color: string; guess: boolean } {
  const source = sourceForEvent(snapshot, event)
  const markSource = event.kind === 'handoff' || event.kind === 'report-back' ? 'codex' : source
  return { ...SOURCE_MARK[markSource], guess: isGuess(snapshot, event, source) }
}

export function trailSourceMark(snapshot: AtlasSnapshot, event: AtlasEvent): string {
  return sourceDetails(snapshot, event).mark
}

function eventRow(snapshot: AtlasSnapshot, event: AtlasEvent, now: number): ScreenRow {
  const text = eventText(event.text)
  const source = sourceDetails(snapshot, event)
  const guess = source.guess
  return {
    id: event.id,
    key: `evb-${event.id}`,
    kind: 'event',
    glyph: EVENT_GLYPH[event.kind],
    sourceMark: source.mark,
    sourceMarkColor: source.color,
    text: event.kind === 'prompt' ? (text.split(/\r?\n/)[0] ?? text) : text,
    meta: `turn ${event.turn}`,
    right: ago(now - event.at),
    detail: [
      `kind: ${event.kind}`, `turn: ${event.turn}`, `when: ${ago(now - event.at)}`,
      [source.mark, text].filter(Boolean).join(' '),
    ],
    fullText: [text, ...(event.detail ?? [])].filter(Boolean).join('\n'),
    dim: event.kind === 'prompt' || guess,
    italic: guess,
    tone:
      event.kind === 'checkpoint'
        ? 'checkpoint'
        : event.kind === 'prompt'
          ? undefined
          : event.kind === 'question'
            ? 'question'
            : event.kind === 'decision'
              ? 'decision'
              : undefined,
    expandable: true,
    interactive: true,
  }
}

function startOfToday(now: number): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function recentEvents(snapshot: AtlasSnapshot, now: number): AtlasEvent[] {
  return collapseEvents(snapshot.events.filter(event => event.at >= startOfToday(now)).slice(-40))
}

function orderedEvents(snapshot: AtlasSnapshot, view: { trailNewest: boolean }, now: number): AtlasEvent[] {
  const events = recentEvents(snapshot, now)
  return view.trailNewest ? events.reverse() : events
}

function turnSummary(snapshot: AtlasSnapshot, events: AtlasEvent[], turn: number): {
  prose: string; metaParts: NonNullable<ScreenRow['metaParts']>
} {
  const metaParts: NonNullable<ScreenRow['metaParts']> = []
  const parts: string[] = []
  const files = snapshot.files.filter(file => file.turn === turn)
  const edits = files.reduce((sum, file) => sum + file.writes, 0)
  const reads = files.reduce((sum, file) => sum + file.reads, 0)
  if (edits || reads) metaParts.push({ text: `${edits}e`, tone: 'write' }, { text: `${reads}r`, tone: 'read' })
  if (edits) parts.push(`${edits} edit${edits === 1 ? '' : 's'}`)
  if (reads) parts.push(`${reads} read${reads === 1 ? '' : 's'}`)
  const checkpoints = snapshot.checkpoints.filter(checkpoint => checkpoint.turn === turn)
  if (checkpoints.some(checkpoint => checkpoint.kind === 'tests')) parts.push('tests ✓')
  if (checkpoints.some(checkpoint => checkpoint.kind === 'commit')) parts.push('commit')
  if (checkpoints.some(checkpoint => checkpoint.kind === 'tests')) metaParts.push({ text: '✓', tone: 'ok' })
  if (checkpoints.some(checkpoint => checkpoint.kind === 'commit')) metaParts.push({ text: '⚑', tone: 'checkpoint' })
  const counts: [AtlasEvent['kind'], string, string, ScreenRow['tone']][] = [
    ['topic', 'topic', 't', 'path'],
    ['decision', 'decision', 'd', 'decision'],
    ['question', 'question', 'q', 'question'],
  ]
  for (const [kind, label, letter, tone] of counts) {
    const count = events.filter(event => event.kind === kind).length
    if (count) metaParts.push({ text: `${count}${letter}`, tone })
    if (count) parts.push(`${count} ${label}${count === 1 ? '' : 's'}`)
  }
  const handoffs = events.filter(event => event.kind === 'handoff').length
  const reports = events.filter(event => event.kind === 'report-back').length
  if (handoffs) metaParts.push({ text: `${handoffs}h`, tone: 'checkpoint' })
  if (reports) metaParts.push({ text: `${reports}b`, tone: 'checkpoint' })
  if (handoffs) parts.push(`${handoffs} hand-off${handoffs === 1 ? '' : 's'}`)
  if (reports) parts.push(`${reports} report${reports === 1 ? '' : 's'}`)
  return { metaParts, prose: parts.join(' · ') || `${Math.max(0, events.length - 1)} event${events.length === 2 ? '' : 's'}` }
}

function storyRows(snapshot: AtlasSnapshot, events: AtlasEvent[], now: number): ScreenRow[] {
  const groups: { turn: number; events: AtlasEvent[] }[] = []
  for (const event of events) {
    const group = groups.find(candidate => candidate.turn === event.turn)
    if (group) group.events.push(event)
    else groups.push({ turn: event.turn, events: [event] })
  }
  return groups.flatMap(group => {
    const prompt = group.events.find(event => event.kind === 'prompt')
    const anchor = prompt ?? group.events[0]
    if (!anchor) return []
    const title = prompt ? (sentences(eventText(prompt.text))[0] ?? eventText(prompt.text)) : eventText(anchor.text)
    const source = sourceDetails(snapshot, anchor)
    const summary = turnSummary(snapshot, group.events, group.turn)
    const latest = Math.max(...group.events.map(event => event.at))
    return [{
      id: `story-${group.turn}`,
      key: `evb-story-${group.turn}`,
      kind: 'event' as const,
      glyph: prompt ? undefined : EVENT_GLYPH[anchor.kind],
      sourceMark: source.mark,
      sourceMarkColor: source.color,
      text: title,
      metaParts: summary.metaParts,
      right: ago(now - latest),
      detail: [
        `turn: ${group.turn}`,
        `when: ${ago(now - latest)}`,
        `counts: ${summary.prose}`,
        ...group.events.map(event => [trailSourceMark(snapshot, event), eventText(event.text)].filter(Boolean).join(' ')),
      ],
      fullText: prompt ? eventText(prompt.text) : eventText(anchor.text),
      dim: source.guess,
      italic: source.guess,
      tone: prompt ? undefined : eventRow(snapshot, anchor, now).tone,
      expandable: true,
      interactive: true,
    }]
  })
}

function section(key: string, heading: string, rows: ScreenRow[], extra: Partial<ScreenSection> = {}): ScreenSection {
  return { key, heading, explain: explain[heading] ?? heading, help: help[heading] ?? [explain[heading] ?? heading], rows, ...extra }
}

export function trailViewPopup(
  view: 'story' | 'log', newest = true, hidden: string[] = [], page = 0,
): ScreenPopup {
  const rows: ScreenRow[] = page === 0 ? [
      {
        id: 'trail-choice-story', key: 'trail-view-story', kind: 'suggestion', text: 'Story · grouped by turn',
        meta: view === 'story' ? 'active · default' : 'default', expandable: false, setting: true,
        checkbox: view === 'story',
        actions: [action('trail-view-story', 'Story', { type: 'trail-view-set', view: 'story' }, view === 'story')],
      },
      {
        id: 'trail-choice-log', key: 'trail-view-log', kind: 'suggestion', text: 'Log · one event per line',
        meta: view === 'log' ? 'active' : 'default', expandable: false, setting: true,
        checkbox: view === 'log',
        actions: [action('trail-view-log', 'Log', { type: 'trail-view-set', view: 'log' }, view === 'log')],
      },
    ] : page === 1 ? [
      {
        id: 'trail-choice-sort', key: 'trail-sort', kind: 'suggestion', text: `${newest ? '▼' : '▲'} Event time`,
        meta: newest ? 'newest first' : 'oldest first', expandable: false, setting: true,
        actions: [action('trail-sort', 'Sort', { type: 'trail-sort' })],
      },
    ] : [
      { id: 'trail-filter-b', key: 'trail-filter-b-toggle', kind: 'suggestion', text: 'Report-backs', checkbox: hidden.includes('b'), setting: true,
        meta: hidden.includes('b') ? 'hidden' : 'shown', expandable: false,
        actions: [action('trail-filter-b-toggle', hidden.includes('b') ? 'Show' : 'Hide', { type: 'trail-filter', filter: 'b' })] },
      { id: 'trail-filter-h', key: 'trail-filter-h-toggle', kind: 'suggestion', text: 'Hand-offs', checkbox: hidden.includes('h'), setting: true,
        meta: hidden.includes('h') ? 'hidden' : 'shown', expandable: false,
        actions: [action('trail-filter-h-toggle', hidden.includes('h') ? 'Show' : 'Hide', { type: 'trail-filter', filter: 'h' })] },
    ]
  return {
    kind: 'trail-view',
    title: 'TRAIL SETTINGS',
    page: { current: page, total: 3, name: ['VIEW', 'ORDER', 'HIDE TYPES'][page] ?? 'VIEW' },
    closeGlyph: true,
    rows,
  }
}

export const buildTrail: ScreenBuilder = (snapshot: AtlasSnapshot, view, now): ScreenModel => {
  const hidden = view.hidden ?? []
  const topics = topicRows(snapshot, view, now)
  const events = orderedEvents(snapshot, view, now)
  const eventRows = view.trailView === 'log' ? events.map(event => eventRow(snapshot, event, now)) : storyRows(snapshot, events, now)
  const needsObserver = view.mode === 'engine' && snapshot.topics.some(topic => topic.source === 'claude')
  const trailHeading = `TRAIL · ${view.trailView === 'log' ? 'Log' : 'Story'}`
  const sections: ScreenSection[] = [
    section('topics', 'MAP OF TOPICS', topics, {
      tone: needsObserver ? undefined : 'trail',
      dim: needsObserver,
      count: `${snapshot.topics.length}`,
      empty: 'No topics yet.',
    }),
    section('events', trailHeading, eventRows, {
      explain: trailExplain,
      help: trailHelp,
      tone: 'trail',
      actions: [action('trail-view-menu', '≡', { type: 'popup', popup: { kind: 'trail-view' } })],
      empty: 'Nothing recorded yet.',
    }),
  ]
  const eventsSection = sections.find(value => value.key === 'events')
  if (eventsSection && hidden.length) eventsSection.count = `${hidden.length} hidden`
  return filterHiddenRows({ tab: 'trail', sections }, hidden)
}
