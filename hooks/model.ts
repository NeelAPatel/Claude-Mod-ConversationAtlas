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
  AtlasItem,
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
    events: [],
    pendingContext: [],
    fresh: [],
  }
}

// Fill fields a snapshot saved by an older build may lack, so a restore never breaks a render.
export function hydrate(raw: unknown, sessionId: string, root: string, now: number): AtlasSnapshot {
  const base = emptySnapshot(sessionId, root, now)
  if (!raw || typeof raw !== 'object') return base
  const s = raw as Partial<AtlasSnapshot>
  if (s.v !== 1) return base
  return { ...base, ...s, sessionId, root, fresh: [], activity: (s.activity ?? []).map(a => (a.state === 'running' ? { ...a, state: 'failed' as const, endedAt: a.endedAt ?? now } : a)) }
}

function id(s: AtlasSnapshot, prefix: string): [string, AtlasSnapshot] {
  const seq = s.seq + 1
  return [`${prefix}${seq}`, { ...s, seq }]
}

function keep<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(list.length - max) : list
}

function event(s: AtlasSnapshot, kind: AtlasEvent['kind'], text: string, now: number): AtlasSnapshot {
  const [eid, next] = id(s, 'e')
  return { ...next, events: keep([...next.events, { id: eid, at: now, turn: s.turn, kind, text: clip(text, 160) }], LIMITS.events) }
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
    // A decision the person settles during a detour is an accepted outcome of it (Trailhead's /trail outcome).
    next = { ...next, detour: { ...s.detour, outcomes: [...s.detour.outcomes, hit.text].slice(-20) } }
  }
  const verb = status === 'settled' ? 'Settled' : status === 'resolved' ? 'Resolved' : status === 'open' ? 'Reopened' : status === 'drop' ? 'Dropped' : 'Marked'
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

function sentenceWith(text: string, cue: RegExp): string {
  return sentences(text).find(p => cue.test(p)) ?? text
}

export function startTurn(s: AtlasSnapshot, text: string, now: number): AtlasSnapshot {
  const body = text.trim()
  let next: AtlasSnapshot = { ...s, turn: s.turn + 1 }
  if (!body) return next
  next = event(next, 'prompt', body.split('\n')[0] ?? body, now)
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

export function touchFile(s: AtlasSnapshot, path: string, op: 'read' | 'write', now: number): AtlasSnapshot {
  if (!path) return s
  const hit = s.files.find(f => f.path === path)
  const file: AtlasFile = hit
    ? { ...hit, reads: hit.reads + (op === 'read' ? 1 : 0), writes: hit.writes + (op === 'write' ? 1 : 0), lastOp: op, at: now, turn: s.turn }
    : { path, reads: op === 'read' ? 1 : 0, writes: op === 'write' ? 1 : 0, lastOp: op, at: now, turn: s.turn }
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
  return flash(event({ ...next, checkpoints: keep([...next.checkpoints, cp], LIMITS.checkpoints) }, 'checkpoint', `${kindLabel(kind)}: ${label}`, now), cid)
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
