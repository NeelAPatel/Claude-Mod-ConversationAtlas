// Conversation Atlas: a self-updating map of a long Claude Code session in a docked pane.
//
// Three feeds write OBSERVATIONS, none of them intent:
//   engine events   tool calls, files, tests, commits, subagents, questions   (no tokens)
//   your prompts    the first request, side-trip / return / decision wording (no tokens)
//   Claude          one short `observe` call when the topic moves or a decision lands
// INTENT (goal, detour, return, next step, marks) changes only when you press a pane
// button or type /atlas. See types/index.d.ts and hooks/model.ts.

import { type EngineInterface, type Register, type Timer, update } from 'claude-code'

import type { AtlasSnapshot, AtlasView } from '../types'
import { askedQuestions, classify, planTitle, posix } from './activity'
import type { LiveRow } from './live'
import {
  addCheckpoint,
  addQuestion,
  clearFresh,
  clip,
  confirmSuggestion,
  dismissSuggestion,
  emptySnapshot,
  endActivity,
  hydrate,
  intentLine,
  mark,
  observe,
  type ObserveReport,
  offerResume,
  openQuestions,
  promoteDetour,
  resolveQuestions,
  returnFromDetour,
  sentences,
  setGoal,
  setItemStatus,
  setNextStep,
  startActivity,
  startDetour,
  startTurn,
  summary,
  takeContext,
  touchFile,
  addDecision,
  addDetourFinding,
  adoptRecall,
  recordDecision,
  setRecall,
} from './model'
import { applyMap, MAP_PROMPT, parseMap, replay, type ScanRow } from './scan'
import { ATLAS_DIR, fromAtlasFile, fromTrailheadFile, mergeRecall, safeName, saveFile, TRAILHEAD_DIR } from './recall'
import { type Action, oneLine, pane, TONES } from './view'

const PLUGIN = 'conversation-atlas'
const SNAP = { plugin: 'conversation-atlas', key: 'snapshot' } as const
const VIEW = { plugin: 'conversation-atlas', key: 'view' } as const
const PANE = 'atlas'
const TOOL = 'mcp__conversation-atlas__observe'
const FLASH_MS = 4_000
const SAVE_MS = 2_000
const KEEP_SESSIONS = 12
const DEFAULT_VIEW: AtlasView = { tab: 'map', selected: null, editingGoal: false, drawer: null, scroll: 0 }

const RULES = `# Conversation Atlas
A side pane maps this session for the user. Keep it accurate with ${TOOL}: at the end of a turn where the topic moved, a decision was reached, a question opened or closed, or a milestone landed, call it once with only the fields that changed (short phrases, at most 6 words for a topic). shift: "same" (refining the current topic), "subtopic" (going deeper), "sibling" (next part of the same work), "possible-detour" (a side trip away from the user's goal), "return" (back to earlier work; name that topic). Skip it on trivial turns. It records observations only: never say the user's goal changed and never treat a detour as accepted; the user confirms goals, detours and returns in the pane. Do not mention the atlas to the user.`

type Raw = Record<string, unknown>

// A Client's props must be plain JSON: no undefined fields.
function plain(rows: LiveRow[]): LiveRow[] {
  return rows.map(r => ({ segs: r.segs.map(s => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== false)) as LiveRow['segs'][number]) }))
}

let sid = ''
let root = ''
let flashTimer: Timer | null = null
let lastSaved: AtlasSnapshot | undefined
let observedThisTurn = false
let activitySeq = 0
// How far the body could scroll at the last draw; clamps wheel and page moves.
let maxScroll = 0
let scanOnLaunch: 'off' | 'engine' | 'claude' = 'engine'
let scanning = false
const agentNames = new Map<string, string>()

// ------------------------------------------------------------------ state

async function snap($: EngineInterface): Promise<AtlasSnapshot | undefined> {
  return (await $.state.get(SNAP)).value
}

async function identity($: EngineInterface): Promise<{ sid: string; root: string }> {
  const [id, r] = await Promise.all([$.session.id(), $.session.root()])
  return { sid: id, root: posix(r) }
}

async function edit($: EngineInterface, fn: (s: AtlasSnapshot, now: number) => AtlasSnapshot): Promise<AtlasSnapshot> {
  const now = await $.clock.now()
  const before = await snap($)
  const out = await update($, SNAP, cur => fn(cur && cur.sessionId === sid ? cur : emptySnapshot(sid, root, now), now))
  if (out.fresh.length && out.fresh.join() !== (before?.fresh ?? []).join()) scheduleUnflash($)
  return out
}

function scheduleUnflash($: EngineInterface): void {
  flashTimer?.cancel()
  flashTimer = $.clock.after(FLASH_MS, () => {
    flashTimer = null
    void edit($, s => clearFresh(s))
  })
}

async function setView($: EngineInterface, fn: (v: AtlasView) => AtlasView): Promise<void> {
  await update($, VIEW, cur => fn({ ...DEFAULT_VIEW, ...(cur ?? {}) }))
}

// Binds the snapshot to the live session: same id keeps it (a hot reload), a saved one is
// restored (a resume), otherwise a fresh map that offers the project's last goal.
async function bind($: EngineInterface): Promise<void> {
  const who = await identity($)
  sid = who.sid
  root = who.root
  const cur = await snap($)
  if (cur?.sessionId === sid) return
  const now = await $.clock.now()
  const saved = await $.store.get(`session:${sid}`)
  let next = saved ? hydrate(saved, sid, root, now) : emptySnapshot(sid, root, now)
  if (!saved) {
    const previous = (await $.store.get(`project:${root}`)) as (ReturnType<typeof summary> & { sessionId?: string }) | undefined
    if (previous && previous.sessionId !== sid) next = offerResume(next, previous, now)
  }
  // Joined a thread that already has history (installed or reloaded mid-session, resumed
  // without a save): replay it for free so the map starts where the conversation is.
  const rows = scanOnLaunch === 'off' || next.scanned !== 'none' ? [] : await history($)
  if (rows.length) next = { ...replay(next, rows, now), scanned: 'engine' }
  await $.state.set(SNAP, next)
  if (rows.length > 2 && scanOnLaunch === 'claude') void mapWithClaude($).catch(() => undefined)
  lastSaved = saved ? next : undefined
  void loadRecall($).catch(() => undefined)
}

async function history($: EngineInterface): Promise<ScanRow[]> {
  try {
    const rows = await $.session.messages()
    return Array.isArray(rows) ? (rows as ScanRow[]) : []
  } catch {
    return []
  }
}

// One forked request over the session's own transcript (served mostly from the prompt
// cache): topics, decisions, open questions and a next step, added as observations.
async function mapWithClaude($: EngineInterface): Promise<string> {
  if (scanning) return 'A scan is already running.'
  scanning = true
  try {
    $.ui.toast('Atlas: mapping the conversation so far…')
    const reply = await $.model.fork({ prompt: MAP_PROMPT })
    if (!reply.isAnswered) return `Atlas could not map the conversation: ${reply.reason}`
    const map = parseMap(reply.text)
    if (!map) return 'Atlas could not read the map Claude returned.'
    await edit($, (s, now) => ({ ...applyMap(s, map, now), scanned: 'claude' }))
    const text = `Mapped ${map.topics.length} topics, ${map.rest.decisions?.length ?? 0} decisions, ${map.rest.questions?.length ?? 0} open questions. All are observations: confirm what is true in the Open tab.`
    $.ui.toast(text)
    return text
  } finally {
    scanning = false
  }
}

// Earlier sessions of this project from its .claude folder: Atlas saves and Trailhead checkpoints.
async function loadRecall($: EngineInterface): Promise<number> {
  const found: Parameters<typeof mergeRecall>[0] = []
  for (const [dir, parse] of [
    [ATLAS_DIR, fromAtlasFile],
    [TRAILHEAD_DIR, fromTrailheadFile],
  ] as const) {
    const path = `${root}/${dir}`
    let entries: { name: string; kind: string }[] = []
    try {
      entries = await $.fs.list(path)
    } catch {
      continue
    }
    for (const entry of entries.filter(x => x.kind === 'file' && x.name.endsWith('.json')).slice(0, 80)) {
      try {
        const text = await $.fs.read(`${path}/${entry.name}`)
        const hit = typeof text === 'string' ? parse(text, root) : null
        if (hit) found.push(hit)
      } catch {
        continue
      }
    }
  }
  const recall = mergeRecall(found)
  await edit($, s => setRecall(s, recall))
  return recall.filter(r => r.sessionId !== sid).length
}

async function ensureBound($: EngineInterface): Promise<void> {
  await setup($)
  if (!sid || (await $.session.id()) !== sid) await bind($)
}

async function save($: EngineInterface): Promise<void> {
  const s = await snap($)
  if (!s || s === lastSaved || s.sessionId !== sid) return
  lastSaved = s
  await $.store.set(`session:${s.sessionId}`, { ...s, fresh: [], pendingContext: [] })
  await $.store.set(`project:${s.root}`, { ...summary(s), sessionId: s.sessionId })
  // The project-local copy, so a later session (or another tool) finds this trail on disk.
  if (s.goal || s.topics.length || s.decisions.length) await $.fs.write(`${s.root}/${ATLAS_DIR}/${safeName(s.sessionId)}.json`, saveFile(s, await $.clock.now()))
  const sessions = (await $.store.keys()).filter(k => k.startsWith('session:'))
  for (const old of sessions.slice(0, Math.max(0, sessions.length - KEEP_SESSIONS))) await $.store.delete(old)
}

async function openPane($: EngineInterface, focus: boolean): Promise<boolean> {
  const opened = await $.ui.open({ id: PANE, title: 'Atlas', ...(focus ? { focus: true } : {}) })
  return opened.isPlaced
}

// ------------------------------------------------------------------ actions (the only intent writers)

async function act($: EngineInterface, a: Action): Promise<void> {
  switch (a.type) {
    case 'tab':
      return setView($, v => ({ ...v, tab: a.tab, scroll: 0 }))
    case 'drawer':
      return setView($, v => ({ ...v, drawer: v.drawer === a.drawer ? null : a.drawer }))
    case 'scroll':
      return setView($, v => ({ ...v, scroll: Math.max(0, Math.min(maxScroll, v.scroll + a.by)) }))
    case 'exclude':
      await edit($, (s, now) => setItemStatus(s, a.id, 'excluded', now))
      return
    case 'scan': {
      const rows = await history($)
      if ((await snap($))?.scanned === 'none' && rows.length) await edit($, (s, now) => ({ ...replay(s, rows, now), scanned: 'engine' }))
      await mapWithClaude($)
      return
    }
    case 'adopt':
      await edit($, (s, now) => adoptRecall(s, a.id, now))
      $.ui.toast('Resumed: the earlier goal, next step and decisions are back')
      return
    case 'select':
      return setView($, v => ({ ...v, selected: a.selection }))
    case 'unselect':
      return setView($, v => ({ ...v, selected: null }))
    case 'edit-goal':
      return setView($, v => ({ ...v, editingGoal: !v.editingGoal }))
    case 'goal': {
      const s = await edit($, (cur, now) => setGoal(cur, a.text, 'person', now))
      await setView($, v => ({ ...v, editingGoal: false }))
      if (s.detour) $.ui.toast('Return from the detour (or make it the goal) before changing the goal')
      return
    }
    case 'pin':
      await edit($, (s, now) => setNextStep(s, a.text, now))
      return
    case 'confirm': {
      const before = await snap($)
      const kind = before?.suggestions.find(x => x.id === a.id)?.kind
      await edit($, (s, now) => confirmSuggestion(s, a.id, now))
      if (kind === 'return') $.ui.toast('Return packet goes to Claude with your next message')
      if (kind === 'detour') $.ui.toast('Detour started; the atlas remembers where to come back to')
      return
    }
    case 'dismiss':
      await edit($, (s, now) => dismissSuggestion(s, a.id, now))
      return
    case 'settle':
      await edit($, (s, now) => setItemStatus(s, a.id, 'settled', now))
      return
    case 'drop':
      await edit($, (s, now) => setItemStatus(s, a.id, 'drop', now))
      return
    case 'resolve':
      await edit($, (s, now) => setItemStatus(s, a.id, 'resolved', now))
      return
    case 'reopen':
      await edit($, (s, now) => setItemStatus(s, a.id, 'open', now))
      return
    case 'return': {
      await edit($, (s, now) => returnFromDetour(s, now))
      $.ui.toast('Return packet goes to Claude with your next message')
      return
    }
    case 'promote':
      await edit($, (s, now) => promoteDetour(s, now))
      return
    case 'mark':
      await edit($, (s, now) => mark(s, '', now))
      $.ui.toast('Checkpoint marked')
      return
  }
}

const HELP = [
  'Atlas commands (the pane buttons do the same):',
  '  /atlas                          open the pane',
  '  /atlas goal <text>              set your goal (alias: aim)',
  '  /atlas next <step>              pin the next step',
  '  /atlas mark [name]              mark a checkpoint to come back to',
  '  /atlas decision <text> [--reason <why>]   record a settled decision',
  '  /atlas detour <reason>          start a side trip from the latest mark',
  '  /atlas outcome <finding>        keep a finding from the detour',
  '  /atlas exclude <material>       set detour material aside',
  '  /atlas return                   end the detour; Claude gets one recap',
  '  /atlas promote                  make the detour your goal',
  '  /atlas scan                     map the conversation so far with Claude (one cached request)',
  '  /atlas recover [n]              list earlier sessions (Atlas + Trailhead), or resume number n',
  "  /atlas reset                    clear this session's map",
].join('\n')

async function command($: EngineInterface, args: string): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const text = rest.join(' ')
  const s = await snap($)
  switch (verb) {
    case '':
      return (await openPane($, true)) ? 'Atlas opened.' : 'Atlas is waiting for room: widen the terminal or use /tui fullscreen.'
    case 'help':
      return HELP
    case 'goal':
    case 'aim':
      if (!text) return HELP
      if (s?.detour) return 'Return from the detour (or /atlas promote) before changing the goal.'
      await edit($, (cur, now) => setGoal(cur, text, 'person', now))
      return `Goal confirmed: ${clip(text, 140)}`
    case 'next':
      if (!text) return HELP
      await edit($, (cur, now) => setNextStep(cur, text, now))
      return `Next step pinned: ${clip(text, 140)}`
    case 'decision': {
      const [what = '', why] = text.split(/\s--reason\s/)
      if (!what.trim()) return HELP
      await edit($, (cur, now) => recordDecision(cur, what.trim(), why?.trim() || null, now))
      return `Decision settled: ${clip(what, 140)}`
    }
    case 'detour':
      if (!text) return HELP
      if (s?.detour) return `Already on a detour: ${s.detour.reason}. /atlas return first.`
      await edit($, (cur, now) => startDetour(cur, text, null, now))
      return `Detour started: ${clip(text, 120)}`
    case 'outcome':
    case 'exclude':
      if (!s?.detour) return 'No active detour.'
      if (!text) return HELP
      await edit($, (cur, now) => addDetourFinding(cur, verb === 'outcome' ? 'outcomes' : 'exclusions', text, now))
      return `${verb === 'outcome' ? 'Outcome kept' : 'Excluded'}: ${clip(text, 140)}`
    case 'return':
      if (!s?.detour) return 'No active detour.'
      await edit($, (cur, now) => returnFromDetour(cur, now))
      return `Returned from: ${s.detour.reason}. The return packet goes to Claude with your next message.`
    case 'promote':
      if (!s?.detour) return 'No active detour.'
      await edit($, (cur, now) => promoteDetour(cur, now))
      return `Goal is now: ${s.detour.reason}`
    case 'mark':
      await edit($, (cur, now) => mark(cur, text, now))
      return 'Checkpoint marked.'
    case 'recover': {
      await loadRecall($)
      const list = (await snap($))?.recall ?? []
      if (!list.length) return 'No earlier Atlas or Trailhead sessions found in this project.'
      const n = Number(text)
      if (text && Number.isInteger(n) && n >= 1 && n <= list.length) {
        const pick = list[n - 1]
        if (!pick) return 'No such session.'
        await edit($, (cur, now) => adoptRecall(cur, pick.id, now))
        return `Resumed ${pick.source} session ${pick.sessionId.slice(0, 8)}: ${pick.goal ?? 'no goal recorded'}`
      }
      return [
        'Earlier sessions (resume with /atlas recover <n>, or in the Evidence tab):',
        ...list.map((r, i) => `  ${i + 1}. ${r.goal ?? 'no goal'} · ${r.source} · ${r.sessionId.slice(0, 8)}${r.detour ? ` · on detour: ${r.detour}` : ''}${r.nextStep ? ` · next: ${r.nextStep}` : ''}`),
      ].join('\n')
    }
    case 'scan': {
      const rows = await history($)
      if (s?.scanned === 'none' && rows.length) await edit($, (cur, now) => ({ ...replay(cur, rows, now), scanned: 'engine' }))
      return mapWithClaude($)
    }
    case 'reset': {
      const now = await $.clock.now()
      await $.state.set(SNAP, emptySnapshot(sid, root, now))
      return 'Atlas cleared for this session.'
    }
    default:
      return `Unknown: ${verb}\n${HELP}`
  }
}

// Registration runs once per load, on whichever event reaches the module first. A hot
// reload does not always raise session.start, so every hook below also calls this.
let ready: Promise<void> | null = null
let askClaude = true
let lastProblem: string | null = null
let saving: Timer | null = null

function setup($: EngineInterface): Promise<void> {
  ready ??= (async () => {
    const failed: string[] = []
    const step = async (name: string, run: () => Promise<unknown>) => {
      try {
        await run()
      } catch (err) {
        failed.push(name)
        $.ui.log(`${PLUGIN}: ${name} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    await step('command /atlas', () => $.command.register({ name: 'atlas', description: 'ConversationAtlas: open the pane, or goal, next, mark, decision, detour, outcome, exclude, return, promote, scan, recover, help', argumentHint: '[goal|next|mark|decision|detour|outcome|exclude|return|promote|scan|recover|help] [text]' }))
    await step('session binding', () => bind($))
    if (askClaude) {
      await step('observe tool', async () => {
        await $.tool.register({
          name: 'observe',
          description: 'Record what moved in this session on the Conversation Atlas pane: topic and shift, decisions, open or resolved questions, the next step, a milestone. Observations only; the user confirms intent.',
          inputSchema: {
            type: 'object',
            properties: {
              topic: { type: 'string', description: 'What the conversation is about now, at most 6 words' },
              shift: { type: 'string', enum: ['same', 'subtopic', 'sibling', 'possible-detour', 'return'] },
              why: { type: 'string', description: 'One line, for possible-detour or return' },
              decisions: { type: 'array', items: { type: 'string' }, description: 'Conclusions reached this turn' },
              questions: { type: 'array', items: { type: 'string' }, description: 'Questions left open for the user' },
              resolved: { type: 'array', items: { type: 'string' }, description: 'Earlier open questions now answered' },
              next: { type: 'string', description: 'The most useful next step to resume from' },
              checkpoint: { type: 'string', description: 'A milestone just reached, a few words' },
              goal: { type: 'string', description: 'Only while no goal is confirmed: the goal you infer' },
            },
          },
        })
      })
    }
    saving?.cancel()
    saving = $.clock.every(SAVE_MS, () => void save($).catch(() => undefined))
    await step('pane', () => openPane($, false))
    const problem = failed.join(', ')
    if (problem !== lastProblem) $.ui.toast(problem ? `Atlas loaded with problems: ${problem}` : 'Atlas ready: /atlas or the footer button')
    lastProblem = problem
    // A step that failed (say, before the session bound) is tried again on the next event.
    if (failed.length) ready = null
  })()
  return ready
}

// ------------------------------------------------------------------ hooks

export const register: Register = (on, options) => {
  askClaude = options?.observer !== 'engine only'
  scanOnLaunch = options?.scanOnLaunch === 'off' || options?.scanOnLaunch === 'claude' ? options.scanOnLaunch : 'engine'
  ready = null

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await setup($)
    return result
  })

  on('session.end', async ($, e, next) => {
    await save($).catch(() => undefined)
    if (e.reason === 'clear') sid = ''
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!askClaude) return result
    return { sections: [...result.sections, { id: `${PLUGIN}:rules`, text: RULES, scope: 'session' as const }] }
  })

  // What the person asked for this turn, and what the atlas hands Claude beside it.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    await ensureBound($)
    const extra: string[] = []
    let taken: string[] = []
    await update($, SNAP, cur => {
      if (!cur) return emptySnapshot(sid, root, 0)
      const [ctx, rest] = takeContext(cur)
      taken = ctx
      return rest
    })
    extra.push(...taken)
    const view = (await $.state.get(VIEW)).value
    if (view?.selected) {
      extra.push(`The user selected this in the Conversation Atlas pane; "this" or "it" in the prompt likely refers to it. ${view.selected.kind}: ${view.selected.text}`)
      await setView($, v => ({ ...v, selected: null }))
    }
    const s = await snap($)
    const line = s ? intentLine(s) : null
    if (line) extra.push(line)
    return next(extra.length ? { ...e, context: [...(e.context ?? []), ...extra] } : e)
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    observedThisTurn = false
    await ensureBound($)
    await edit($, (s, now) => startTurn(s, e.text, now))
    return result
  })

  // A main turn that ends on a question Claude did not report leaves that question open.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.reason !== 'answer' || observedThisTurn) return result
    const last = (e.answer.trim().split(/\n\s*\n/).pop() ?? '').trim()
    if (last.endsWith('?')) {
      const q = sentences(last).filter(x => x.endsWith('?')).pop()
      if (q) await edit($, (s, now) => addQuestion(s, q, 'engine', now))
    }
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if ('agentId' in started && started.agentId) agentNames.set(started.agentId, clip(e.description || e.subagentType, 24))
    return started
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const raw = e as unknown as Raw
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(x => clip(x, 160)).filter(Boolean).slice(0, 6) : undefined)
    const shift = typeof raw.shift === 'string' && ['same', 'subtopic', 'sibling', 'possible-detour', 'return'].includes(raw.shift) ? (raw.shift as ObserveReport['shift']) : undefined
    const report: ObserveReport = {
      topic: clip(raw.topic, 60) || undefined,
      shift,
      why: clip(raw.why, 140) || undefined,
      decisions: list(raw.decisions),
      questions: list(raw.questions),
      resolved: list(raw.resolved),
      next: clip(raw.next, 140) || undefined,
      checkpoint: clip(raw.checkpoint, 60) || undefined,
      goal: clip(raw.goal, 140) || undefined,
    }
    await ensureBound($)
    await edit($, (s, now) => observe(s, report, now))
    observedThisTurn = true
    return { result: 'noted' }
  })

  // Every other tool call: an activity row while it runs, then files, tests, commits.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Raw
    const c = classify(tool, input)
    if (!c) return next(e)
    await ensureBound($)
    const aid = `a${++activitySeq}`
    const agent = e.agentId ? (agentNames.get(e.agentId) ?? 'agent') : null
    const asked = tool === 'AskUserQuestion' ? askedQuestions(input) : []
    await edit($, (s, now) => {
      let out = startActivity(s, { id: aid, kind: c.kind, label: c.label, at: now, agent })
      for (const q of asked) out = addQuestion(out, q, 'claude', now)
      return out
    })
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (err) {
      await edit($, (s, now) => endActivity(s, aid, 'failed', now))
      throw err
    }
    const failed = ran.deny !== undefined || ran.isError === true
    const result = (ran.result && typeof ran.result === 'object' ? ran.result : {}) as Raw
    const commit = (result.gitOperation as { commit?: { sha?: string } } | undefined)?.commit
    await edit($, (s, now) => {
      let out = endActivity(s, aid, failed ? 'failed' : 'done', now, c.isTest ? `Tests ${failed ? 'failed' : 'passed'}: ${c.label.replace(/^Tests: /, '')}` : undefined)
      if (failed) return out
      for (const f of c.files) out = touchFile(out, f.path, f.op, now)
      if (c.isTest) out = addCheckpoint(out, 'Tests passed', 'tests', c.label.replace(/^Tests: /, ''), now)
      if (commit?.sha) out = addCheckpoint(out, `Commit ${commit.sha.slice(0, 7)}`, 'commit', typeof input.command === 'string' ? clip(input.command, 120) : null, now)
      if (asked.length) out = resolveQuestions(out, asked, now)
      if (tool === 'ExitPlanMode') {
        const plan = typeof result.plan === 'string' ? result.plan : typeof input.plan === 'string' ? input.plan : ''
        out = addDecision(out, planTitle(plan), 'engine', now)
      }
      return out
    })
    return ran
  })

  on('command.run', { command: 'atlas' }, async ($, e) => {
    await ensureBound($)
    return { text: await command($, e.args ?? '') }
  })

  // Always in the footer while the mod is loaded: opens the pane anywhere, at any width.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const below = await next(e)
    const s = await snap($)
    const { Box, Button } = $.ui.resolve(e)
    const waiting = s ? s.suggestions.length + openQuestions(s).length : 0
    const label = s ? clip(`${oneLine(s)}${waiting ? ` · ${waiting}` : ''}`, 36) : 'Atlas'
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Button key="atlas-open" dimColor={waiting === 0} label={label} onPress={() => void openPane($, true)} />
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text } = t
    const s = await snap($)
    if (!s) return <Text dimColor>Atlas is starting…</Text>
    const view = { ...DEFAULT_VIEW, ...((await $.state.get(VIEW)).value ?? {}) }
    const now = await $.clock.now()
    const width = Math.max(20, (e.props.bodyColumns || 48) - 2)
    const Client = 'Client' in t ? t.Client : undefined
    const live = (key: string, rows: LiveRow[]) =>
      Client ? (
        <Client key={`live-${key}`} module="./live.tsx" props={{ rows: plain(rows), tones: TONES }} />
      ) : (
        <Box key={`live-${key}`} flexDirection="column">
          {rows.map(r => (
            <Text wrap="truncate-end">{r.segs.map(seg => (seg.spin ? '… ' : seg.t)).join('')}</Text>
          ))}
        </Box>
      )
    const el = { Box: t.Box, Text: t.Text, Button: t.Button, Input: 'Input' in t ? t.Input : undefined }
    const rows = Math.max(8, e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30)
    const drawn = pane({ el, width, rows, now, view, live, act: a => void act($, a).catch(err => $.ui.toast(`atlas: ${err instanceof Error ? err.message : String(err)}`)) }, s)
    maxScroll = drawn.maxScroll
    return drawn.tree
  })

  // The pane scrolls its own body (the app bar stays pinned): wheel and page keys land here.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await setView($, v => ({ ...v, scroll: Math.max(0, Math.min(maxScroll, v.scroll + e.by)) }))
    return {}
  })
}

