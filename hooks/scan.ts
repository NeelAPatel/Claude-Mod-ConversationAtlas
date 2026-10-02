// Mapping a conversation that already happened: a session Atlas joins late (installed or
// reloaded mid-thread, resumed with no save). Pure: the hooks module reads the rows with
// `$.session.messages()` and, when asked, one `$.model.fork` reply.
//
//   replay      free; prompts, wording cues, files, tests, commits, open questions
//   claudeMap   one forked request; topics, decisions, open questions, next step
// Both write observations only, like everything else outside the confirm functions.

import type { AtlasSnapshot } from '../types'
import { askedQuestions, classify, isTestCommand } from './activity'
import { addCheckpoint, addQuestion, clip, observe, type ObserveReport, sentences, type Shift, startTurn, touchFile } from './model'

export type ScanRow = {
  role: 'user' | 'assistant'
  text: string
  toolUses?: readonly { tool: string; input: Record<string, unknown>; result?: unknown; isError?: true }[]
}

// Engine rows the person did not type: reminders, command echoes, task notifications.
function typed(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && !t.startsWith('<') && !t.startsWith('[Request interrupted')
}

export function replay(s: AtlasSnapshot, rows: readonly ScanRow[], now: number): AtlasSnapshot {
  let next = s
  let lastAnswer = ''
  for (const row of rows) {
    if (row.role === 'user') {
      if (typed(row.text)) next = startTurn(next, row.text, now)
      continue
    }
    if (row.text.trim()) lastAnswer = row.text
    for (const use of row.toolUses ?? []) {
      const c = classify(String(use.tool), use.input)
      if (!c || use.isError) continue
      for (const f of c.files) next = touchFile(next, f.path, f.op, now)
      if (c.isTest || (use.tool === 'Bash' && isTestCommand(String(use.input.command ?? '')))) next = addCheckpoint(next, 'Tests passed', 'tests', c.label.replace(/^Tests: /, ''), now)
      const commit = (use.result as { gitOperation?: { commit?: { sha?: string } } } | undefined)?.gitOperation?.commit
      if (commit?.sha) next = addCheckpoint(next, `Commit ${commit.sha.slice(0, 7)}`, 'commit', null, now)
      // A question Claude asked earlier and the person answered is history, not an open item.
      if (use.tool === 'AskUserQuestion' && use.result === undefined) for (const q of askedQuestions(use.input)) next = addQuestion(next, q, 'claude', now)
    }
  }
  const tail = (lastAnswer.trim().split(/\n\s*\n/).pop() ?? '').trim()
  const lastRow = rows[rows.length - 1]
  if (lastRow?.role === 'assistant' && tail.endsWith('?')) {
    const q = sentences(tail).filter(x => x.endsWith('?')).pop()
    if (q) next = addQuestion(next, q, 'engine', now)
  }
  return next
}

export const MAP_PROMPT = `Map this conversation so far for the user's Conversation Atlas pane. Reply with JSON only, no prose, no tool calls:
{"goal": "the user's main goal in their own words, or null",
 "topics": [{"topic": "at most 6 words", "shift": "subtopic | sibling | possible-detour | return", "why": "one line, only for possible-detour or return"}],
 "decisions": ["conclusions actually reached"],
 "questions": ["questions still open now"],
 "resolved": ["questions that were open and got answered"],
 "next": "the most useful next step to resume from"}
Topics in the order they happened, at most 12; the first one's shift is ignored. At most 8 decisions, 5 open questions. Observations only: do not decide anything for the user.`

const SHIFTS: Shift[] = ['same', 'subtopic', 'sibling', 'possible-detour', 'return']

function list(v: unknown, max: number): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(x => clip(x, 160)).filter(Boolean).slice(0, max) : []
}

// Parses the fork's reply; tolerant of a fenced block or text around the JSON.
export function parseMap(text: string): { topics: { topic: string; shift: Shift; why: string | null }[]; rest: ObserveReport } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  const topics = (Array.isArray(v.topics) ? v.topics : [])
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
    .map(t => ({
      topic: clip(t.topic, 60),
      shift: (SHIFTS.includes(t.shift as Shift) ? t.shift : 'sibling') as Shift,
      why: clip(t.why, 140) || null,
    }))
    .filter(t => t.topic)
    .slice(0, 12)
  const rest: ObserveReport = {
    goal: clip(v.goal, 140) || undefined,
    decisions: list(v.decisions, 8),
    questions: list(v.questions, 5),
    resolved: list(v.resolved, 8),
    next: clip(v.next, 140) || undefined,
  }
  return { topics, rest }
}

export function applyMap(s: AtlasSnapshot, map: NonNullable<ReturnType<typeof parseMap>>, now: number): AtlasSnapshot {
  let next = s
  for (const t of map.topics) next = observe(next, { topic: t.topic, shift: t.shift, why: t.why ?? undefined }, now)
  return observe(next, map.rest, now)
}
