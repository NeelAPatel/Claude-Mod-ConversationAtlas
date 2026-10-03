// Pure reducers for Conversation Atlas. No `$`, no clock: every function takes the
// snapshot and the time, and returns a new snapshot. The hooks module wires them to events.
//
// The one rule this file enforces: observations never write intent. `observe`, `startTurn`
// and the activity reducers only add topics, suggestions, items, files and activity.
// Goal, detour, next step and marked checkpoints change only in the `confirm*`/`set*`
// functions, which the hooks call from a person's press or command.

import type {
  AtlasActivity,
  AtlasCheckpoint,
  AtlasDetour,
  AtlasEvent,
  AtlasFile,
  AtlasHandoff,
  AtlasItem,
  AtlasRecall,
  AtlasSnapshot,
  AtlasSource,
  AtlasSuggestion,
  AtlasSuggestionKind,
  AtlasTopic,
} from '../types'

export const LIMITS = {
  events: 200,
  activity: 24,
  files: 60,
  topics: 80,
  items: 60,
  checkpoints: 40,
  suggestions: 10,
  history: 20,
  handoffs: 20,
} as const

export type Shift = 'same' | 'subtopic' | 'sibling' | 'possible-detour' | 'return'

export type ObserveReport = {
  topic?: string
  shift?: Shift
  why?: string
  decisions?: string[]
  questions?: string[]
  resolved?: string[]
  next?: string
  checkpoint?: string
  goal?: string
}

export function clip(value: unknown, max = 120): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

export function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function words(value: string): Set<string> {
  return new Set(norm(value).split(' ').filter(w => w.length > 2))
}

// Loose match for "the question Claude says is resolved" and "the topic it returns to".
export function similar(a: string, b: string): boolean {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x === y || x.includes(y) || y.includes(x)) return true
  const wa = words(a)
  const wb = words(b)
  if (wa.size === 0 || wb.size === 0) return false
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared += 1
  return shared / Math.min(wa.size, wb.size) >= 0.6
}

export function emptySnapshot(sessionId: string, root: string, now: number): AtlasSnapshot {
  return {
    v: 1,
    sessionId,
    root,
    startedAt: now,
    turn: 0,
    seq: 0,
    goal: null,
    detectedGoal: null,
    goalHistory: [],
    detour: null,
    detourHistory: [],
    nextStep: null,
    topics: [],
    currentTopicId: null,
    suggestions: [],
    decisions: [],
    questions: [],
    checkpoints: [],
    files: [],
    activity: [],
    handoffs: [],
    events: [],
    pendingContext: [],
    recall: [],
    adopted: [],
    scanned: 'none',
    fresh: [],
  }
}

// Fill fields a snapshot saved by an older build may lack, so a restore never breaks a render.
export function hydrate(raw: unknown, sessionId: string, root: string, now: number): AtlasSnapshot {
  const base = emptySnapshot(sessionId, root, now)
  if (!raw || typeof raw !== 'object') return base
  const s = raw as Partial<AtlasSnapshot>
  if (s.v !== 1) return base
  const detour = s.detour ? { ...s.detour, exclusions: s.detour.exclusions ?? [] } : null
  return { ...base, ...s, detour, sessionId, root, fresh: [], activity: (s.activity ?? []).map(a => (a.state === 'running' ? { ...a, state: 'failed' as const, endedAt: a.endedAt ?? now } : a)), handoffs: (s.handoffs ?? []).map(h => h.status === 'open' ? { ...h, status: 'closed' as const, summary: h.summary ?? 'session ended', tests: h.tests ?? null } : h) }
}

// A snapshot that survived a reload of an older build keeps its old shape in state:
// fill every field added since, so no reader ever meets undefined. Cheap and idempotent.
export function upgrade(s: AtlasSnapshot): AtlasSnapshot {
  const partial = s as Partial<AtlasSnapshot>
  const needs = partial.detectedGoal === undefined || !Array.isArray(partial.recall) || !Array.isArray(partial.adopted) || !partial.scanned || !Array.isArray(partial.handoffs) || (s.detour && !Array.isArray(s.detour.exclusions)) || s.detourHistory.some(d => !Array.isArray(d.exclusions))
  if (!needs) return s
  const base = emptySnapshot(s.sessionId, s.root, s.startedAt)
  const withEx = <T extends { exclusions?: string[] }>(d: T) => ({ ...d, exclusions: d.exclusions ?? [] })
  return { ...base, ...s, detectedGoal: partial.detectedGoal ?? null, recall: partial.recall ?? [], adopted: partial.adopted ?? [], scanned: partial.scanned ?? 'none', handoffs: partial.handoffs ?? [], detour: s.detour ? withEx(s.detour) : null, detourHistory: s.detourHistory.map(withEx) }
}

function id(s: AtlasSnapshot, prefix: string): [string, AtlasSnapshot] {
  const seq = s.seq + 1
  return [`${prefix}${seq}`, { ...s, seq }]
}

function keep<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(list.length - max) : list
}

function event(s: AtlasSnapshot, kind: AtlasEvent['kind'], text: string, now: number, detail?: string[]): AtlasSnapshot {
  const [eid, next] = id(s, 'e')
  const made: AtlasEvent = { id: eid, at: now, turn: s.turn, kind, text: kind === 'prompt' ? text : clip(text, 160), ...(detail?.length ? { detail } : {}) }
  return { ...next, events: keep([...next.events, made], LIMITS.events) }
}

// Rendering a long run of identical evidence rows as one event keeps the Trail
// useful without growing the stored event list or changing LIMITS.
export function collapseEvents(events: AtlasEvent[]): AtlasEvent[] {
  const out: AtlasEvent[] = []
  for (const current of events) {
    const previous = out[out.length - 1]
    const currentText = current.text.replace(/ ×\d+$/, '')
    const previousText = previous?.text.replace(/ ×\d+$/, '') ?? ''
    if (previous && current.kind === 'checkpoint' && previous.kind === 'checkpoint' && currentText === previousText) {
      const count = Number(/ ×(\d+)$/.exec(previous.text)?.[1] ?? 1) + 1
      out[out.length - 1] = { ...current, text: `${currentText} ×${count}` }
    } else {
      out.push(current)
    }
  }
  return out
}

function flash(s: AtlasSnapshot, ...ids: string[]): AtlasSnapshot {
  return { ...s, fresh: [...new Set([...s.fresh, ...ids])].slice(-12) }
}

export function clearFresh(s: AtlasSnapshot): AtlasSnapshot {
  return s.fresh.length ? { ...s, fresh: [] } : s
}

export function currentTopic(s: AtlasSnapshot): AtlasTopic | null {
  return s.topics.find(t => t.id === s.currentTopicId) ?? null
}

// Root-to-current chain of the topic tree: the "current path".
export function pathOf(s: AtlasSnapshot, topicId = s.currentTopicId): AtlasTopic[] {
  const chain: AtlasTopic[] = []
  const seen = new Set<string>()
  let cur = s.topics.find(t => t.id === topicId) ?? null
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.unshift(cur)
    cur = cur.parentId ? (s.topics.find(t => t.id === cur?.parentId) ?? null) : null
  }
  return chain
}

export function activeDecisions(s: AtlasSnapshot): AtlasItem[] {
  return s.decisions.filter(d => d.status === 'observed' || d.status === 'settled')
}

export function openQuestions(s: AtlasSnapshot): AtlasItem[] {
  return s.questions.filter(q => q.status === 'open')
}

// ---------------------------------------------------------------- suggestions

function suggest(
  s: AtlasSnapshot,
  kind: AtlasSuggestionKind,
  text: string,
  why: string | null,
  source: AtlasSource,
  now: number,
  replaceKind = true,
): AtlasSnapshot {
  const body = clip(text, 140)
  if (!body) return s
  if (s.suggestions.some(x => x.kind === kind && similar(x.text, body))) return s
  const [sid, next] = id(s, 's')
  const kept = replaceKind ? next.suggestions.filter(x => x.kind !== kind) : next.suggestions
  const made: AtlasSuggestion = { id: sid, kind, text: body, why: why ? clip(why, 140) : null, at: now, turn: s.turn, source, topicId: s.currentTopicId }
  return flash({ ...next, suggestions: keep([...kept, made], LIMITS.suggestions) }, sid)
}

function dropSuggestions(s: AtlasSnapshot, kind: AtlasSuggestionKind): AtlasSnapshot {
  return s.suggestions.some(x => x.kind === kind) ? { ...s, suggestions: s.suggestions.filter(x => x.kind !== kind) } : s
}

export function dismissSuggestion(s: AtlasSnapshot, sid: string, now: number): AtlasSnapshot {
  const hit = s.suggestions.find(x => x.id === sid)
  if (!hit) return s
  let next: AtlasSnapshot = { ...s, suggestions: s.suggestions.filter(x => x.id !== sid) }
  // "Not a detour": the excursion stays on the map as part of the main path.
  if (hit.kind === 'detour' && hit.topicId) {
    next = { ...next, topics: next.topics.map(t => (t.id === hit.topicId && t.kind === 'possible-detour' ? { ...t, kind: 'main' as const } : t)) }
  }
  return event(next, 'dismiss', `Dismissed ${hit.kind}: ${hit.text}`, now)
}

// ---------------------------------------------------------------- items

function addItem(s: AtlasSnapshot, list: 'decisions' | 'questions', text: string, source: AtlasSource, now: number): AtlasSnapshot {
  const body = clip(text, 160)
  if (!body) return s
  if (s[list].some(x => similar(x.text, body) && x.status !== 'resolved')) return s
  const [iid, next] = id(s, list === 'decisions' ? 'd' : 'q')
  const item: AtlasItem = { id: iid, text: body, at: now, turn: s.turn, topicId: s.currentTopicId, source, status: list === 'decisions' ? 'observed' : 'open' }
  const withItem = { ...next, [list]: keep([...next[list], item], LIMITS.items) } as AtlasSnapshot
  return flash(event(withItem, list === 'decisions' ? 'decision' : 'question', body, now), iid)
}

export function addDecision(s: AtlasSnapshot, text: string, source: AtlasSource, now: number): AtlasSnapshot {
  return addItem(s, 'decisions', text, source, now)
}

export function addQuestion(s: AtlasSnapshot, text: string, source: AtlasSource, now: number): AtlasSnapshot {
  return addItem(s, 'questions', text, source, now)
}

export function resolveQuestions(s: AtlasSnapshot, texts: string[], now: number): AtlasSnapshot {
  let next = s
  for (const text of texts) {
    const hit = next.questions.find(q => q.status === 'open' && similar(q.text, text))
    if (!hit) continue
    next = { ...next, questions: next.questions.map(q => (q.id === hit.id ? { ...q, status: 'resolved' as const } : q)) }
    next = event(next, 'resolved', hit.text, now)
  }
  return next
}

export function setItemStatus(s: AtlasSnapshot, iid: string, status: AtlasItem['status'] | 'drop', now: number): AtlasSnapshot {
  const list = iid.startsWith('d') ? 'decisions' : 'questions'
  const hit = s[list].find(x => x.id === iid)
  if (!hit) return s
  const items = status === 'drop' ? s[list].filter(x => x.id !== iid) : s[list].map(x => (x.id === iid ? { ...x, status } : x))
  let next = { ...s, [list]: items } as AtlasSnapshot
  if (status === 'settled' && s.detour) {
    // A decision the person settles during a detour is an accepted outcome of it (Trailhead's outcome).
    next = { ...next, detour: { ...s.detour, outcomes: [...s.detour.outcomes, hit.text].slice(-20) } }
  }
  if (status === 'excluded' && s.detour) {
    // Trailhead's exclude: explored during the detour, must not become an assumption.
    next = { ...next, detour: { ...s.detour, exclusions: [...s.detour.exclusions, hit.text].slice(-20) } }
  }
  const verb = status === 'settled' ? 'Settled' : status === 'excluded' ? 'Excluded' : status === 'resolved' ? 'Resolved' : status === 'open' ? 'Reopened' : status === 'drop' ? 'Dropped' : 'Marked'
  return event(next, status === 'resolved' ? 'resolved' : 'decision', `${verb}: ${hit.text}`, now)
}

// ---------------------------------------------------------------- topics (observation)

function addTopic(s: AtlasSnapshot, title: string, parentId: string | null, kind: AtlasTopic['kind'], source: AtlasSource, now: number): AtlasSnapshot {
  const [tid, next] = id(s, 't')
  const topic: AtlasTopic = { id: tid, title: clip(title, 60), parentId, kind, firstTurn: s.turn, lastTurn: s.turn, at: now, status: 'active', source }
  const topics = next.topics.map(t => (t.id === s.currentTopicId ? { ...t, status: 'left' as const } : t))
  const trimmed = keep([...topics, topic], LIMITS.topics)
  return flash(event({ ...next, topics: trimmed, currentTopicId: tid }, 'topic', `${kind === 'possible-detour' ? 'Possible detour' : 'Topic'}: ${topic.title}`, now), tid)
}

function moveTo(s: AtlasSnapshot, target: AtlasTopic, now: number): AtlasSnapshot {
  const topics = s.topics.map(t => {
    if (t.id === target.id) return { ...t, status: 'returned' as const, lastTurn: s.turn }
    if (t.id === s.currentTopicId) return { ...t, status: 'left' as const }
    return t
  })
  return flash(event({ ...s, topics, currentTopicId: target.id }, 'return', `Back to ${target.title}`, now), target.id)
}

function inDetourBranch(s: AtlasSnapshot, topic: AtlasTopic | null): boolean {
  return Boolean(topic && pathOf(s, topic.id).some(t => t.kind !== 'main'))
}

function returnTarget(s: AtlasSnapshot, title: string): AtlasTopic | null {
  const cur = currentTopic(s)
  if (title) {
    const named = [...s.topics].reverse().find(t => t.id !== cur?.id && similar(t.title, title))
    if (named) return named
  }
  if (s.detour?.topicId) {
    const departure = s.topics.find(t => t.id === s.detour?.topicId)
    if (departure?.parentId) return s.topics.find(t => t.id === departure.parentId) ?? null
  }
  // Leave the nearest excursion: return to the topic above the first non-main topic in the path.
  const chain = pathOf(s)
  const first = chain.findIndex(t => t.kind !== 'main')
  if (first > 0) return chain[first - 1] ?? null
  return chain.length > 1 ? (chain[chain.length - 2] ?? null) : null
}

export function observeTopic(s: AtlasSnapshot, title: string, shift: Shift | undefined, why: string | null, source: AtlasSource, now: number): AtlasSnapshot {
  const name = clip(title, 60)
  const cur = currentTopic(s)
  if (!cur) {
    if (!name) return s
    // A first topic that already reads as a side trip is still only a suggestion.
    if (shift === 'possible-detour' && !s.detour) return suggest(addTopic(s, name, null, 'possible-detour', source, now), 'detour', name, why, source, now)
    return addTopic(s, name, null, 'main', source, now)
  }
  const sameName = Boolean(name) && similar(cur.title, name)
  const move: Shift = shift ?? (sameName || !name ? 'same' : cur.parentId ? 'sibling' : 'subtopic')
  if (move === 'same' || (sameName && move !== 'return')) {
    const topics = s.topics.map(t => (t.id === cur.id ? { ...t, lastTurn: s.turn, title: name && move === 'same' ? name : t.title } : t))
    return { ...s, topics }
  }
  if (move === 'return') {
    const target = returnTarget(s, name)
    if (!target) return s
    let next = moveTo(s, target, now)
    if (s.detour) next = suggest(next, 'return', `Return to ${s.detour.departure.topic ?? s.detour.departure.goal ?? target.title}`, why ?? 'Claude observed the conversation going back', source, now)
    return next
  }
  if (!name) return s
  const branchKind: AtlasTopic['kind'] = inDetourBranch(s, cur) ? cur.kind : 'main'
  if (move === 'possible-detour') {
    if (s.detour) return addTopic(s, name, cur.id, 'detour', source, now)
    const next = addTopic(s, name, cur.id, 'possible-detour', source, now)
    return suggest(next, 'detour', name, why, source, now)
  }
  if (move === 'sibling') return addTopic(s, name, cur.parentId, cur.parentId ? branchKind : 'main', source, now)
  return addTopic(s, name, cur.id, branchKind, source, now)
}

// ---------------------------------------------------------------- Claude's report (observation)

export function observe(s: AtlasSnapshot, report: ObserveReport, now: number): AtlasSnapshot {
  let next = s
  if (report.topic || report.shift) next = observeTopic(next, report.topic ?? '', report.shift, report.why ?? null, 'claude', now)
  for (const d of report.decisions ?? []) next = addDecision(next, d, 'claude', now)
  if (report.resolved?.length) next = resolveQuestions(next, report.resolved, now)
  for (const q of report.questions ?? []) next = addQuestion(next, q, 'claude', now)
  if (report.next) next = suggest(next, 'next', report.next, null, 'claude', now)
  if (report.checkpoint) next = addCheckpoint(next, report.checkpoint, 'claude', null, now)
  if (report.goal) next = { ...next, detectedGoal: { text: clip(report.goal, 140), source: 'claude', at: now } }
  // A proposed goal is only ever a suggestion, and only while nothing is confirmed.
  if (report.goal && !next.goal) next = suggest(next, 'goal', report.goal, 'Proposed by Claude', 'claude', now)
  return next
}

// ---------------------------------------------------------------- prompt cues (observation)

const DETOUR_CUE = /\b(quick (detour|tangent|side ?quest)|side (question|quest|note)|tangent|unrelated(ly)?|btw|by the way|before (we|i) (continue|forget)|one sec|real quick)\b/i
const RETURN_CUE = /\b(back to (the )?(main|original|it|where)|let'?s get back|go back to|return(ing)? to (the )?(main|original|goal)|where were we|anyway,? (let'?s|back)|resume (the )?(main|original|work))\b/i
const DECISION_CUE = /\b(let'?s go with|we('ll| will) go with|i('ve| have)? decided|decision:|go with option|settled on|we('ll| will) use)\b/i

export function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]*/g) ?? [text]).map(p => p.trim()).filter(Boolean)
}

type ReportMarker = { agent: string | null; summary: string }

function markerLines(body: string): string[] {
  return body.replace(/<\/?(?:task-notification|agent-message)\b[^>]*>/gi, '').split(/\r?\n/).map(line => line.replace(/^\s+|\s+$/g, '')).filter(Boolean)
}

// Engine-originated blocks are not prompts. Pasted content and image notices
// remain visible as compact typed-language stand-ins; notification blocks are
// consumed by delegation observation instead.
export function stripPromptMarkers(text: string): string {
  let body = text
  body = body.replace(/<task-notification\b[^>]*>[\s\S]*?<\/task-notification>/gi, '')
  body = body.replace(/<agent-message\b[^>]*>[\s\S]*?<\/agent-message>/gi, '')
  body = body.replace(/<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content>/gi, (_whole, inner: string) => {
    const count = inner.trim() ? inner.trim().split(/\r?\n/).length : 0
    return `pasted ${count} lines`
  })
  body = body.replace(/\[Image\s+#\d+\]/gi, 'image')
  return body.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function reportMarker(text: string): ReportMarker | null {
  const matches = [...text.matchAll(/<(task-notification|agent-message)\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
  if (!matches.length) return null
  const last = matches[matches.length - 1]
  const attrs = last?.[2] ?? ''
  const fromMatch = /\bfrom\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/i.exec(attrs)
  const from = fromMatch?.[1] ?? fromMatch?.[2] ?? null
  const lines = markerLines(last?.[3] ?? '')
  const chosen = lines.find(line => /^summary\s*:/i.test(line)) ?? lines.find(line => /^status\s*:/i.test(line)) ?? lines[0]
  const summary = chosen?.replace(/^(?:summary|status)\s*:\s*/i, '').trim() || (from ? `Report from ${from}` : 'Report received')
  return { agent: from, summary: clip(summary, 140) }
}

// The points a longer prompt makes, after its first sentence: list items as written,
// other lines split into sentences. The event keeps the full prompt separately.
// Heuristic, no model; at most 6.
export function promptBullets(text: string): string[] {
  const items: string[] = []
  let fenced = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced || !line) continue
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line)
    if (bullet) items.push(bullet[1] ?? '')
    else items.push(...sentences(line))
  }
  const kept = items
    .slice(1)
    .map(x => x.replace(/\s+/g, ' ').trim())
    .filter(x => x.length >= 4)
  const shown = kept.slice(0, 6).map(x => clip(x, 90))
  return kept.length > 6 ? [...shown, `+${kept.length - 6} more`] : shown
}

function sentenceWith(text: string, cue: RegExp): string {
  return sentences(text).find(p => cue.test(p)) ?? text
}

export function startTurn(s: AtlasSnapshot, text: string, now: number): AtlasSnapshot {
  const body = stripPromptMarkers(text)
  let next: AtlasSnapshot = { ...s, turn: s.turn + 1 }
  if (!body) return next
  next = event(next, 'prompt', body, now, promptBullets(body))
  if (body.startsWith('/') || body.startsWith('<')) return next
  if (!next.goal && !next.suggestions.some(x => x.kind === 'goal') && body.length >= 16) {
    const first = sentences(body)[0] ?? body
    next = suggest(next, 'goal', first, 'From your first request', 'cue', now)
  }
  if (DETOUR_CUE.test(body) && !next.detour) next = suggest(next, 'detour', clip(sentenceWith(body, DETOUR_CUE), 90), 'Your wording suggests a side trip', 'cue', now)
  if (RETURN_CUE.test(body) && next.detour) next = suggest(next, 'return', `Return to ${next.detour.departure.topic ?? next.detour.departure.goal ?? 'the main path'}`, 'Your wording suggests going back', 'cue', now)
  if (DECISION_CUE.test(body)) next = addDecision(next, sentenceWith(body, DECISION_CUE), 'cue', now)
  return next
}

// ---------------------------------------------------------------- activity & files (observation)

export function startActivity(s: AtlasSnapshot, a: Omit<AtlasActivity, 'state' | 'endedAt'>): AtlasSnapshot {
  return { ...s, activity: keep([...s.activity, { ...a, state: 'running', endedAt: null }], LIMITS.activity) }
}

export function endActivity(s: AtlasSnapshot, aid: string, state: 'done' | 'failed', now: number, label?: string): AtlasSnapshot {
  if (!s.activity.some(a => a.id === aid)) return s
  return { ...s, activity: s.activity.map(a => (a.id === aid ? { ...a, state, endedAt: now, label: label ?? a.label } : a)) }
}

export function startHandoff(s: AtlasSnapshot, label: string, agent: string, brief: string | null, reportPath: string | null, now: number): AtlasSnapshot {
  const body = clip(label, 120) || agent || 'external agent'
  const [hid, next] = id(s, 'h')
  const handoff: AtlasHandoff = { id: hid, label: body, agent: clip(agent, 40) || 'agent', brief: brief ? clip(brief, 240) : null, reportPath: reportPath ? clip(reportPath, 400) : null, at: now, turn: s.turn, status: 'open', summary: null, tests: null, files: [] }
  const path = brief ? ` · ${brief}` : ''
  return flash(event({ ...next, handoffs: keep([...next.handoffs, handoff], LIMITS.handoffs) }, 'handoff', `→ ${body}${path}`, now), hid)
}

function handoffFor(s: AtlasSnapshot, agent?: string, idHint?: string): AtlasHandoff | null {
  const open = s.handoffs.filter(h => h.status === 'open')
  if (idHint) return open.find(h => h.id === idHint) ?? null
  if (agent) return [...open].reverse().find(h => h.agent.toLowerCase() === agent.toLowerCase()) ?? null
  return open.at(-1) ?? null
}

export function reportHandoff(s: AtlasSnapshot, summaryText: string, now: number, agent?: string, idHint?: string, tests: string | null = null, files: string[] = []): AtlasSnapshot {
  const hit = handoffFor(s, agent, idHint)
  const summary = clip(summaryText, 140) || 'Report received'
  const uniqueFiles = [...new Set(files.filter(Boolean))].slice(0, 20)
  const marked = hit
    ? s.handoffs.map(h => h.id === hit.id ? { ...h, status: 'reported' as const, summary, tests: tests ? clip(tests, 140) : h.tests, files: uniqueFiles.length ? uniqueFiles : h.files } : h)
    : s.handoffs
  const suffix = `${uniqueFiles.length ? ` · ${uniqueFiles.length} files` : ''}${tests ? ` · ${clip(tests, 100)}` : ''}`
  return event({ ...s, handoffs: marked }, 'report-back', `← ${summary}${suffix}`, now)
}

export function closeUnverifiedHandoffs(s: AtlasSnapshot, now: number): AtlasSnapshot {
  const open = s.handoffs.filter(h => h.status === 'open')
  if (!open.length) return s
  let next: AtlasSnapshot = { ...s, handoffs: s.handoffs.map(h => h.status === 'open' ? { ...h, status: 'closed' as const, summary: 'back · unverified' } : h) }
  for (const h of open) next = event(next, 'report-back', `← back · unverified${h.label ? ` · ${h.label}` : ''}`, now)
  return next
}

export function touchFile(s: AtlasSnapshot, path: string, op: 'read' | 'write', now: number, source?: string): AtlasSnapshot {
  if (!path) return s
  const hit = s.files.find(f => f.path === path)
  const file: AtlasFile = hit
    ? { ...hit, reads: hit.reads + (op === 'read' ? 1 : 0), writes: hit.writes + (op === 'write' ? 1 : 0), lastOp: op, at: now, turn: s.turn, ...(source ? { source } : {}) }
    : { path, reads: op === 'read' ? 1 : 0, writes: op === 'write' ? 1 : 0, lastOp: op, at: now, turn: s.turn, ...(source ? { source } : {}) }
  const rest = s.files.filter(f => f.path !== path)
  return { ...s, files: keep([...rest, file], LIMITS.files) }
}

function writtenSince(s: AtlasSnapshot, at: number): string[] {
  return s.files.filter(f => f.writes > 0 && f.at > at).map(f => f.path).slice(-12)
}

// Checkpoints are evidence: a commit, a passing test run after edits, a milestone Claude
// reports, or a mark the person makes. None of them change the goal.
export function addCheckpoint(s: AtlasSnapshot, name: string, kind: AtlasCheckpoint['kind'], detail: string | null, now: number): AtlasSnapshot {
  const last = s.checkpoints[s.checkpoints.length - 1]
  const files = writtenSince(s, last?.at ?? 0)
  if (kind === 'tests' && files.length === 0) return s
  const [cid, next] = id(s, 'c')
  const label = clip(name, 60) || `checkpoint-${s.checkpoints.length + 1}`
  const cp: AtlasCheckpoint = { id: cid, name: label, at: now, turn: s.turn, kind, goal: s.goal?.text ?? null, topic: currentTopic(s)?.title ?? null, files, detail: detail ? clip(detail, 120) : null }
  const text = kind === 'tests' ? `${kindLabel(kind)} · ${detail ? clip(detail, 120) : 'command not recorded'}` : `${kindLabel(kind)}: ${label}`
  return flash(event({ ...next, checkpoints: keep([...next.checkpoints, cp], LIMITS.checkpoints) }, 'checkpoint', text, now), cid)
}

function kindLabel(kind: AtlasCheckpoint['kind']): string {
  return kind === 'marked' ? 'Marked' : kind === 'commit' ? 'Commit' : kind === 'tests' ? 'Tests passed' : 'Milestone'
}

// ---------------------------------------------------------------- intent (explicit only)

export function setGoal(s: AtlasSnapshot, text: string, source: AtlasSource, now: number): AtlasSnapshot {
  const body = clip(text, 140)
  if (!body) return s
  if (s.detour) return s
  const [gid, next] = id(s, 'g')
  const history = s.goal ? keep([...s.goalHistory, s.goal], LIMITS.history) : s.goalHistory
  const goal = { id: gid, text: body, at: now, turn: s.turn, source }
  return flash(event(dropSuggestions({ ...next, goal, goalHistory: history }, 'goal'), 'goal', body, now), gid)
}

export function setNextStep(s: AtlasSnapshot, text: string, now: number): AtlasSnapshot {
  const body = clip(text, 140)
  if (!body) return s
  return event(dropSuggestions({ ...s, nextStep: body }, 'next'), 'next', body, now)
}

export function mark(s: AtlasSnapshot, name: string, now: number): AtlasSnapshot {
  return addCheckpoint(s, name || `mark-${s.checkpoints.filter(c => c.kind === 'marked').length + 1}`, 'marked', null, now)
}

export function startDetour(s: AtlasSnapshot, reason: string, topicId: string | null, now: number): AtlasSnapshot {
  const body = clip(reason, 120)
  if (!body || s.detour) return s
  // Trailhead: a detour departs from the latest mark, creating one when none exists.
  let next = s
  let checkpoint = [...s.checkpoints].reverse().find(c => c.kind === 'marked') ?? null
  if (!checkpoint) {
    next = addCheckpoint(next, `before ${clip(body, 40)}`, 'marked', 'Created at detour departure', now)
    checkpoint = next.checkpoints[next.checkpoints.length - 1] ?? null
  }
  const departureTopic = topicId ? s.topics.find(t => t.id === topicId) : null
  const above = departureTopic?.parentId ? s.topics.find(t => t.id === departureTopic.parentId) : currentTopic(s)
  const [did, withId] = id(next, 'x')
  const detour: AtlasDetour = {
    id: did,
    reason: body,
    at: now,
    turn: s.turn,
    topicId,
    departure: {
      goal: s.goal?.text ?? null,
      topic: above?.title ?? null,
      nextStep: s.nextStep,
      checkpointId: checkpoint?.id ?? null,
      decisions: s.decisions.filter(d => d.status === 'settled').map(d => d.text).slice(-8),
    },
    outcomes: [],
    exclusions: [],
    status: 'active',
    endedAt: null,
  }
  const topics = withId.topics.map(t => (t.id === topicId ? { ...t, kind: 'detour' as const } : t))
  return flash(event(dropSuggestions({ ...withId, topics, detour }, 'detour'), 'detour', body, now), did)
}

const missing = (v: string | null | undefined) => (v && v.trim() ? v : 'not recorded')

// Trailhead's deterministic return packet: what Claude needs to pick the main work back up.
export function returnPacket(s: AtlasSnapshot, d: AtlasDetour): string {
  const cp = s.checkpoints.find(c => c.id === d.departure.checkpointId)
  const observed = s.decisions.filter(x => x.status === 'observed' && x.at >= d.at).map(x => x.text)
  const list = (items: string[]) => (items.length ? items.map(x => `- ${x}`) : ['- not recorded'])
  return [
    'Conversation Atlas return packet (confirmed by the user)',
    `Original goal: ${missing(d.departure.goal)}`,
    `Returning to: ${missing(d.departure.topic)}`,
    `Detour: ${d.reason}`,
    `Return point: ${missing(cp?.name)}`,
    `Intended next step: ${missing(d.departure.nextStep)}`,
    'Settled decisions at departure:',
    ...list(d.departure.decisions),
    'Accepted detour outcomes:',
    ...list(d.outcomes),
    'Excluded material (explored, do not rely on it):',
    ...list(d.exclusions ?? []),
    'Observed during the detour, not confirmed (do not treat as settled):',
    ...list(observed.slice(-6)),
  ].join('\n')
}

export function returnFromDetour(s: AtlasSnapshot, now: number): AtlasSnapshot {
  const d = s.detour
  if (!d) return s
  const packet = returnPacket(s, d)
  const closed: AtlasDetour = { ...d, status: 'returned', endedAt: now }
  let next: AtlasSnapshot = { ...s, detour: null, detourHistory: keep([...s.detourHistory, closed], LIMITS.history), pendingContext: [...s.pendingContext, packet] }
  next = dropSuggestions(next, 'return')
  const target = d.topicId ? s.topics.find(t => t.id === d.topicId)?.parentId : null
  const topic = target ? next.topics.find(t => t.id === target) : null
  if (topic && next.currentTopicId !== topic.id) next = moveTo(next, topic, now)
  const topics = next.topics.map(t => (t.id === d.topicId ? { ...t, status: 'left' as const } : t))
  return event({ ...next, topics }, 'return', `Returned from detour: ${d.reason}`, now)
}

export function promoteDetour(s: AtlasSnapshot, now: number): AtlasSnapshot {
  const d = s.detour
  if (!d) return s
  const closed: AtlasDetour = { ...d, status: 'promoted', endedAt: now }
  const cleared: AtlasSnapshot = { ...s, detour: null, detourHistory: keep([...s.detourHistory, closed], LIMITS.history) }
  const promoted = setGoal(cleared, d.reason, 'person', now)
  const topics = promoted.topics.map(t => (t.id === d.topicId ? { ...t, kind: 'main' as const } : t))
  return event({ ...promoted, topics }, 'promote', `Detour became the goal: ${d.reason}`, now)
}

// /atlas decision: the person states a decision, so it is settled from the start.
export function recordDecision(s: AtlasSnapshot, text: string, why: string | null, now: number): AtlasSnapshot {
  const body = clip(why ? `${text} (because ${why})` : text, 160)
  if (!body) return s
  const added = addDecision(s, body, 'person', now)
  const item = added.decisions[added.decisions.length - 1]
  return item && item.text === body && item.status === 'observed' ? setItemStatus(added, item.id, 'settled', now) : added
}

// /atlas outcome and /atlas exclude: Trailhead's explicit detour findings.
export function addDetourFinding(s: AtlasSnapshot, kind: 'outcomes' | 'exclusions', text: string, now: number): AtlasSnapshot {
  const body = clip(text, 160)
  if (!s.detour || !body) return s
  const detour = { ...s.detour, [kind]: [...s.detour[kind], body].slice(-20) }
  return event({ ...s, detour }, 'decision', `${kind === 'outcomes' ? 'Outcome' : 'Excluded'}: ${body}`, now)
}

export function setRecall(s: AtlasSnapshot, recall: AtlasRecall[]): AtlasSnapshot {
  return { ...s, recall: recall.filter(r => r.sessionId !== s.sessionId).slice(0, 12) }
}

// Resume an earlier session (Atlas or Trailhead): its goal, next step and settled
// decisions become yours because you pressed Resume; a detour it was on comes back
// as a suggestion, so you choose whether to re-enter it.
export function adoptRecall(s: AtlasSnapshot, rid: string, now: number): AtlasSnapshot {
  const r = s.recall.find(x => x.id === rid)
  if (!r || s.adopted.includes(rid)) return s
  let next: AtlasSnapshot = { ...s, adopted: [...s.adopted, rid] }
  if (r.goal && !next.detour) next = setGoal(next, r.goal, 'person', now)
  if (r.nextStep) next = setNextStep(next, r.nextStep, now)
  for (const d of r.decisions.slice(-8)) {
    const added = addDecision(next, d, 'person', now)
    const item = added.decisions[added.decisions.length - 1]
    next = item && item !== next.decisions[next.decisions.length - 1] ? setItemStatus(added, item.id, 'settled', now) : added
  }
  if (r.detour && !next.detour) next = suggest(next, 'detour', r.detour, 'The earlier session was on this detour', 'engine', now)
  return event(dropSuggestions(next, 'resume'), 'resume', `Resumed ${r.source === 'trailhead' ? 'Trailhead trail' : 'session'} ${r.sessionId.slice(0, 8)}: ${r.goal ?? 'no goal'}`, now)
}

export function confirmSuggestion(s: AtlasSnapshot, sid: string, now: number): AtlasSnapshot {
  const hit = s.suggestions.find(x => x.id === sid)
  if (!hit) return s
  const rest: AtlasSnapshot = { ...s, suggestions: s.suggestions.filter(x => x.id !== sid) }
  if (hit.kind === 'goal') return setGoal(rest, hit.text, 'person', now)
  if (hit.kind === 'next') return setNextStep(rest, hit.text, now)
  if (hit.kind === 'detour') return startDetour(rest, hit.text, hit.topicId, now)
  if (hit.kind === 'return') return returnFromDetour(rest, now)
  if (hit.kind === 'resume') {
    const [goal, step] = hit.text.split(' → next: ')
    let next = rest.goal ? rest : setGoal(rest, goal ?? hit.text, 'person', now)
    if (step) next = setNextStep(next, step, now)
    return event(next, 'resume', hit.text, now)
  }
  return rest
}

// Offered once in a new session of the same project: the last session's goal and next step.
export function offerResume(s: AtlasSnapshot, previous: { goal: string | null; nextStep: string | null; detour: string | null } | null, now: number): AtlasSnapshot {
  if (!previous?.goal || s.goal) return s
  const text = previous.nextStep ? `${previous.goal} → next: ${previous.nextStep}` : previous.goal
  return suggest(s, 'resume', text, previous.detour ? `Last session ended inside a detour: ${previous.detour}` : 'Where the last session in this project left off', 'engine', now)
}

export function takeContext(s: AtlasSnapshot): [string[], AtlasSnapshot] {
  return s.pendingContext.length ? [s.pendingContext, { ...s, pendingContext: [] }] : [[], s]
}

// What to pick up next, most specific first. Every line says where it came from.
export function resumeHint(s: AtlasSnapshot): { text: string; source: string } | null {
  if (s.detour) return { text: `Finish "${s.detour.reason}", then return to ${s.detour.departure.topic ?? s.detour.departure.goal ?? 'the main path'}`, source: 'detour' }
  if (s.nextStep) return { text: s.nextStep, source: 'pinned' }
  const next = [...s.suggestions].reverse().find(x => x.kind === 'next')
  if (next) return { text: next.text, source: 'suggested' }
  const open = openQuestions(s)
  const lastQ = open[open.length - 1]
  if (lastQ) return { text: `Answer: ${lastQ.text}`, source: 'open question' }
  const lastWrite = [...s.files].reverse().find(f => f.writes > 0)
  if (lastWrite) return { text: `Continue in ${lastWrite.path.split('/').pop()}`, source: 'last edit' }
  return null
}

// One short line Claude reads beside a prompt, only while the person has confirmed intent.
export function intentLine(s: AtlasSnapshot): string | null {
  if (!s.goal && !s.detour && !s.nextStep) return null
  const parts = [
    s.goal ? `goal "${s.goal.text}"` : null,
    s.detour ? `on a detour "${s.detour.reason}" (returns to ${s.detour.departure.topic ?? 'the main path'})` : null,
    s.nextStep ? `next step "${s.nextStep}"` : null,
  ].filter(Boolean)
  return `Conversation Atlas, confirmed by the user: ${parts.join('; ')}.`
}

export function summary(s: AtlasSnapshot): { goal: string | null; nextStep: string | null; detour: string | null; topic: string | null; at: number } {
  return { goal: s.goal?.text ?? null, nextStep: s.nextStep ?? resumeHint(s)?.text ?? null, detour: s.detour?.reason ?? null, topic: currentTopic(s)?.title ?? null, at: s.events[s.events.length - 1]?.at ?? s.startedAt }
}
