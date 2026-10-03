// Builds shared rows, actions and popups for the Atlas screens. Pure; no `$`.

import type { AtlasItem, AtlasSnapshot, AtlasSuggestion, AtlasTopic } from '../../types'
import type { Action, GlyphKey, ScreenAction, ScreenRow, ScreenView, ToneKey } from './types'

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 45) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}

export function sourceName(source: string): string {
  return source === 'claude'
    ? 'Claude'
    : source === 'cue'
      ? 'your wording'
      : source === 'engine'
        ? 'engine'
        : source === 'person'
          ? 'you'
          : source
}

export function topicName(snapshot: AtlasSnapshot, id: string | null): string | null {
  return id ? (snapshot.topics.find(topic => topic.id === id)?.title ?? null) : null
}

export function whenLine(now: number, at: number, turn: number): string {
  return `when: ${ago(now - at)} · turn ${turn}`
}

export function action(key: string, label: string, value: Action, primary = false): ScreenAction {
  return { key, label, action: value, ...(primary ? { primary: true } : {}) }
}

export function itemDetails(snapshot: AtlasSnapshot, item: AtlasItem, now: number, kind: string): string[] {
  return [
    `text: ${item.text}`,
    `kind: ${kind}`,
    `source: ${sourceName(item.source)}`,
    whenLine(now, item.at, item.turn),
    `status: ${item.status}`,
    `topic: ${topicName(snapshot, item.topicId) ?? 'not recorded'}`,
  ]
}

export function suggestionRow(
  snapshot: AtlasSnapshot,
  suggestion: AtlasSuggestion,
  view: ScreenView,
  now?: number,
  allowExpansion = false,
): ScreenRow {
  const confirm: Record<AtlasSuggestion['kind'], string> = {
    goal: 'Set as goal',
    detour: 'Take detour',
    return: 'Return',
    next: 'Pin next',
    resume: 'Resume',
  }
  const dismiss: Record<AtlasSuggestion['kind'], string> = {
    goal: 'Not my goal',
    detour: 'Not a detour',
    return: 'Stay',
    next: 'Dismiss',
    resume: 'Dismiss',
  }
  const glyph: GlyphKey = suggestion.kind === 'detour' ? 'detour' : suggestion.kind === 'return' ? 'returned' : 'suggestion'
  const tone: ToneKey | undefined =
    suggestion.kind === 'detour' || suggestion.kind === 'return'
      ? 'detour'
      : suggestion.kind === 'goal' || suggestion.kind === 'resume'
        ? 'goal'
        : undefined
  const who = suggestion.source === 'claude' ? 'Claude' : suggestion.source === 'cue' ? 'your words' : 'Atlas'
  const topic = topicName(snapshot, suggestion.topicId)
  return {
    id: suggestion.id,
    key: `sg-${suggestion.id}`,
    kind: 'suggestion',
    glyph,
    text: suggestion.text,
    meta: `${suggestion.kind} suggestion · from ${who}${suggestion.why ? ` · ${suggestion.why}` : ''}`,
    tone,
    fresh: snapshot.fresh.includes(suggestion.id),
    actions: [
      action(`ok-${suggestion.id}`, confirm[suggestion.kind], { type: 'confirm', id: suggestion.id }, true),
      action(`no-${suggestion.id}`, dismiss[suggestion.kind], { type: 'dismiss', id: suggestion.id }),
    ],
    expandable: allowExpansion,
    detail: [
      `text: ${suggestion.text}`,
      `kind: ${suggestion.kind} suggestion`,
      `source: ${sourceName(suggestion.source)}`,
      whenLine(now ?? suggestion.at, suggestion.at, suggestion.turn),
      `topic: ${topic ?? 'not recorded'}`,
      ...(suggestion.why ? [`why: ${suggestion.why}`] : []),
    ],
    interactive: allowExpansion,
  }
}

export function itemRow(snapshot: AtlasSnapshot, item: AtlasItem, now: number, view: ScreenView, withActions: boolean): ScreenRow {
  const settled = item.status === 'settled'
  const excluded = item.status === 'excluded'
  const inDetour = Boolean(snapshot.detour) && item.at >= (snapshot.detour?.at ?? 0)
  const isQuestion = item.status === 'open' || item.status === 'resolved'
  const kind = isQuestion
    ? item.status === 'open'
      ? 'open question'
      : 'resolved question'
    : settled
      ? 'settled decision'
      : excluded
        ? 'excluded decision'
        : 'observed decision'
  const glyph: GlyphKey = isQuestion
    ? item.status === 'open'
      ? 'openQuestion'
      : 'resolved'
    : settled
      ? 'settledDecision'
      : 'observedDecision'
  const tone: ToneKey | undefined = isQuestion
    ? item.status === 'open'
      ? 'question'
      : 'ok'
    : settled
      ? 'checkpoint'
      : !excluded
        ? 'decision'
        : undefined
  let extra: ScreenAction[] = []
  if (withActions && !isQuestion) {
    extra =
      settled || excluded
        ? [action(`restore-${item.id}`, excluded ? 'Restore' : 'Reopen', { type: 'restore', id: item.id })]
        : inDetour
          ? [
              action(`set-${item.id}`, 'Keep', { type: 'settle', id: item.id }, true),
              action(`exc-${item.id}`, 'Exclude', { type: 'exclude', id: item.id }),
            ]
          : [
              action(`set-${item.id}`, 'Settle', { type: 'settle', id: item.id }, true),
              action(`drp-${item.id}`, 'Drop', { type: 'drop', id: item.id }),
            ]
  } else if (withActions && isQuestion) {
    extra = [
      action(`${item.status === 'open' ? 'res' : 'reo'}-${item.id}`, item.status === 'open' ? 'Resolved' : 'Reopen', {
        type: item.status === 'open' ? 'resolve' : 'reopen',
        id: item.id,
      }),
    ]
  }
  return {
    id: item.id,
    key: `${isQuestion ? 'q' : 'd'}sel-${item.id}`,
    kind: 'item',
    glyph,
    text: item.text,
    source: sourceName(item.source),
    tone,
    fresh: snapshot.fresh.includes(item.id),
    italic: withActions && item.status === 'observed',
    expandable: true,
    detail: itemDetails(snapshot, item, now, kind),
    actions: extra,
    interactive: true,
    overflowPopup: !(withActions && item.status === 'observed') && (item.text.length > 120 || item.text.split(/\r?\n/).length > 4),
  }
}

export function topicRows(snapshot: AtlasSnapshot, view: ScreenView, now: number): ScreenRow[] {
  const out: ScreenRow[] = []
  const children = new Map<string | null, AtlasTopic[]>()
  const ids = new Set(snapshot.topics.map(topic => topic.id))
  for (const topic of snapshot.topics) {
    const parent = topic.parentId && ids.has(topic.parentId) ? topic.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), topic])
  }
  const walk = (parent: string | null, depth: number) => {
    for (const topic of children.get(parent) ?? []) {
      const current = topic.id === snapshot.currentTopicId
      const glyph: GlyphKey = current
        ? 'currentTopic'
        : topic.kind !== 'main'
          ? 'detour'
          : topic.status === 'returned'
            ? 'returned'
            : 'suggestion'
      const dim = view.mode === 'engine' && topic.source === 'claude'
      const childCount = snapshot.topics.filter(candidate => candidate.parentId === topic.id).length
      const decisionCount = snapshot.decisions.filter(item => item.topicId === topic.id).length
      const questionCount = snapshot.questions.filter(item => item.topicId === topic.id).length
      out.push({
        id: topic.id,
        key: `tsel-${topic.id}`,
        kind: 'topic',
        glyph,
        text: topic.title,
        meta: `t${topic.firstTurn === topic.lastTurn ? topic.firstTurn : `${topic.firstTurn}-${topic.lastTurn}`}`,
        source: sourceName(topic.source),
        tone: topic.kind !== 'main' ? 'detour' : current ? 'path' : undefined,
        dim,
        bold: current && !dim,
        fresh: snapshot.fresh.includes(topic.id),
        depth,
        expandable: true,
        detail: [
          `kind: ${topic.kind}`,
          `status: ${topic.status}`,
          `turns: ${topic.firstTurn === topic.lastTurn ? topic.firstTurn : `${topic.firstTurn}–${topic.lastTurn}`}`,
          `children: ${childCount}`,
          `decisions: ${decisionCount} · questions: ${questionCount}`,
          `source: ${sourceName(topic.source)}`,
        ],
        interactive: !dim,
      })
      if (depth < 12) walk(topic.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export function popupModels(snapshot: AtlasSnapshot, view: ScreenView, now: number) {
  const selectedEvent = view.popup?.kind === 'event' ? snapshot.events.find(event => event.id === view.popup?.id) : undefined
  const eventRows = selectedEvent
    ? [
        {
          id: `${selectedEvent.id}-meta`,
          key: `${selectedEvent.id}-meta`,
          kind: 'text' as const,
          text: `${selectedEvent.kind} · turn ${selectedEvent.turn} · ${ago(now - selectedEvent.at)}`,
        },
        ...(selectedEvent.detail?.length
          ? [
              {
                id: `${selectedEvent.id}-summary`,
                key: `${selectedEvent.id}-summary`,
                kind: 'text' as const,
                text: selectedEvent.text.split(/[.!?](?:\s|$)/)[0] ?? selectedEvent.text,
                bold: true,
              },
              { id: `${selectedEvent.id}-points`, key: `${selectedEvent.id}-points`, kind: 'text' as const, text: 'Points', bold: true },
              {
                id: `${selectedEvent.id}-detail`,
                key: `${selectedEvent.id}-detail`,
                kind: 'text' as const,
                text: selectedEvent.detail.map(point => `• ${point}`).join('\n'),
                dim: true,
              },
              {
                id: `${selectedEvent.id}-full-label`,
                key: `${selectedEvent.id}-full-label`,
                kind: 'text' as const,
                text: 'Full text',
                bold: true,
              },
            ]
          : []),
        { id: `${selectedEvent.id}-full`, key: `${selectedEvent.id}-full`, kind: 'text' as const, text: selectedEvent.text },
      ]
    : []
  if (!selectedEvent) return []
  return [
    {
      kind: 'event' as const,
      id: selectedEvent.id,
      title: 'EVENT',
      rows: eventRows,
      footerActions:
        selectedEvent.kind === 'prompt'
          ? [
              action(
                `add-ev-${selectedEvent.id}`,
                'Add to message',
                {
                  type: 'attach',
                  ref: {
                    kind: 'Prompt',
                    id: selectedEvent.id,
                    text: [selectedEvent.text, ...(selectedEvent.detail ?? [])].join('\n'),
                  },
                },
                true,
              ),
            ]
          : undefined,
    },
  ]
}
