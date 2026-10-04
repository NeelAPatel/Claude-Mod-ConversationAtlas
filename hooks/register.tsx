// Conversation Atlas: a self-updating map of a long Claude Code session in a docked pane.
//
// Three feeds write OBSERVATIONS, none of them intent:
//   engine events   tool calls, files, tests, commits, subagents, questions   (no tokens)
//   your prompts    the first request, side-trip / return / decision wording (no tokens)
//   Claude          one short `observe` call when the topic moves or a decision lands
// INTENT (goal, detour, return, next step, marks) changes only when you press a pane
// button or type /atlas. See types/index.d.ts and hooks/model.ts.

import { type EngineInterface, type Register, type Timer, update } from 'claude-code'

import type { AtlasMode, AtlasScanState, AtlasSnapshot, AtlasTrailView, AtlasView } from '../types'
import { askedQuestions, classify, planTitle, posix } from './activity'
import type { LiveRow } from './live'
import { expectedReportPath, handoffStart, parseHandoffReport, reportChanged, reportFingerprint } from './delegation'
import {
  addCheckpoint,
  addQuestion,
  clearFresh,
  closeUnverifiedHandoffs,
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
  reportHandoff,
  resolveQuestions,
  reportMarker,
  returnFromDetour,
  sentences,
  setGoal,
  setItemStatus,
  setHandoffTaskId,
  setNextStep,
  startActivity,
  startHandoff,
  startDetour,
  startTurn,
  summary,
  takeContext,
  upgrade,
  touchFile,
  addDecision,
  addDetourFinding,
  adoptRecall,
  hasReplaceableContent,
  recoverFull,
  recordDecision,
  setRecall,
} from './model'
import { applyMap, MAP_PROMPT, parseMap, replay, type ScanRow } from './scan'
import {
  ATLAS_DIR,
  fromAtlasFile,
  fromAtlasFullFile,
  atlasFullFileError,
  fromTrailheadFile,
  mergeRecall,
  pickRecallEntries,
  safeName,
  saveFile,
  sessionsToDelete,
  TRAILHEAD_DIR,
  type AtlasFullRecall,
} from './recall'
import { type Action, oneLine, pane, TONES } from './view'
import type { Surface } from './ui/shared'

const PLUGIN = 'conversation-atlas'
const SNAP = { plugin: 'conversation-atlas', key: 'snapshot' } as const
const VIEW = { plugin: 'conversation-atlas', key: 'view' } as const
const SCAN = { plugin: 'conversation-atlas', key: 'scanning' } as const
const PANE = 'atlas'
const TOOL = 'mcp__conversation-atlas__observe'
const TRAIL_VIEW_STORE = 'trail-view'
const FLASH_MS = 4_000
const SAVE_MS = 2_000
const KEEP_SESSIONS = 12
const SCAN_RESULT_MS = 4_000
const MODE = { plugin: 'conversation-atlas', key: 'mode' } as const
const DEFAULT_VIEW: AtlasViewState = {
  setup: false,
  tab: 'map',
  refs: {},
  nextRef: 1,
  editingGoal: false,
  legend: false,
  popup: null,
  popupScroll: 0,
  legendScroll: 0,
  scroll: 0,
  trailNewest: true,
  trailView: 'story',
  expanded: null,
  expandedScroll: 0,
  fullConfirm: null,
  hidden: [],
  settingsPage: 0,
}

type AtlasViewState = AtlasView & { hidden: string[]; settingsPage: number }

const RULES = `# Conversation Atlas
 A side pane maps this session for the user. Keep it accurate with ${TOOL}: at the end of a turn where the topic moved, a decision was reached,
 a question opened or closed, or a milestone landed, call it once with only the fields that changed (short phrases, at most 6 words for a topic).
 Call ${TOOL} in parallel with another tool call already needed in this response; never alone in a final round.
 If none is needed, skip it and report it on the next tool-using turn.
 shift: "same" (refining the current topic), "subtopic" (going deeper), "sibling" (next part of the same work),
 "possible-detour" (a side trip away from the user's goal), "return" (back to earlier work; name that topic). Skip it on trivial turns.
 Report goal whenever the user's apparent overall aim changes; Atlas shows that as an observation, never as a confirmed goal.
 It records observations only: never say the user's confirmed goal changed and never treat a detour as accepted;
 the user confirms goals, detours and returns in the pane.
 Do not mention the atlas to the user.`

type Raw = Record<string, unknown>

function taskIdOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Raw
  for (const key of ['taskId', 'task_id', 'task-id']) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string
  }
  for (const key of ['result', 'task', 'metadata']) {
    const nested = taskIdOf(record[key])
    if (nested) return nested
  }
  return null
}

// A Client's props must be plain JSON: no undefined fields.
function plain(rows: LiveRow[]): LiveRow[] {
  const clean = (segs: LiveRow['segs']) => segs.map(s => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== false)) as LiveRow['segs'][number])
  return rows.map(r => (r.right?.length ? { segs: clean(r.segs), right: clean(r.right) } : { segs: clean(r.segs) }))
}

let sid = ''
let root = ''
let flashTimer: Timer | null = null
let lastSaved: AtlasSnapshot | undefined
let observedThisTurn = false
let activitySeq = 0
type ScrollBounds = {
  bodyRows: number
  maxScroll: number
  maxPopupScroll: number
  maxExpandedScroll: number
  maxLegendScroll: number
}
const EMPTY_BOUNDS: ScrollBounds = {
  bodyRows: 0, maxScroll: 0, maxPopupScroll: 0, maxExpandedScroll: 0, maxLegendScroll: 0,
}
// Each surface owns the bounds measured by its last draw.
const surfaceBounds = new Map<Surface, ScrollBounds>()

function wheelBounds(bodyRows: number): ScrollBounds {
  const bounds = [...surfaceBounds.values()]
  const matches = bounds.filter(bound => bound.bodyRows === bodyRows)
  if (matches.length === 1) return matches[0] ?? EMPTY_BOUNDS
  // Wheel events have no surface identity. Ambiguous sizes must not impose
  // the smaller surface's bounds on the larger one; each draw still clamps.
  return bounds.reduce((largest, bound) => ({
    bodyRows,
    maxScroll: Math.max(largest.maxScroll, bound.maxScroll),
    maxPopupScroll: Math.max(largest.maxPopupScroll, bound.maxPopupScroll),
    maxExpandedScroll: Math.max(largest.maxExpandedScroll, bound.maxExpandedScroll),
    maxLegendScroll: Math.max(largest.maxLegendScroll, bound.maxLegendScroll),
  }), EMPTY_BOUNDS)
}
let scanOnLaunch: 'off' | 'engine' | 'claude' = 'engine'
let configuredMode: AtlasMode = 'claude'
let observerToolRegistered = false
const agentNames = new Map<string, string>()

// ------------------------------------------------------------------ state

async function snap($: EngineInterface): Promise<AtlasSnapshot | undefined> {
  const value = (await $.state.get(SNAP)).value
  return value ? upgrade(value) : value
}

function isScanState(value: unknown): value is AtlasScanState {
  if (!value || typeof value !== 'object') return false
  const scan = value as Partial<AtlasScanState>
  return typeof scan.active === 'boolean' && typeof scan.startedAt === 'number' && (typeof scan.result === 'string' || scan.result === null) && typeof scan.resultAt === 'number'
}

async function scanState($: EngineInterface): Promise<AtlasScanState> {
  const value = (await $.state.get(SCAN)).value
  return isScanState(value) ? value : EMPTY_SCAN
}

async function ensureScanState($: EngineInterface): Promise<void> {
  await update($, SCAN, cur => isScanState(cur) ? cur : EMPTY_SCAN)
}

async function identity($: EngineInterface): Promise<{ sid: string; root: string }> {
  const [id, r] = await Promise.all([$.session.id(), $.session.root()])
  return { sid: id, root: posix(r) }
}

async function edit($: EngineInterface, fn: (s: AtlasSnapshot, now: number) => AtlasSnapshot): Promise<AtlasSnapshot> {
  const now = await $.clock.now()
  const before = await snap($)
  const out = await update($, SNAP, cur => fn(cur && cur.sessionId === sid ? upgrade(cur) : emptySnapshot(sid, root, now), now))
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

async function setView($: EngineInterface, fn: (v: AtlasViewState) => AtlasViewState): Promise<void> {
  await update($, VIEW, cur => fn({ ...DEFAULT_VIEW, ...(cur ?? {}) }))
}

async function trailViewChoice($: EngineInterface): Promise<AtlasTrailView> {
  const value = await $.store.get(TRAIL_VIEW_STORE)
  if (!value || typeof value !== 'object') return 'story'
  const view = (value as { view?: unknown }).view
  return view === 'log' || view === 'story' ? view : 'story'
}

async function isLegendOpen($: EngineInterface): Promise<boolean> {
  const value = (await $.state.get(VIEW)).value
  return Boolean(value && typeof value === 'object' && (value as Partial<AtlasView>).legend)
}

type SetupChoice = { observer: AtlasMode; at: number }

function isMode(value: unknown): value is AtlasMode {
  return value === 'claude' || value === 'engine'
}

async function setupChoice($: EngineInterface): Promise<SetupChoice | undefined> {
  const value = await $.store.get('setup')
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Raw
  return isMode(raw.observer) && typeof raw.at === 'number' ? { observer: raw.observer, at: raw.at } : undefined
}

// Before consent, engine-only is always the effective mode. The userConfig value
// is only the setup screen's default; a stored choice is authoritative thereafter.
async function syncMode($: EngineInterface): Promise<AtlasMode> {
  const choice = await setupChoice($)
  const mode: AtlasMode = choice?.observer ?? 'engine'
  await $.state.set(MODE, mode)
  const trailView = await trailViewChoice($)
  const savedView = await $.store.get(TRAIL_VIEW_STORE)
  const hidden = savedView && typeof savedView === 'object' && Array.isArray((savedView as Raw).hidden)
    ? (savedView as { hidden: unknown[] }).hidden.filter((type): type is string => type === 'b' || type === 'h')
    : []
  await setView($, v => ({ ...v, setup: !choice, trailView, hidden }))
  return mode
}

async function modeOf($: EngineInterface): Promise<AtlasMode> {
  const value = (await $.state.get(MODE)).value
  if (isMode(value)) return value
  const choice = await setupChoice($)
  return choice?.observer ?? 'engine'
}

const OBSERVER_TOOL = {
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
      goal: { type: 'string', description: 'The apparent overall aim when it changes; Atlas records it as an observation and never treats it as confirmed' },
    },
  },
} as const

async function registerObserverTool($: EngineInterface): Promise<void> {
  if (observerToolRegistered) return
  await $.tool.register(OBSERVER_TOOL)
  observerToolRegistered = true
}

async function chooseObserver($: EngineInterface, mode: AtlasMode): Promise<void> {
  const at = await $.clock.now()
  await $.store.set('setup', { observer: mode, at })
  await $.state.set(MODE, mode)
  await setView($, v => ({ ...v, setup: false, popup: null, popupScroll: 0, scroll: 0 }))
  if (mode === 'claude') await registerObserverTool($)
}

// Binds the snapshot to the live session: same id keeps it (a hot reload), a saved one is
// restored (a resume), otherwise a fresh map that offers the project's last goal.
async function bind($: EngineInterface): Promise<void> {
  const who = await identity($)
  sid = who.sid
  root = who.root
  await ensureScanState($)
  const mode = await syncMode($)
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
  if (rows.length > 2 && scanOnLaunch === 'claude' && mode === 'claude') void mapWithClaude($).catch(() => undefined)
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
  const current = await scanState($)
  if (current.active) return 'A scan is already running.'
  const startedAt = await $.clock.now()
  await update($, SCAN, cur => {
    const previous = isScanState(cur) ? cur : EMPTY_SCAN
    return previous.active ? previous : { active: true, startedAt, result: null, resultAt: 0 }
  })
  scanResultTimer?.cancel()
  scanResultTimer = null
  let outcome = ''
  try {
    $.ui.toast('Atlas: mapping the conversation so far…')
    const reply = await $.model.fork({ prompt: MAP_PROMPT })
    if (!reply.isAnswered) outcome = `Atlas could not map the conversation: ${reply.reason}`
    else {
      const map = parseMap(reply.text)
      if (!map) outcome = 'Atlas could not read the map Claude returned.'
      else {
        await edit($, (s, now) => ({ ...applyMap(s, map, now), scanned: 'claude' }))
        outcome = `Mapped ${map.topics.length} topics, ${map.rest.decisions?.length ?? 0} decisions, ${map.rest.questions?.length ?? 0} open questions. All are observations: confirm what is true in the Open tab.`
      }
    }
  } catch (err) {
    outcome = `Atlas could not map the conversation: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    const result = outcome || 'Atlas could not map the conversation.'
    const resultAt = await $.clock.now()
    await update($, SCAN, cur => {
      const previous = isScanState(cur) ? cur : EMPTY_SCAN
      return { ...previous, active: false, startedAt, result, resultAt }
    })
    scanResultTimer = $.clock.after(SCAN_RESULT_MS, () => {
      scanResultTimer = null
      void update($, SCAN, cur => {
        if (!isScanState(cur) || cur.resultAt !== resultAt) return isScanState(cur) ? cur : EMPTY_SCAN
        return { ...cur, result: null, resultAt: 0 }
      }).catch(() => undefined)
    })
    $.ui.toast(result)
  }
  return outcome || 'Atlas could not map the conversation.'
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
    const candidates = entries.filter(x => x.kind === 'file' && x.name.endsWith('.json'))
    const dated = await Promise.all(candidates.map(async entry => {
      try {
        const stat = await $.fs.stat(`${path}/${entry.name}`)
        return { name: entry.name, mtimeMs: stat.mtimeMs }
      } catch {
        return { name: entry.name }
      }
    }))
    for (const entry of pickRecallEntries(dated, 80)) {
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

async function readFullRecall(
  $: EngineInterface,
  recall: { source: string; sessionId: string },
): Promise<{ source: AtlasFullRecall | null; error: string | null }> {
  if (recall.source !== 'atlas') return { source: null, error: 'full recovery is available only for Atlas save files' }
  try {
    const text = await $.fs.read(`${root}/${ATLAS_DIR}/${safeName(recall.sessionId)}.json`)
    if (typeof text !== 'string') return { source: null, error: 'save file is not text' }
    const source = fromAtlasFullFile(text, root)
    if (source) return { source, error: null }
    return { source: null, error: atlasFullFileError(text, root) ?? 'invalid Atlas save' }
  } catch {
    return { source: null, error: 'could not read the save file' }
  }
}

// External agents cannot send a turn notification back through the engine. A
// report file is the deliberately visible bridge; malformed or still-written
// files are ignored until a later turn/timer check.
async function checkHandoffReports($: EngineInterface): Promise<void> {
  const current = await snap($)
  const open = current?.handoffs.filter(h => h.status === 'open' && h.reportPath) ?? []
  if (!open.length) return
  for (const handoff of open) {
    let raw: unknown
    try {
      raw = await $.fs.read(handoff.reportPath as string)
    } catch {
      continue
    }
    if (!reportChanged(handoff.reportFingerprint, raw)) continue
    const report = parseHandoffReport(raw)
    if (!report) continue
    await edit($, (s, now) => {
      let next = reportHandoff(s, report.summary, now, handoff.agent, handoff.id, report.tests, report.files)
      for (const file of report.files) next = touchFile(next, file, 'write', now, handoff.agent)
      return next
    })
  }
}

async function ensureBound($: EngineInterface): Promise<void> {
  await setup($)
  if (!sid || (await $.session.id()) !== sid) await bind($)
}

async function save($: EngineInterface): Promise<void> {
  const s = await snap($)
  if (!s || s === lastSaved || s.sessionId !== sid) return
  lastSaved = s
  const savedAt = await $.clock.now()
  await $.store.set(`session:${s.sessionId}`, { ...s, fresh: [], pendingContext: [], savedAt })
  await $.store.set(`project:${s.root}`, { ...summary(s), sessionId: s.sessionId })
  // The project-local copy, so a later session (or another tool) finds this trail on disk.
  if (s.goal || s.topics.length || s.decisions.length) await $.fs.write(`${s.root}/${ATLAS_DIR}/${safeName(s.sessionId)}.json`, saveFile(s, savedAt))
  const keys = (await $.store.keys()).filter(k => k.startsWith('session:'))
  const entries = await Promise.all(keys.map(async key => ({ key, value: await $.store.get(key) })))
  const stored = entries.map(entry => {
    const value = entry.value
    const savedAt = value && typeof value === 'object' && typeof (value as { savedAt?: unknown }).savedAt === 'number'
      ? (value as { savedAt: number }).savedAt
      : 0
    return { key: entry.key, savedAt }
  })
  for (const old of sessionsToDelete(stored, `session:${s.sessionId}`, KEEP_SESSIONS)) await $.store.delete(old)
}

async function openPane($: EngineInterface, focus: boolean): Promise<boolean> {
  const opened = await $.ui.open({ id: PANE, title: 'Atlas', columns: 46, ...(focus ? { focus: true } : {}) })
  return opened.isPlaced
}

// ------------------------------------------------------------------ actions (the only intent writers)

async function act($: EngineInterface, a: Action, surface: Surface): Promise<void> {
  const { maxScroll, maxPopupScroll, maxExpandedScroll, maxLegendScroll } = surfaceBounds.get(surface) ?? EMPTY_BOUNDS
  switch (a.type) {
    case 'tab':
      return setView($, v => ({ ...v, tab: a.tab, scroll: 0, legend: false, popup: null, popupScroll: 0, expanded: null, expandedScroll: 0 }))
    case 'legend':
      return setView($, v => ({ ...v, legend: !v.legend, legendScroll: 0, popup: null, popupScroll: 0 }))
    case 'open-setup':
      return setView($, v => ({ ...v, setup: true, legend: false, popup: null, popupScroll: 0, scroll: 0 }))
    case 'set-observer':
      await chooseObserver($, a.mode)
      return
    case 'toggle-observer': {
      const current = await modeOf($)
      await chooseObserver($, current === 'claude' ? 'engine' : 'claude')
      return
    }
    case 'popup':
      return setView($, v => ({
        ...v,
        legend: false,
        expanded: null,
        expandedScroll: 0,
        popup: v.popup?.kind === a.popup.kind && v.popup.id === a.popup.id ? null : a.popup,
        popupScroll: 0,
        settingsPage: a.popup.kind === 'trail-view' ? 0 : v.settingsPage,
      }))
    case 'trail-settings-page':
      return setView($, v => ({ ...v, settingsPage: Math.max(0, Math.min(2, a.page)), popupScroll: 0 }))
    case 'trail-filter': {
      const current = (await $.state.get(VIEW)).value as AtlasViewState | undefined
      const hidden = (current?.hidden ?? []).includes(a.filter)
        ? (current?.hidden ?? []).filter(type => type !== a.filter)
        : [...(current?.hidden ?? []), a.filter]
      await $.store.set(TRAIL_VIEW_STORE, { view: current?.trailView ?? 'story', hidden, at: await $.clock.now() })
      return setView($, v => ({ ...v, hidden }))
    }
    case 'popup-scroll':
      return setView($, v => ({ ...v, popupScroll: Math.max(0, Math.min(maxPopupScroll, v.popupScroll + a.by)) }))
    case 'expanded-scroll':
      return setView($, v => ({ ...v, expandedScroll: Math.max(0, Math.min(maxExpandedScroll, v.expandedScroll + a.by)) }))
    case 'scroll':
      if (await isLegendOpen($)) return setView($, v => ({ ...v, legendScroll: Math.max(0, Math.min(maxLegendScroll, v.legendScroll + a.by)) }))
      return setView($, v => ({ ...v, scroll: Math.max(0, Math.min(maxScroll, v.scroll + a.by)), popup: null, popupScroll: 0 }))
    case 'scroll-to':
      return setView($, v => ({ ...v, scroll: Math.max(0, Math.min(maxScroll, a.at)), popup: null, popupScroll: 0 }))
    case 'trail-sort':
      return setView($, v => ({ ...v, trailNewest: !v.trailNewest, popupScroll: 0, expanded: null, expandedScroll: 0 }))
    case 'trail-view-set':
    case 'trail-view': {
      const at = await $.clock.now()
      const current = await $.store.get(TRAIL_VIEW_STORE)
      const hidden = current && typeof current === 'object' && Array.isArray((current as Raw).hidden)
        ? (current as { hidden: string[] }).hidden
        : []
      await $.store.set(TRAIL_VIEW_STORE, { view: a.view, hidden, at })
      return setView($, v => ({
        ...v,
        trailView: a.view,
        ...(a.type === 'trail-view' ? { popup: null } : {}),
        popupScroll: 0,
        expanded: null,
        expandedScroll: 0,
      }))
    }
    case 'expand':
      return setView($, v => ({ ...v, expanded: v.expanded === a.id ? null : a.id, expandedScroll: 0, popup: null, popupScroll: 0 }))
    case 'exclude':
      await edit($, (s, now) => setItemStatus(s, a.id, 'excluded', now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
      return
    case 'scan': {
      const rows = await history($)
      if ((await snap($))?.scanned === 'none' && rows.length) await edit($, (s, now) => ({ ...replay(s, rows, now), scanned: 'engine' }))
      await mapWithClaude($)
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
      return
    }
    case 'adopt':
      await edit($, (s, now) => adoptRecall(s, a.id, now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0, fullConfirm: null }))
      $.ui.toast('Resumed: the earlier goal, next step and decisions are back')
      return
    case 'adopt-full': {
      const current = await snap($)
      const recall = current?.recall.find(candidate => candidate.id === a.id)
      if (!current || !recall || recall.source !== 'atlas') return
      const view = (await $.state.get(VIEW)).value as AtlasView | undefined
      if (hasReplaceableContent(current) && view?.fullConfirm !== a.id) {
        await setView($, v => ({ ...v, fullConfirm: a.id, popup: null, popupScroll: 0 }))
        return
      }
      const loaded = await readFullRecall($, recall)
      const source = loaded.source
      if (!source) {
        $.ui.toast(`Can't load that save: ${loaded.error ?? 'invalid Atlas save'}`)
        return
      }
      await edit($, (s, now) => recoverFull(s, source, now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0, fullConfirm: null }))
      $.ui.toast('Loaded the full saved map; the earlier session is now this map')
      return
    }
    case 'attach': {
      // A chip in the draft is the only way Atlas text reaches Claude from the pane.
      let n = 1
      await setView($, v => {
        n = v.nextRef
        return { ...v, refs: { ...v.refs, [String(n)]: a.ref }, nextRef: n + 1, popup: null, popupScroll: 0 }
      })
      const chip = ` [Atlas #${n}: ${a.ref.kind.toLowerCase()} "${clip(a.ref.text, 28)}"] `
      const filled = await $.prompt.fill({ text: chip, mode: 'insert' })
      $.ui.toast(filled.isFilled ? `Added to your message as Atlas #${n}; delete the chip to not send it` : 'Atlas: could not add to the message (a dialog is open?)')
      return
    }
    case 'edit-goal':
      return setView($, v => ({ ...v, editingGoal: !v.editingGoal, popup: null, popupScroll: 0 }))
    case 'goal': {
      const s = await edit($, (cur, now) => setGoal(cur, a.text, 'person', now))
      await setView($, v => ({ ...v, editingGoal: false, popup: null, popupScroll: 0 }))
      if (s.detour) $.ui.toast('Return from the detour (or make it the goal) before changing the goal')
      return
    }
    case 'pin':
      await edit($, (s, now) => setNextStep(s, a.text, now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
      return
    case 'confirm': {
      const before = await snap($)
      const kind = before?.suggestions.find(x => x.id === a.id)?.kind
      await edit($, (s, now) => confirmSuggestion(s, a.id, now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
      if (kind === 'return') $.ui.toast('Return packet goes to Claude with your next message')
      if (kind === 'detour') $.ui.toast('Detour started; the atlas remembers where to come back to')
      return
    }
    case 'dismiss':
      await edit($, (s, now) => dismissSuggestion(s, a.id, now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
      return
    case 'settle':
      await edit($, (s, now) => setItemStatus(s, a.id, 'settled', now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
      return
    case 'drop':
      await edit($, (s, now) => setItemStatus(s, a.id, 'drop', now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
      return
    case 'restore':
      await edit($, (s, now) => setItemStatus(s, a.id, 'observed', now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
      return
    case 'resolve':
      await edit($, (s, now) => setItemStatus(s, a.id, 'resolved', now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
      return
    case 'reopen':
      await edit($, (s, now) => setItemStatus(s, a.id, 'open', now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
      return
    case 'return': {
      await edit($, (s, now) => returnFromDetour(s, now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
      $.ui.toast('Return packet goes to Claude with your next message')
      return
    }
    case 'promote':
      await edit($, (s, now) => promoteDetour(s, now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
      return
    case 'mark':
      await edit($, (s, now) => mark(s, '', now))
      await setView($, v => ({ ...v, popup: null, popupScroll: 0 }))
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
  '  /atlas observer [claude|engine] show or change the observer mode',
  '  /atlas hide <b|h>               hide report-backs (b) or hand-offs (h)',
  '  /atlas show <b|h>               show a hidden type',
  '  /atlas filters                  list hidden types',
  '  Trail: use ≡ for Trail settings: view, order and hidden types',
  '  /atlas setup                    show the first-run setup screen again',
  '  /atlas scan                     map the conversation so far with Claude (one cached request)',
  '  /atlas recover [n]              list earlier sessions (Atlas + Trailhead), or resume number n',
  '  /atlas recover <n> full [confirm] replace this map with an Atlas save',
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
    case 'filters': {
      const state = (await $.state.get(VIEW)).value as AtlasViewState | undefined
      const hidden = state?.hidden ?? []
      return hidden.length ? `Hidden types: ${hidden.map(type => `${type} (${type === 'b' ? 'report-backs' : 'hand-offs'})`).join(', ')}` : 'no filters'
    }
    case 'hide':
    case 'show': {
      const type = text.toLowerCase()
      if (type !== 'b' && type !== 'h') return 'Valid type letters: b (report-backs), h (hand-offs).'
      const state = (await $.state.get(VIEW)).value as AtlasViewState | undefined
      const current = state?.hidden ?? []
      const hidden = verb === 'hide'
        ? [...new Set([...current, type])]
        : current.filter(value => value !== type)
      await $.store.set(TRAIL_VIEW_STORE, { view: state?.trailView ?? 'story', hidden, at: await $.clock.now() })
      await setView($, value => ({ ...value, hidden }))
      const name = type === 'b' ? 'report-backs' : 'hand-offs'
      return verb === 'hide' ? `Hidden ${type} (${name}).` : `Shown ${type} (${name}).`
    }
    case 'observer': {
      const current = await modeOf($)
      if (!text) {
        const saved = await setupChoice($)
        return `Observer: ${current === 'claude' ? 'Claude' : 'Engine only'}${saved ? '' : ` (setup not chosen; /atlas setup, default: ${configuredMode === 'claude' ? 'Claude' : 'Engine only'})`}`
      }
      const requested = text.toLowerCase()
      const mode = requested === 'claude' ? 'claude' : requested === 'engine' || requested === 'engine only' ? 'engine' : null
      if (!mode) return 'Usage: /atlas observer [claude|engine]'
      await chooseObserver($, mode)
      return `Observer set to ${mode === 'claude' ? 'Claude' : 'Engine only'}.`
    }
    case 'setup':
      await setView($, v => ({ ...v, setup: true, legend: false, popup: null, popupScroll: 0, scroll: 0 }))
      await openPane($, true)
      return 'Atlas setup opened.'
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
      const [numberText = '', mode = '', confirmation = ''] = rest
      const n = Number(numberText)
      if (text && Number.isInteger(n) && n >= 1 && n <= list.length) {
        const pick = list[n - 1]
        if (!pick) return 'No such session.'
        if (mode.toLowerCase() === 'full') {
          if (pick.source !== 'atlas') return 'Full recovery is available only for Atlas save files.'
          const current = await snap($)
          if (current && hasReplaceableContent(current) && confirmation.toLowerCase() !== 'confirm') {
            return 'this replaces your current map; run /atlas recover <n> full confirm to proceed'
          }
          const loaded = await readFullRecall($, pick)
          const source = loaded.source
          if (!source) return `Can't load that save: ${loaded.error ?? 'invalid Atlas save'}`
          await edit($, (cur, now) => recoverFull(cur, source, now))
          return `Loaded full map from session ${pick.sessionId.slice(0, 8)}`
        }
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
let lastProblem: string | null = null
let saving: Timer | null = null
let scanResultTimer: Timer | null = null

const EMPTY_SCAN: AtlasScanState = { active: false, startedAt: 0, result: null, resultAt: 0 }

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
    await step('command /atlas', () => $.command.register({
      name: 'atlas',
      description: 'ConversationAtlas: open the pane or set goal, next, mark, decision, detour, hide, show, filters, scan, recover, help',
      argumentHint: '[goal|next|mark|decision|detour|hide|show|filters|scan|recover|help] [text]',
    }))
    await step('session binding', () => bind($))
    // The tool is inert until setup consent. Registration itself does not call Claude;
    // this lets tests and an already-equipped model receive the short "off" result.
    await step('observe tool', () => registerObserverTool($))
    saving?.cancel()
    saving = $.clock.every(SAVE_MS, () => {
      void checkHandoffReports($).catch(() => undefined)
      void save($).catch(() => undefined)
    })
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
  configuredMode = options?.observer === 'engine only' ? 'engine' : 'claude'
  observerToolRegistered = false
  scanOnLaunch = options?.scanOnLaunch === 'off' || options?.scanOnLaunch === 'claude' ? options.scanOnLaunch : 'engine'
  ready = null

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await setup($)
    return result
  })

  on('session.end', async ($, e, next) => {
    scanResultTimer?.cancel()
    scanResultTimer = null
    await save($).catch(() => undefined)
    if (e.reason === 'clear') sid = ''
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if ((await modeOf($)) !== 'claude') return result
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
      const [ctx, rest] = takeContext(upgrade(cur))
      taken = ctx
      return rest
    })
    extra.push(...taken)
    const view = (await $.state.get(VIEW)).value
    // Only chips still in the text count: a deleted chip sends nothing.
    const refs = view?.refs ?? {}
    const seen = new Set<string>()
    for (const m of e.text.matchAll(/\[Atlas #(\d+)[^\]]*\]/g)) {
      const n = m[1] ?? ''
      const ref = refs[n]
      if (!ref || seen.has(n)) continue
      seen.add(n)
      extra.push(`Atlas reference #${n} (${ref.kind}), attached deliberately by the user: ${ref.text}`)
    }
    const s = await snap($)
    const line = (await modeOf($)) === 'claude' && s ? intentLine(s) : null
    if (line) extra.push(line)
    return next(extra.length ? { ...e, context: [...(e.context ?? []), ...extra] } : e)
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    observedThisTurn = false
    await ensureBound($)
    await checkHandoffReports($)
    const rawText = String(e.text ?? '')
    const marker = reportMarker(rawText)
    await edit($, (s, now) => {
      let nextState = startTurn(s, rawText, now)
      if (marker) {
        return reportHandoff(nextState, marker.summary, now, marker.taskId ? marker.agent ?? undefined : undefined, marker.taskId ?? undefined)
      }
      // Only a genuinely typed remainder closes an unreported hand-off. A
      // marker-only engine turn therefore neither creates a prompt nor closes
      // the running delegation.
      if (nextState.events.at(-1)?.kind === 'prompt') nextState = closeUnverifiedHandoffs(nextState, now)
      return nextState
    })
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
    if ((await modeOf($)) !== 'claude') return { result: 'Conversation Atlas observer is off; use /atlas observer claude to turn it on.' }
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
    const delegation = handoffStart(tool, input)
    await ensureBound($)
    const aid = `a${++activitySeq}`
    const agent = e.agentId ? (agentNames.get(e.agentId) ?? 'agent') : null
    const asked = tool === 'AskUserQuestion' ? askedQuestions(input) : []
    let handoffId: string | undefined
    const reportPath = delegation ? expectedReportPath(root, delegation.brief) : null
    const existingReportFingerprint = reportPath
      ? await (async () => {
          try {
            return reportFingerprint(await $.fs.read(reportPath))
          } catch {
            return null
          }
        })()
      : null
    await edit($, (s, now) => {
      let out = startActivity(s, { id: aid, kind: c.kind, label: c.label, at: now, agent })
      if (delegation) {
        out = startHandoff(out, delegation.label, delegation.agent, delegation.brief, reportPath, now, existingReportFingerprint)
        handoffId = out.handoffs.at(-1)?.id
      }
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
    const taskId = taskIdOf(ran) ?? taskIdOf(result)
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
    if (delegation && !delegation.external) {
      const summaryText = `${delegation.agent} ${failed ? 'failed' : 'completed'}`
      await edit($, (s, now) => reportHandoff(s, summaryText, now, delegation.agent, handoffId))
    }
    if (delegation && handoffId && taskId) await edit($, s => setHandoffTaskId(s, handoffId as string, taskId))
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
    const topic = s ? oneLine(s).replace(/^[^\p{L}\p{N}]+/u, '') : ''
    const label = s && topic && topic !== 'Atlas' ? clip(`Atlas: ${topic}${waiting ? ` · ${waiting} to review` : ''}`, 40) : waiting ? clip(`Atlas · ${waiting} to review`, 40) : 'Atlas'
    const press = async () => {
      await openPane($, true)
      if (waiting > 0) await setView($, v => ({ ...v, tab: 'open', scroll: 0 }))
    }
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Button key="atlas-open" dimColor={waiting === 0} label={label} onPress={() => void press().catch(() => undefined)} />
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
    const choice = await setupChoice($)
    const renderView = { ...view, setup: view.setup || !choice }
    const mode = await modeOf($)
    const now = await $.clock.now()
    const scan = await scanState($)
    const width = Math.max(20, (e.props.bodyColumns || 48) - 2)
    const Client = 'Client' in t ? t.Client : undefined
    const live = (key: string, rows: LiveRow[], scanProps?: { active: boolean; startedAt: number; result: string | null; resultAt: number; now: number }) =>
      Client ? (
        <Client key={`live-${key}`} module="./live.tsx" props={scanProps ? { rows: plain(rows), tones: TONES, scan: scanProps } : { rows: plain(rows), tones: TONES }} />
      ) : (
        <Box key={`live-${key}`} flexDirection="column">
          {rows.map((r, i) => (
            <Text key={`static-${i}`} wrap="truncate-end">{r.segs.map(seg => (seg.spin ? '… ' : seg.t)).join('')}</Text>
          ))}
        </Box>
      )
    const el = { Box: t.Box, Text: t.Text, Button: t.Button, Input: 'Input' in t ? t.Input : undefined, Select: 'Select' in t ? t.Select : undefined, Svg: 'Svg' in t ? t.Svg : undefined, Link: 'Link' in t ? t.Link : undefined, Code: 'Code' in t ? t.Code : undefined, Markdown: 'Markdown' in t ? t.Markdown : undefined }
    const rows = Math.max(8, e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30)
    const surface = (e.surface ?? 'terminal') as Surface
    const drawn = pane({
      el, surface, width, rows, now, mode, setupDefault: configuredMode, scan, view: renderView, live,
      act: a => void act($, a, surface).catch(err => $.ui.toast(`atlas: ${err instanceof Error ? err.message : String(err)}`)),
    }, s)
    surfaceBounds.set(surface, {
      bodyRows: rows,
      maxScroll: drawn.maxScroll,
      maxPopupScroll: drawn.maxPopupScroll,
      maxExpandedScroll: drawn.maxExpandedScroll,
      maxLegendScroll: drawn.maxLegendScroll,
    })
    return drawn.tree
  })

  // The pane scrolls its own body (the app bar stays pinned), unless a popup or
  // expanded help or a Trail event is using the same wheel gesture.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { maxScroll, maxPopupScroll, maxExpandedScroll, maxLegendScroll } = wheelBounds(e.bodyRows)
    const view = (await $.state.get(VIEW)).value as AtlasView | undefined
    if (view?.popup) {
      if (view.popup.kind === 'trail-view') {
        await setView($, v => ({ ...v, settingsPage: Math.max(0, Math.min(2, v.settingsPage + Math.sign(e.by))) }))
        return {}
      }
      await setView($, v => ({ ...v, popupScroll: Math.max(0, Math.min(maxPopupScroll, v.popupScroll + e.by)) }))
      return {}
    }
    if (view?.legend) {
      await setView($, v => ({ ...v, legendScroll: Math.max(0, Math.min(maxLegendScroll, v.legendScroll + e.by)) }))
      return {}
    }
    if (view?.expanded && maxExpandedScroll > 0) {
      await setView($, v => ({ ...v, expandedScroll: Math.max(0, Math.min(maxExpandedScroll, v.expandedScroll + e.by)) }))
      return {}
    }
    await setView($, v => ({ ...v, scroll: Math.max(0, Math.min(maxScroll, v.scroll + e.by)) }))
    return {}
  })
}
