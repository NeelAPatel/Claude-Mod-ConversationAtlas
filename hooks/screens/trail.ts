// Shows the observed topic map and chronological event trail. Pure; no `$`.

import { collapseEvents } from '../model'
import type { AtlasSnapshot } from '../../types'
import { ago, action, topicRows } from './shared'
import type { ScreenBuilder, ScreenModel, ScreenRow, ScreenSection } from './types'

const explain: Record<string, string> = {
  'MAP OF TOPICS':
    'Every topic so far, nested where it branched. Click one for its kind, status, turns, children, decisions, questions and actions.',
  TRAIL: 'What happened: prompts, topics, decisions, checkpoints, hand-offs and reports. Click an event for its full text. ↑ = newest first; ↓ = oldest first.',
}
const help: Record<string, string[]> = {
  'MAP OF TOPICS': [
    'The observed topic tree for this session.',
    '● marks the current topic; ○ is a normal topic; ↳/↩ show detour movement.',
    'Indentation shows parent and child topics; counts show topic coverage.',
    'Press a topic for status, turns, children and related items.',
  ],
  TRAIL: [
    'A chronological record of prompts, topics, decisions and checkpoints.',
    '› prompts; ⚑ checkpoints; → hand-offs; ← reports; ✦ marks fresh rows.',
    'Press an event to open its full text and points.',
    'Use ↑ for newest first or ↓ for oldest first.',
    'The heading button opens this fuller explanation.',
    'Press the heading again to close it; row detail shares this one-open slot.',
  ],
}

function section(key: string, heading: string, rows: ScreenRow[], extra: Partial<ScreenSection> = {}): ScreenSection {
  return { key, heading, explain: explain[heading] ?? heading, help: help[heading] ?? [explain[heading] ?? heading], rows, ...extra }
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

export const buildTrail: ScreenBuilder = (snapshot: AtlasSnapshot, view, now): ScreenModel => {
  const topics = topicRows(snapshot, view, now)
  const events = view.trailNewest ? collapseEvents(snapshot.events.slice(-40)).reverse() : collapseEvents(snapshot.events.slice(-40))
  const eventRows: ScreenRow[] = events.map(event => {
    const text = eventText(event.text)
    return {
      id: event.id,
      key: `evb-${event.id}`,
      kind: 'event',
      glyph:
        event.kind === 'checkpoint'
          ? 'checkpoint'
          : event.kind === 'handoff'
            ? 'handoff'
            : event.kind === 'report-back'
              ? 'reportBack'
              : event.kind === 'prompt'
                ? 'prompt'
                : event.kind === 'topic'
                  ? 'currentTopic'
                  : event.kind === 'return'
                    ? 'returned'
                    : event.kind === 'detour'
                      ? 'detour'
                      : event.kind === 'decision'
                        ? 'observedDecision'
                        : event.kind === 'question'
                          ? 'openQuestion'
                          : event.kind === 'resolved'
                            ? 'resolved'
                            : event.kind === 'goal' || event.kind === 'promote'
                              ? 'goal'
                              : 'readFile',
      text: event.kind === 'prompt' ? (text.split(/\r?\n/)[0] ?? text) : text,
      meta: `turn ${event.turn}`,
      right: ago(now - event.at),
      detail: [`kind: ${event.kind}`, `turn: ${event.turn}`, `when: ${ago(now - event.at)}`, text],
      fullText: [text, ...(event.detail ?? [])].filter(Boolean).join('\n'),
      dim: event.kind === 'prompt' || event.kind === 'dismiss',
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
  })
  const needsObserver = view.mode === 'engine' && snapshot.topics.some(topic => topic.source === 'claude')
  const sections: ScreenSection[] = [
    section('topics', 'MAP OF TOPICS', topics, {
      tone: needsObserver ? undefined : 'trail',
      dim: needsObserver,
      count: `${snapshot.topics.length}`,
      empty: 'No topics yet.',
    }),
    section('events', 'TRAIL', eventRows, {
      tone: 'trail',
      actions: [action('trail-sort', view.trailNewest ? '↑' : '↓', { type: 'trail-sort' })],
      empty: 'Nothing recorded yet.',
    }),
  ]
  return { tab: 'trail', sections }
}
