import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import {
  addCheckpoint,
  adoptRecall,
  closeUnverifiedHandoffs,
  collapseEvents,
  confirmSuggestion,
  emptySnapshot,
  goalSuggestions,
  hasReplaceableContent,
  observe,
  promptBullets,
  recoverFull,
  reportHandoff,
  reportMarker,
  resolveRepoPath,
  returnFromDetour,
  setGoal,
  setItemStatus,
  setNextStep,
  startDetour,
  startHandoff,
  startTurn,
  stripPromptMarkers,
  touchFile,
  upgrade,
} from '../hooks/model'
import { expectedReportPath, handoffStart, parseHandoffReport, reportChanged, reportFingerprint } from '../hooks/delegation'
import { atlasFullFileError, fromAtlasFullFile, pickRecallEntries, saveFile, sessionsToDelete } from '../hooks/recall'
import { replay } from '../hooks/scan'
import { cellWidth, layoutRow, measuredBarItemWidth, truncateMiddleCells } from '../hooks/ui/shared'
import { tuiCollapseBarLabels } from '../hooks/render-tui'
import { C, GLYPH, LEGEND, legendPanel, pane, popupShell, rendererFor, rowsOf, type Ctx } from '../hooks/view'

test('surface dispatcher selects the GUI only for desktop', () => {
  expect(rendererFor('desktop')).toBe('gui')
  for (const surface of ['terminal', 'vscode', 'mobile'] as const) expect(rendererFor(surface)).toBe('tui')
})
import { buildEvidence } from '../hooks/screens/evidence'
import { buildMap } from '../hooks/screens/map'
import { itemRow } from '../hooks/screens/shared'
import { buildOpen } from '../hooks/screens/open'
import { buildTrail, eventText, trailViewPopup } from '../hooks/screens/trail'
import type { On } from 'claude-code'
import type { AtlasEvent, AtlasSnapshot, AtlasView } from '../types'
import { SAMPLE_NOW, sampleSnapshot } from './fixtures/sample'
import type { GlyphKey, ScreenPopup } from '../hooks/screens/types'

const ROOT = 'F:/work/atlas'
const OBSERVE = 'mcp__conversation-atlas__observe'
const PANE_PROPS = { title: 'Atlas', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as any

function world(on: any, entries: Record<string, unknown> = { setup: { observer: 'claude', at: 1_800_000_000_000 } }) {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on, entries)
  const seen = { tools: [] as string[], commands: [] as string[], opens: [] as unknown[], toasts: [] as string[] }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'atlas-test-session' }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', (_$: any, e: any) => {
    seen.commands.push(e.name)
    return { value: undefined }
  })
  on('tool.register', (_$: any, e: any) => {
    seen.tools.push(e.name)
    return { value: { tool: `mcp__conversation-atlas__${e.name}` } }
  })
  on('ui.open', (_$: any, e: any) => {
    seen.opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_$: any, e: any) => {
    seen.toasts.push(String(e.text ?? ''))
    return { value: undefined }
  })
  on('tool.call', (_$: any, e: any) => ({ result: e.tool === 'Bash' ? { stdout: '', stderr: '', interrupted: false } : { ok: true } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  return { clock, seen }
}

async function drawn(ui: any): Promise<string> {
  return JSON.stringify(await ui.drawn())
}

function childrenOf(node: any): any[] {
  return Array.isArray(node?.children) ? node.children.filter(Boolean) : []
}

type DrawnNode = { type?: string; props?: Record<string, unknown>; children?: unknown }

function nodeByKey(value: unknown, key: string): DrawnNode | undefined {
  if (!value || typeof value !== 'object') return undefined
  const node = value as DrawnNode
  if (node.props?.key === key) return node
  const propsChildren = Array.isArray(node.props?.children) ? node.props.children : []
  const children = Array.isArray(node.children) ? node.children : propsChildren
  for (const child of children) {
    const found = nodeByKey(child, key)
    if (found) return found
  }
  return undefined
}

describe('open cleanup guards', () => {
  test('suggestions reject empty, punctuation, ellipsis and single alphanumeric text', () => {
    for (const text of ['', ' ', '…', '...', '!?—', 'a…', '1...']) {
      const s = observe(emptySnapshot('guard', ROOT, 0), { goal: text, next: text }, 1)
      expect(s.suggestions).toHaveLength(0)
    }
    const s = observe(emptySnapshot('guard', ROOT, 0), { goal: 'ab', next: 'é2' }, 1)
    expect(s.suggestions.map(item => item.text).sort()).toEqual(['ab', 'é2'])
  })

  test('first request needs a real first sentence without a whole-body fallback', () => {
    for (const text of ['', '…', '...', 'ok', 'thanks', 'yes do it', 'okay thank you please',
      'Hi. Build the atlas pane for long sessions.', 'Review release documentation.', 'a b c d']) {
      expect(startTurn(emptySnapshot('guard', ROOT, 0), text, 1).suggestions).toHaveLength(0)
    }
    const s = startTurn(emptySnapshot('guard', ROOT, 0), 'Build the atlas pane for long sessions. Then run tests.', 1)
    expect(s.suggestions.map(item => [item.text, item.why])).toEqual([
      ['Build the atlas pane for long sessions.', 'From your first request'],
    ])
    expect(s.goal).toBeNull()
  })

  test('questions resolve through observation and retain Reopen; decisions use Confirm', () => {
    let s = observe(emptySnapshot('guard', ROOT, 0), { questions: ['Does this work?'], decisions: ['Keep this behavior'] }, 1)
    const question = s.questions[0]!
    const view = { ...scrollTestView(), mode: 'claude' as const }
    expect(itemRow(s, question, 2, view, true).actions?.map(item => [item.label, item.action.type]))
      .toEqual([['Confirm', 'resolve'], ['Drop', 'drop']])
    expect(itemRow(s, s.decisions[0]!, 2, view, true).actions?.map(item => [item.label, item.action.type]))
      .toEqual([['Confirm', 'settle'], ['Drop', 'drop']])
    s = observe(s, { resolved: [question.text] }, 3)
    expect(s.questions[0]?.status).toBe('resolved')
    expect(itemRow(s, s.questions[0]!, 4, view, true).actions?.map(item => [item.label, item.action.type]))
      .toEqual([['Reopen', 'reopen']])
  })
})

describe('model: observation never writes intent', () => {
  test('Claude can propose a goal and a detour but not set them', async () => {
    let s = emptySnapshot('s', ROOT, 0)
    s = observe(s, { topic: 'Plugin architecture', goal: 'Build Conversation Atlas' }, 1)
    s = observe(s, { topic: 'Investigating UI capabilities', shift: 'possible-detour', why: 'Side research' }, 2)
    expect(s.goal).toBeNull()
    expect(s.detectedGoal?.text).toBe('Build Conversation Atlas')
    expect(s.detour).toBeNull()
    expect(s.suggestions.map(x => x.kind).sort()).toEqual(['detour', 'goal'])
    expect(s.topics.find(t => t.title === 'Investigating UI capabilities')?.kind).toBe('possible-detour')
  })

  test('confirming a detour keeps its departure snapshot and return emits one packet', async () => {
    let s = emptySnapshot('s', ROOT, 0)
    s = startTurn(s, 'Build the atlas pane for long sessions.', 1)
    const goal = s.suggestions.find(x => x.kind === 'goal')
    expect(goal).toBeDefined()
    s = confirmSuggestion(s, goal?.id ?? '', 2)
    expect(s.goal?.text).toBe('Build the atlas pane for long sessions.')
    s = observe(s, { topic: 'Pane layout' }, 3)
    s = observe(s, { topic: 'Test infrastructure', shift: 'possible-detour' }, 4)
    const detour = s.suggestions.find(x => x.kind === 'detour')
    s = confirmSuggestion(s, detour?.id ?? '', 5)
    expect(s.detour?.reason).toBe('Test infrastructure')
    expect(s.detour?.departure.goal).toBe('Build the atlas pane for long sessions.')
    expect(s.detour?.departure.topic).toBe('Pane layout')
    expect(s.checkpoints.at(-1)?.kind).toBe('marked')
    s = observe(s, { shift: 'return', topic: 'Pane layout', why: 'Back to layout' }, 6)
    expect(s.detour).not.toBeNull()
    expect(s.suggestions.some(x => x.kind === 'return')).toBe(true)
    s = returnFromDetour(s, 7)
    expect(s.detour).toBeNull()
    expect(s.pendingContext).toHaveLength(1)
    expect(s.pendingContext[0]).toContain('Original goal: Build the atlas pane for long sessions.')
    expect(s.pendingContext[0]).toContain('Intended next step: not recorded')
    expect(returnFromDetour(s, 8)).toBe(s)
  })

  test('your own wording raises suggestions, not changes', async () => {
    let s = emptySnapshot('s', ROOT, 0)
    s = startTurn(s, 'Build the release checklist.', 1)
    s = confirmSuggestion(s, s.suggestions[0]?.id ?? '', 2)
    s = startTurn(s, 'btw, quick tangent: why is CI slow?', 3)
    expect(s.detour).toBeNull()
    expect(s.suggestions.some(x => x.kind === 'detour')).toBe(true)
    s = startTurn(s, "Let's go with the native pane.", 4)
    expect(s.decisions.at(-1)?.status).toBe('observed')
  })

  test('goal alternatives require distance, use observed evidence, and cap at three', () => {
    let s = setGoal(emptySnapshot('s', ROOT, 0), 'Ship the API', 'person', 1)
    s = observe(s, { topic: 'Write onboarding docs' }, 2)
    s = observe(s, { topic: 'Audit terminal spacing' }, 3)
    s = observe(s, { goal: 'Polish the desktop surface' }, 4)
    s = addCheckpoint(s, 'Desktop milestone', 'claude', null, 5)
    s = observe(s, { topic: 'Ship API validation' }, 6)
    expect(s.goal?.text).toBe('Ship the API')
    expect(goalSuggestions(s)).toEqual([])

    let far = setGoal(emptySnapshot('s', ROOT, 0), 'Ship the API', 'person', 1)
    far = observe(far, { topic: 'Write onboarding docs' }, 2)
    far = observe(far, { topic: 'Audit terminal spacing' }, 3)
    far = observe(far, { goal: 'Polish the desktop surface' }, 4)
    far = addCheckpoint(far, 'Desktop milestone', 'claude', null, 5)
    expect(goalSuggestions(far)).toEqual(['Polish the desktop surface', 'Audit terminal spacing', 'Write onboarding docs'])
  })

  test('observing a far topic does not change the goal until Update goal is pressed', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.command.run({ command: 'atlas', args: 'goal Ship the API', origin: { kind: 'composer' } } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Write onboarding docs' } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Audit terminal spacing' } as any)
    await $.tool.call({ tool: OBSERVE, goal: 'Polish the desktop surface' } as any)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    expect(await drawn(ui)).toContain('Ship the API')
    expect(await drawn(ui)).toContain('· 3 suggestions')
    await ui.press({ key: 'goal-row' })
    expect(await ui.find({ key: 'update-goal-0', type: 'Button' })).toBeDefined()
    expect(await drawn(ui)).toContain('Polish the desktop surface')
    await ui.press({ key: 'update-goal-0' })
    expect(await drawn(ui)).toContain('Polish the desktop surface')
    await ui.unmount()
  })

  test('full recovery copies the saved map, preserves current identity and advances ids', () => {
    let source = setGoal(emptySnapshot('source-session', ROOT, 0), 'Recovered full goal', 'person', 1)
    source = observe(
      source,
      {
        topic: 'Recovered full topic',
        decisions: ['Recovered decision'],
        questions: ['Recovered question'],
        checkpoint: 'Recovered milestone',
      },
      2,
    )
    source = touchFile(source, `${ROOT}/hooks/model.ts`, 'write', 3)
    source = {
      ...source,
      seq: 99,
      activity: [{ id: 'a98', kind: 'edit', label: 'Saved edit', state: 'done', at: 3, endedAt: 3, agent: null }],
    }
    const currentRecall = [{
      id: 'atlas:other-session',
      source: 'atlas' as const,
      sessionId: 'other-session',
      at: 9,
      goal: 'Other goal',
      nextStep: null,
      detour: null,
      topic: null,
      decisions: [],
    }]
    const current = {
      ...emptySnapshot('current-session', ROOT, 10),
      fresh: ['current-fresh'],
      recall: currentRecall,
      adopted: ['atlas:discarded-session'],
      pendingContext: ['stale return packet'],
    }
    const savedText = saveFile(source, 20)
    const full = fromAtlasFullFile(savedText, ROOT)
    expect(full?.sessionId).toBe('source-session')
    expect((full?.snapshot as { activity?: unknown[] }).activity).toHaveLength(1)

    const restored = recoverFull(current, full ?? { id: '', sessionId: '', snapshot: {} }, 30)
    expect(restored.sessionId).toBe('current-session')
    expect(restored.root).toBe(ROOT)
    expect(restored.fresh).toEqual([])
    expect(restored.recall).toEqual(currentRecall)
    expect(restored.pendingContext).toEqual([])
    expect(restored.topics).toHaveLength(source.topics.length)
    expect(restored.decisions).toHaveLength(source.decisions.length)
    expect(restored.questions).toHaveLength(source.questions.length)
    expect(restored.checkpoints).toHaveLength(source.checkpoints.length)
    expect(restored.events).toHaveLength(source.events.length + 1)
    expect(restored.activity).toHaveLength(source.activity.length)
    expect(restored.goal?.text).toBe('Recovered full goal')
    expect(restored.adopted).toEqual(['atlas:source-session'])
    expect(restored.events.at(-1)?.text).toBe('Loaded full map from session source-s')
    expect(restored.seq).toBe(100)
    const withNewId = addCheckpoint(restored, 'After recovery', 'marked', null, 31)
    expect(withNewId.checkpoints.at(-1)?.id).toBe('c101')
  })

  test('full recovery clears freshness even when a restored id collides with it', () => {
    const source = addCheckpoint(emptySnapshot('source-session', ROOT, 0), 'Restored milestone', 'marked', null, 1)
    const current = { ...emptySnapshot('current-session', ROOT, 0), fresh: ['c1'] }
    const restored = recoverFull(current, { id: 'atlas:source-session', sessionId: 'source-session', snapshot: source }, 2)

    expect(restored.checkpoints[0]?.id).toBe('c1')
    expect(restored.fresh).toEqual([])
  })

  test('full recovery replaces adopted lineage and deduplicates a source already in it', () => {
    const loaded = { ...emptySnapshot('loaded-session', ROOT, 0), adopted: ['atlas:loaded-session'] }
    const current = { ...emptySnapshot('current-session', ROOT, 0), adopted: ['atlas:discarded-session'] }
    const source = { id: 'atlas:source-session', sessionId: 'loaded-session', snapshot: loaded }

    expect(recoverFull(current, source, 1).adopted).toEqual(['atlas:loaded-session', 'atlas:source-session'])
    expect(recoverFull(current, { ...source, id: 'atlas:loaded-session' }, 1).adopted).toEqual(['atlas:loaded-session'])
  })

  test('plain Resume appends an earlier session once and never reads its loaded lineage', () => {
    const current = {
      ...emptySnapshot('current-session', ROOT, 0),
      adopted: ['atlas:current-session'],
      recall: [{
        id: 'atlas:resume-session',
        source: 'atlas' as const,
        sessionId: 'resume-session',
        at: 1,
        goal: null,
        nextStep: null,
        detour: null,
        topic: null,
        decisions: [],
      }],
    }
    const resumed = adoptRecall(current, 'atlas:resume-session', 2)

    expect(resumed.adopted).toEqual(['atlas:current-session', 'atlas:resume-session'])
    expect(adoptRecall(resumed, 'atlas:resume-session', 3)).toBe(resumed)
  })

  test('only explicit Resume and full Resume change adopted lineage', () => {
    const current = {
      ...emptySnapshot('current-session', ROOT, 0),
      adopted: ['atlas:current-session'],
      recall: [{
        id: 'atlas:resume-session',
        source: 'atlas' as const,
        sessionId: 'resume-session',
        at: 1,
        goal: null,
        nextStep: null,
        detour: null,
        topic: null,
        decisions: [],
      }],
    }
    const observed = observe(current, { topic: 'Observed topic' }, 1)
    const replayed = replay(current, [{ role: 'user', text: 'Replay this prompt.' }], 2)
    const resumed = adoptRecall(current, 'atlas:resume-session', 3)
    const full = recoverFull(
      current,
      { id: 'atlas:full-session', sessionId: 'full-session', snapshot: { ...emptySnapshot('full-session', ROOT, 0), adopted: ['atlas:loaded-session'] } },
      4,
    )

    expect(observed.adopted).toEqual(['atlas:current-session'])
    expect(replayed.adopted).toEqual(['atlas:current-session'])
    expect(resumed.adopted).toEqual(['atlas:current-session', 'atlas:resume-session'])
    expect(full.adopted).toEqual(['atlas:loaded-session', 'atlas:full-session'])
  })

  test('save and full-recover round trip keeps loaded lineage and adds the source id', () => {
    const loaded = { ...emptySnapshot('loaded-session', ROOT, 0), adopted: ['atlas:earlier-session'] }
    const source = fromAtlasFullFile(saveFile(loaded, 1), ROOT)
    expect(source).not.toBeNull()

    const recovered = recoverFull(
      { ...emptySnapshot('current-session', ROOT, 0), adopted: ['atlas:discarded-session'] },
      source ?? { id: '', sessionId: '', snapshot: {} },
      2,
    )
    expect(recovered.adopted).toEqual(['atlas:earlier-session', 'atlas:loaded-session'])
  })

  test('full recovery rejects unsupported and malformed snapshots without replacing current state', () => {
    const current = setGoal(emptySnapshot('current-session', ROOT, 10), 'Keep this map', 'person', 11)
    const valid = JSON.parse(saveFile(emptySnapshot('saved-session', ROOT, 0), 20)) as { snapshot: Record<string, unknown> }
    const unsupported = { ...valid, snapshot: { ...valid.snapshot, v: 99, decisions: [] } }
    const unsupportedText = JSON.stringify(unsupported)
    expect(atlasFullFileError(unsupportedText, ROOT)).toBe('unsupported version 99')
    expect(fromAtlasFullFile(unsupportedText, ROOT)).toBeNull()
    expect(recoverFull(current, { id: 'atlas:saved-session', sessionId: 'saved-session', snapshot: unsupported.snapshot }, 30)).toBe(current)

    const malformed = { ...valid, snapshot: { ...valid.snapshot, topics: {}, decisions: [] } }
    const malformedText = JSON.stringify(malformed)
    expect(atlasFullFileError(malformedText, ROOT)).toContain('topics')
    expect(fromAtlasFullFile(malformedText, ROOT)).toBeNull()
  })

  test('full recovery accepts a legacy v1 snapshot that upgrade can fill', () => {
    const full = emptySnapshot('legacy-session', ROOT, 0)
    const { detectedGoal: _goal, recall: _recall, adopted: _adopted, scanned: _scanned, ...legacy } = full
    const text = JSON.stringify({ format: 'conversation-atlas', v: 1, sessionId: full.sessionId, root: ROOT, snapshot: legacy })
    const source = fromAtlasFullFile(text, ROOT)
    expect(source).not.toBeNull()
    const restored = recoverFull(emptySnapshot('current-session', ROOT, 10), source as { id: string; sessionId: string; snapshot: unknown }, 30)
    expect(restored.detectedGoal).toBeNull()
    expect(restored.recall).toEqual([])
    expect(restored.adopted).toEqual(['atlas:legacy-session'])
    expect(restored.scanned).toBe('none')
  })

  test('full recovery replacement guard covers empty, observed, intent and evidence maps', () => {
    expect(hasReplaceableContent(emptySnapshot('empty', ROOT, 0))).toBe(false)

    const observed = observe(emptySnapshot('observed', ROOT, 0), { topic: 'Observed only' }, 1)
    expect(hasReplaceableContent(observed)).toBe(true)

    const nextStep = setNextStep(emptySnapshot('next', ROOT, 0), 'Next step only', 1)
    expect(hasReplaceableContent(nextStep)).toBe(true)

    const detour = startDetour(emptySnapshot('detour', ROOT, 0), 'Detour only', null, 1)
    expect(hasReplaceableContent(detour)).toBe(true)

    const evidence = touchFile(emptySnapshot('evidence', ROOT, 0), `${ROOT}/README.md`, 'read', 1)
    expect(hasReplaceableContent(evidence)).toBe(true)
  })

  test('session pruning keeps the current key and removes the least recently saved old keys', () => {
    const entries = [
      { key: 'session:current', savedAt: 0 },
      ...Array.from({ length: 13 }, (_, index) => ({ key: `session:old-${index + 1}`, savedAt: index + 1 })),
    ]
    expect(sessionsToDelete(entries, 'session:current', 12)).toEqual(['session:old-1', 'session:old-2'])
    expect(sessionsToDelete(entries, 'session:current', 12)).not.toContain('session:current')
  })

  test('recall entries select the newest 80 deterministically and sort unknown times by name', () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({ name: `save-${String(index).padStart(3, '0')}.json`, mtimeMs: index }))
    const shuffledA = [...entries.filter((_entry, index) => index % 2 === 0), ...entries.filter((_entry, index) => index % 2 === 1)]
    const shuffledB = [...entries].reverse()
    const expected = entries.slice(20).sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
    expect(pickRecallEntries(shuffledA, 80)).toEqual(expected)
    expect(pickRecallEntries(shuffledB, 80)).toEqual(expected)
    expect(pickRecallEntries([{ name: 'z.json' }, { name: 'a.json' }, { name: 'm.json' }], 3).map(entry => entry.name))
      .toEqual(['a.json', 'm.json', 'z.json'])
  })
})

describe('model: prompt bullets', () => {
  test('list items and later sentences become points; the first sentence is the title', () => {
    const text = 'Refactor the loader. It is slow today.\n- keep the API stable\n* add retries with backoff\n1) write tests\n```\ncode here\n```\n- ok\nThen ship it.'
    expect(promptBullets(text)).toEqual(['It is slow today.', 'keep the API stable', 'add retries with backoff', 'write tests', 'Then ship it.'])
    expect(promptBullets('Just one sentence here.')).toEqual([])
    const many = `Title line.\n${Array.from({ length: 9 }, (_, i) => `- point number ${i}`).join('\n')}`
    const out = promptBullets(many)
    expect(out).toHaveLength(7)
    expect(out.at(-1)).toBe('+3 more')
    const s = startTurn(emptySnapshot('s', ROOT, 0), 'Refactor the loader. Keep going.\n- one more point', 1)
    const ev = s.events.find(e => e.kind === 'prompt')
    expect(ev?.text).toBe('Refactor the loader. Keep going.\n- one more point')
    expect(ev?.detail).toEqual(['Keep going.', 'one more point'])
  })
})

describe('hooks', () => {
  test('first run is engine-only until setup, then Claude observation can be enabled and disabled', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on, {})
    const engine = $ as any
    on('prompt.compose', () => ({ sections: [] }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    const setup = await drawn(ui)
    expect(setup).toContain('Set up Atlas')
    expect(setup).toContain('Use Claude observer')
    expect(setup).toContain('Engine only (free)')

    const compose = { model: 'test', promptModel: 'test', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] }
    const before = await engine.prompt.compose(compose)
    expect(JSON.stringify(before)).not.toContain('conversation-atlas:rules')
    const off = await $.tool.call({ tool: OBSERVE, topic: 'Must not record' } as any)
    expect(JSON.stringify(off)).toContain('observer is off')
    expect(setup).not.toContain('Must not record')

    await ui.press({ key: 'setup-claude' })
    expect(await drawn(ui)).not.toContain('Set up Atlas')
    const enabled = await engine.prompt.compose(compose)
    expect(JSON.stringify(enabled)).toContain('conversation-atlas:rules')
    await $.tool.call({ tool: OBSERVE, topic: 'Claude observed topic' } as any)
    expect(await drawn(ui)).toContain('Claude observed topic')

    const switched = await $.command.run({ command: 'atlas', args: 'observer engine', origin: { kind: 'composer' } } as any)
    expect(switched.text).toContain('Engine only')
    const dimmed = await drawn(ui)
    expect(dimmed).toContain('CURRENT PATH')
    expect(dimmed).toContain('Needs the Claude observer')
    await ui.unmount()
  })

  test('observer rules batch reports with tool calls and stay short', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    on('prompt.compose', () => ({ sections: [] }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await clock.settle()

    const engine = $ as unknown as {
      prompt: { compose: (input: object) => Promise<{ sections: Array<{ id?: unknown; text?: unknown }> }> }
    }
    const compose = {
      model: 'test',
      promptModel: 'test',
      surfaces: ['terminal'],
      tools: [],
      outputStyle: null,
      traits: [],
    }
    const result = await engine.prompt.compose(compose)
    const rules = result.sections.find(section => section.id === 'conversation-atlas:rules')
    const text = String(rules?.text ?? '')
    expect(text).toContain('in parallel with another tool call')
    expect(text).toContain('never alone in a final round')
    expect(text).toContain('next tool-using turn')
    expect(text.length).toBeLessThan(1_140)
  })

  test('registers its tool and command, opens the pane, and maps engine events', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock, seen } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()
    expect(seen.tools).toContain('observe')
    expect(seen.commands).toContain('atlas')
    expect(seen.opens.length).toBeGreaterThan(0)
    expect(seen.opens.some((open: any) => Number(open.columns) >= 46)).toBe(true)

    await $.tool.call({ tool: 'Read', file_path: `${ROOT}/hooks/register.tsx` } as any)
    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/hooks/model.ts`, old_string: 'a', new_string: 'b' } as any)
    await $.tool.call({ tool: 'Bash', command: 'claude plugin test .', description: 'Run tests' } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Passive observatory', decisions: ['Keep the UI native'], questions: ['Should topics persist across sessions?'], next: 'Wire the pane' } as any)
    await clock.settle()

    for (const surface of ['terminal'] as const) {
      const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
      const text = await drawn(ui)
      for (const word of ['Passive observatory', 'model.ts', 'Tests passed', 'Wire the pane', 'Keep the UI native']) expect(text).toContain(word)
      expect(await ui.find({ key: 'tab-open' })).toBeDefined()
      await ui.press({ key: 'tab-evidence' })
      expect(await drawn(ui)).toContain('Tests passed')
      await ui.press({ key: 'tab-map' })
      await ui.unmount()
    }
  })

  test('goal stays unconfirmed until the person presses, and a return packet rides the next prompt once', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Plugin architecture', goal: 'Build Conversation Atlas' } as any)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    expect(await drawn(ui)).toContain('not confirmed yet')
    const ok = (await drawn(ui)).match(/"key":"(ok-s\d+)"/)?.[1]
    expect(ok).toBeDefined()
    await ui.press({ key: ok ?? '' })
    expect(await drawn(ui)).not.toContain('not confirmed yet')

    await $.tool.call({ tool: OBSERVE, topic: 'UI capabilities', shift: 'possible-detour', why: 'Research' } as any)
    const take = (await drawn(ui)).match(/"key":"(ok-s\d+)"/)?.[1]
    await ui.press({ key: take ?? '' })
    expect(await drawn(ui)).toContain('DETOUR')
    const detourRow = (await ui.findAll({ type: 'Button' })).find((button: any) => String(button.props.label ?? '').startsWith('From '))
    expect(detourRow).toBeDefined()
    await ui.press({ key: String(detourRow?.props.key ?? '') })
    await ui.press({ key: 'return' })

    const first = await $.prompt.submit({ text: 'continue', wait: false, origin: { kind: 'composer' } } as any)
    const second = await $.prompt.submit({ text: 'and then?', wait: false, origin: { kind: 'composer' } } as any)
    expect(JSON.stringify(first)).toContain('return packet')
    expect(JSON.stringify(second)).not.toContain('return packet')
    expect(JSON.stringify(second)).toContain('Build Conversation Atlas')
    await ui.unmount()
  })

  test(
    'active detours show their departure and branch rows, with actions in the expansion',
    { timeoutMs: 20_000 },
    async ($, on) => {
      const { clock } = world(on)
      await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
      await $.tool.call({ tool: OBSERVE, topic: 'Main path' } as any)
      await $.tool.call({ tool: OBSERVE, topic: 'Side investigation', shift: 'possible-detour', why: 'Check a separate question' } as any)
      await clock.settle()

      const ui = await $.ui.mount({
        plugin: 'conversation-atlas',
        surface: 'terminal',
        component: 'Pane',
        requestId: 'atlas',
        props: PANE_PROPS,
      })
      const suggestion = (await drawn(ui)).match(/"key":"(ok-s\d+)"/)?.[1]
      expect(suggestion).toBeDefined()
      await ui.press({ key: suggestion ?? '' })

      const collapsed = await drawn(ui)
      expect(collapsed).toContain('From Main path')
      expect(collapsed).toContain('Detour Side investigation')
      expect(collapsed).not.toContain('Make it the goal')

      const from = (await ui.findAll({ type: 'Button' })).find((button: any) => button.props.label === 'From Main path')
      expect(from).toBeDefined()
      await ui.press({ key: String(from?.props.key ?? '') })
      const expanded = await drawn(ui)
      for (const text of [
        'text: Side investigation',
        'checkpoint:',
        'when:',
        'why: Side investigation',
        'return target: Main path',
        'outcomes:',
        'exclusions:',
        'Return',
        'Make it the goal',
        '✕',
      ]) {
        expect(expanded).toContain(text)
      }
      await ui.unmount()
    }
  )
})

describe('suggestion text guards', () => {
  test('empty, punctuation, ellipsis and single alphanumeric observations never suggest', () => {
    const initial = observe(emptySnapshot('guard', ROOT, 0), { next: 'Keep the existing valid suggestion' }, 1)
    for (const text of ['', ' ', '…', '...', '?!—', 'a…', '…1']) {
      const result = observe(initial, { goal: text, next: text }, 2)
      expect(result.suggestions).toEqual(initial.suggestions)
    }
    expect(observe(emptySnapshot('valid', ROOT, 0), { next: '修复' }, 1).suggestions).toHaveLength(1)
  })


})

describe('Atlas detour findings', () => {
  test('excluded detour material reaches the return packet, separately from outcomes', async () => {
    let s = emptySnapshot('s', ROOT, 0)
    s = startTurn(s, 'Build the atlas pane for long sessions.', 1)
    s = confirmSuggestion(s, s.suggestions[0]?.id ?? '', 2)
    s = observe(s, { topic: 'Flaky tests', shift: 'possible-detour' }, 3)
    s = confirmSuggestion(s, s.suggestions.find(x => x.kind === 'detour')?.id ?? '', 4)
    s = observe(s, { decisions: ['Retry wrapper fixes it', 'Rewrite the runner'] }, 5)
    expect(s.detour?.reason).toBe('Flaky tests')
    const [keep, toss] = s.decisions
    expect(toss?.text).toBe('Rewrite the runner')
    s = setItemStatus(s, keep?.id ?? '', 'settled', 6)
    s = setItemStatus(s, toss?.id ?? '', 'excluded', 7)
    s = returnFromDetour(s, 8)
    const packet = s.pendingContext[0] ?? ''
    expect(packet).toContain('Accepted detour outcomes:\n- Retry wrapper fixes it')
    expect(packet).toContain('Excluded material (explored, do not rely on it):\n- Rewrite the runner')
  })

  test('/atlas recover full gates replacement and then loads the saved Atlas map', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    let source = setGoal(emptySnapshot('old-atlas-session', ROOT, 0), 'Recovered saved goal', 'person', 1)
    source = observe(source, { topic: 'Recovered saved topic', decisions: ['Recovered saved decision'] }, 2)
    const saved = saveFile(source, 20)
    on('fs.list', (_$: any, e: any) => {
      const path = String(e.path)
      if (/[\\/]\.claude[\\/]atlas$/.test(path)) {
        return { value: [{ name: 'old-atlas-session.json', kind: 'file', size: saved.length, mtimeMs: 20, isLink: false }] }
      }
      return { value: [] }
    })
    on('fs.read', (_$: any, e: any) => (String(e.path).endsWith('old-atlas-session.json') ? { value: saved } : { deny: 'not found' }))
    on('fs.write', () => ({ value: undefined }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()
    await $.command.run({ command: 'atlas', args: 'goal Current map goal', origin: { kind: 'composer' } } as any)

    const refused = await $.command.run({ command: 'atlas', args: 'recover 1 full', origin: { kind: 'composer' } } as any)
    expect(refused.text).toBe('this replaces your current map; run /atlas recover <n> full confirm to proceed')
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    expect(await drawn(ui)).toContain('Current map goal')

    const loaded = await $.command.run({ command: 'atlas', args: 'recover 1 full confirm', origin: { kind: 'composer' } } as any)
    expect(loaded.text).toBe('Loaded full map from session old-atla')
    const map = await drawn(ui)
    expect(map).toContain('Recovered saved goal')
    expect(map).toContain('Recovered saved topic')
    await ui.press({ key: 'tab-open' })
    expect(await drawn(ui)).toContain('Recovered saved decision')
    await ui.unmount()
  })

  test('/atlas recover full explains a rejected snapshot and leaves the current map alone', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    const invalid = JSON.parse(saveFile(emptySnapshot('bad-atlas-session', ROOT, 0), 20)) as { snapshot: Record<string, unknown> }
    invalid.snapshot.v = 99
    invalid.snapshot.decisions = []
    const saved = JSON.stringify({ format: 'conversation-atlas', v: 1, sessionId: 'bad-atlas-session', root: ROOT, snapshot: invalid.snapshot })
    on('fs.list', (_$: any, e: any) => {
      const path = String(e.path)
      if (/[\\/]\.claude[\\/]atlas$/.test(path)) {
        return { value: [{ name: 'bad-atlas-session.json', kind: 'file', size: saved.length, mtimeMs: 20, isLink: false }] }
      }
      return { value: [] }
    })
    on('fs.read', (_$: any, e: any) => (String(e.path).endsWith('bad-atlas-session.json') ? { value: saved } : { deny: 'not found' }))
    on('fs.write', () => ({ value: undefined }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()
    await $.command.run({ command: 'atlas', args: 'goal Current map goal', origin: { kind: 'composer' } } as any)

    const refused = await $.command.run({ command: 'atlas', args: 'recover 1 full confirm', origin: { kind: 'composer' } } as any)
    expect(refused.text).toBe("Can't load that save: unsupported version 99")
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    expect(await drawn(ui)).toContain('Current map goal')
    await ui.unmount()
  })
})

describe('readability: app bar, legend, resizing', () => {
  const mountPane = ($: any, props: any = PANE_PROPS) => $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props })

  test('Legend is a toggle panel, the bottom bar keeps only Legend and Mark', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Pane layout', decisions: ['Keep it native'] } as any)
    await clock.settle()
    for (const surface of ['terminal'] as const) {
      const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
      for (const button of await ui.findAll({ type: 'Button' })) expect(String(button.props.label ?? '')).not.toMatch(/ \^$/)
      await ui.press({ key: 'bar-legend' })
      const open = await drawn(ui)
      expect(open).toContain('LEGEND')
      expect(open).toContain('HOW TO USE')
      expect(open.indexOf('HOW TO USE')).toBeLessThan(open.indexOf('LEGEND'))
      expect(open.indexOf('legend-panel')).toBeGreaterThan(open.indexOf('CURRENT PATH'))
      expect(open.indexOf('legend-panel')).toBeLessThan(open.indexOf('bar-legend'))
      expect(open).toContain('your goal (confirmed)')
      expect(open).toContain('Topics from the start of the work to now')
      expect(open).toContain('Observer: Claude')
      expect(await ui.find({ key: 'bar-decisions' })).toBeUndefined()
      expect(await ui.find({ key: 'bar-questions' })).toBeUndefined()
      await ui.press({ key: 'observer-toggle' })
      expect(await drawn(ui)).toContain('Observer: Engine only')
      await ui.press({ key: 'observer-toggle' })
      await ui.press({ key: 'tab-open' })
      const openTab = await drawn(ui)
      expect(openTab).toContain('OBSERVED DECISIONS')
      expect(openTab).toContain('Keep it native')
      expect(openTab).toContain('"key":"dsel-')
      await ui.press({ key: 'tab-evidence' })
      expect(await drawn(ui)).toContain('SETTLED (LEDGER)')
      for (const button of await ui.findAll({ type: 'Button' })) expect(String(button.props.label ?? '')).not.toMatch(/ \^$/)
      await ui.unmount()
    }
  })

  test('narrow panes shorten the bar, short panes scroll the body and keep the bar', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    for (let i = 0; i < 8; i++) await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/file${i}.ts` } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Scrolling', questions: ['Does it scroll?'], next: 'Check the bar' } as any)
    await clock.settle()
    const narrow = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: { ...PANE_PROPS, bodyColumns: 34 } })
    const tiny = await drawn(narrow)
    expect(tiny).toContain('"label":"Legend"')
    expect(tiny).toContain('"label":"+ Mark"')
    expect(tiny).not.toContain('decisions')
    await narrow.unmount()

    const short = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 14 } } })
    expect(await short.find({ key: 'scroll-down' })).toBeDefined()
    expect(await short.find({ key: 'bar-legend' })).toBeDefined()
    await short.press({ key: 'scroll-down' })
    expect(await drawn(short)).toMatch(/"marginTop":-\d+/)
    expect(await short.find({ key: 'bar-legend' })).toBeDefined()
    await short.unmount()
  })

  test('at bodyColumns 26, 34, 48 and 72 every tab key and Mark remain drawn', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Responsive layout', decisions: ['Keep Mark visible'] } as any)
    await clock.settle()
    for (const bodyColumns of [26, 34, 48, 72]) {
      const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: { ...PANE_PROPS, bodyColumns } })
      expect(await ui.find({ key: 'tab-map', type: 'Button' })).toBeUndefined()
      for (const key of ['tab-trail', 'tab-open', 'tab-evidence', 'mark']) expect(await ui.find({ key })).toBeDefined()
      expect(await drawn(ui)).toContain('▸')
      await ui.unmount()
    }
  })

  test('expanded decision actions use a primary Button and bracketed secondary controls', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, decisions: ['Keep the pane native'] } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-open' })
    const collapsedButtons = await ui.findAll({ type: 'Button' })
    const decision = collapsedButtons.find((button: any) => String(button.props.key ?? '').startsWith('dsel-'))
    await ui.press({ key: String(decision?.props.key ?? '') })
    const buttons = await ui.findAll({ type: 'Button' })
    const settle = buttons.find((b: any) => String(b.props.key ?? '').startsWith('set-'))
    const drop = buttons.find((b: any) => String(b.props.key ?? '').startsWith('drp-'))
    expect(settle?.props.variant).toBe('primary')
    expect(drop?.props.plain).toBe(true)
    expect(drop?.props.label).toBe('Drop')
    const t = await drawn(ui)
    expect(t).toContain(`"color":"${C.action}"`)
    expect(t).toContain(`"hover":{"color":"${C.action}"}`)
    expect(t).toContain('"children":["["]')
    await ui.unmount()
  })

  test('needs-your-call, observed-decision and earlier-session actions live in one expansion', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    const earlier = emptySnapshot('prior-atlas-session', ROOT, 0)
    earlier.goal = { id: 'prior-goal', text: 'Earlier Atlas goal', at: 1, turn: 1, source: 'person' }
    const saved = saveFile(earlier, 20)
    on('fs.list', (_$: any, event: any) => /[\\/]\.claude[\\/]atlas$/.test(String(event.path))
      ? { value: [{ name: 'prior-atlas-session.json', kind: 'file', size: saved.length, mtimeMs: 20, isLink: false }] }
      : { value: [] })
    on('fs.read', (_$: any, event: any) => String(event.path).endsWith('prior-atlas-session.json') ? { value: saved } : { deny: 'not found' })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Action layout', next: 'Check the next action', decisions: ['Keep the observed action'] } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Side action', shift: 'possible-detour', why: 'Check the side path' } as any)
    await clock.settle()

    const ui = await mountPane($)
    await ui.press({ key: 'tab-open' })
    const collapsed = await drawn(ui)
    const suggestionButton = (await ui.findAll({ type: 'Button' })).find((button: any) => String(button.props.label).startsWith('Check the next act'))
    const suggestionKey = String(suggestionButton?.props.key ?? '')
    const decisionKey = collapsed.match(/"key":"(dsel-[^"]+)"/)?.[1]
    expect(suggestionKey).toBeDefined()
    expect(decisionKey).toBeDefined()
    for (const label of ['Pin next', 'Dismiss', 'Take detour', 'Not a detour', 'Confirm', 'Drop']) expect(collapsed).not.toContain(label)

    await ui.press({ key: suggestionKey ?? '' })
    let expanded = await drawn(ui)
    expect(expanded).toContain('kind: next suggestion')
    expect(expanded).toContain('source: Claude')
    expect(expanded).toContain('topic: Action layout')
    expect(expanded).toContain('Pin next')
    expect(expanded).toContain('Dismiss')
    expect(expanded).toContain('✕')
    expect(expanded).not.toContain('Confirm')

    await ui.press({ key: decisionKey ?? '' })
    expanded = await drawn(ui)
    expect(expanded).toContain('kind: observed decision')
    expect(expanded).toContain('source: Claude')
    expect(expanded).toContain('topic: Action layout')
    expect(expanded).toContain('Confirm')
    expect(expanded).toContain('Drop')
    expect(expanded).not.toContain('kind: next suggestion')

    await ui.press({ key: 'tab-evidence' })
    const evidenceCollapsed = await drawn(ui)
    expect(evidenceCollapsed).toContain('EARLIER SESSIONS')
    expect(evidenceCollapsed).not.toContain('Resume this')
    const recallKey = evidenceCollapsed.match(/"key":"(rc-[^"]+)"/)?.[1]
    expect(recallKey).toBeDefined()
    await ui.press({ key: recallKey ?? '' })
    const evidenceExpanded = await drawn(ui)
    expect(evidenceExpanded).toContain('kind: earlier session')
    expect(evidenceExpanded).toContain('Resume this')
    expect(evidenceExpanded).toContain('✕')
    await ui.unmount()
  })

  test('the expanded goal close control reserves the right edge', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.command.run({ command: 'atlas', args: 'goal Ship the pane', origin: { kind: 'composer' } } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'goal-row' })
    const close = await ui.find({ key: 'close-goal', type: 'Button' })
    expect(close?.props.plain).toBe(true)
    expect(close?.props.label).toBe('✕')
    const cell = nodeByKey(await ui.drawn(), 'expansion-close-cell-goal-row')
    expect(cell?.props?.width).toBe(1)
    expect(cell?.props?.flexShrink).toBe(0)
    await ui.unmount()
  })

  test('active tabs stay coloured and section headings expose info Buttons', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()
    const ui = await mountPane($)
    if (await ui.find({ key: 'tab-map', type: 'Button' })) await ui.press({ key: 'tab-map' })
    const map = await drawn(ui)
    expect(map).toContain('"color":"yellowBright"')
    await ui.press({ key: 'tab-trail' })
    expect(await ui.find({ key: 'tab-trail', type: 'Button' })).toBeUndefined()
    const t = await drawn(ui)
    expect(t).toContain('"children":["▸Trail"]')
    const heading = await ui.find({ type: 'Text', text: 'TRAIL · Story' })
    expect(heading?.props.color).toBe(C.trail)
    expect(heading?.props.bold).toBe(true)
    expect(heading?.props.wrap).toBe('truncate-end')
    const info = await ui.find({ key: 'events-heading', type: 'Button' })
    expect(info?.props.label).toBe('ⓘ')
    expect(info?.props.plain).toBe(true)
    await ui.unmount()
  })

  test('section titles are colored Text beside plain info Buttons on both surfaces', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()

    const terminal = await mountPane($)
    if (await terminal.find({ key: 'tab-trail', type: 'Button' })) await terminal.press({ key: 'tab-trail' })
    const terminalHeading = await terminal.find({ type: 'Text', text: 'TRAIL · Story' })
    expect(terminalHeading?.props.color).toBe(C.trail)
    expect(terminalHeading?.props.bold).toBe(true)
    expect(terminalHeading?.props.wrap).toBe('truncate-end')
    const terminalInfo = await terminal.find({ key: 'events-heading', type: 'Button' })
    expect(terminalInfo?.props.label).toBe('ⓘ')
    expect(terminalInfo?.props.plain).toBe(true)
    expect(terminalInfo?.props.variant).toBeUndefined()
    await terminal.press({ key: 'events-heading' })
    expect(await drawn(terminal)).toContain('A chronological record of prompts, topics, decisions and checkpoints.')
    await terminal.press({ key: 'events-heading' })
    await terminal.unmount()

  })

  test('settled decisions draw a solid green diamond', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.command.run({ command: 'atlas', args: 'decision Keep the pane native', origin: { kind: 'composer' } } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-evidence' })
    const t = await drawn(ui)
    expect(t).toContain(`"color":"${C.decision}"`)
    expect(t).toContain('"children":["◆ "]')
    await ui.unmount()
  })

  test('Open draws observed decisions as interactive rows and Evidence draws settled decisions', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, decisions: ['Observed decision'] } as any)
    await $.command.run({ command: 'atlas', args: 'decision Settled decision', origin: { kind: 'composer' } } as any)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    await ui.press({ key: 'tab-open' })
    const observed = (await ui.findAll({ type: 'Button' })).find((button: any) => String(button.props.key ?? '').startsWith('dsel-'))
    await ui.press({ key: String(observed?.props.key ?? '') })
    const open = await drawn(ui)
    expect(open).toContain('Observed decision')
    expect(open).toContain('"key":"dsel-')
    expect(open).toContain('Confirm')
    await ui.press({ key: 'tab-evidence' })
    const evidence = await drawn(ui)
    expect(evidence).toContain('Settled decision')
    expect(evidence).toContain('◆')
    await ui.unmount()
  })

  test('checkpoint rows draw exactly one checkpoint glyph', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.command.run({ command: 'atlas', args: 'mark UI checkpoint' , origin: { kind: 'composer' } } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-evidence' })
    const t = await drawn(ui)
    expect((t.match(/⚑/g) ?? []).length).toBe(1)
    await ui.unmount()
  })

  test('delegation rows cover in-session agents, visible terminal tabs, report files and unverified return', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId ?? 'test' }))
    let report = 'status: done\nsummary: stale report\nbranch: feat/m1-ui-library\ntests: old\nfiles:\n- hooks/view.tsx'
    on('fs.read', (_$: any, e: any) => /atlas-m1\.md$/i.test(String(e.path))
      ? { value: report }
      : { value: '' })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: 'Agent', description: 'Build the UI', subagent_type: 'general-purpose' } as any)
    await $.tool.call({ tool: 'PowerShell', command: 'wt -w 0 new-tab --title "Codex: Atlas M1" codex "Read C:/tmp/atlas-m1.md"', run_in_background: true } as any)
    await clock.advance(2_000)
    await clock.settle()
    const beforeReport = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    expect(await drawn(beforeReport)).not.toContain('← stale report')
    await beforeReport.unmount()
    report = 'status: done\nsummary: UI work complete\nbranch: feat/m1-ui-library\ntests: 42 pass\nfiles:\n- hooks/view.tsx\n- hooks/model.ts'
    await clock.advance(2_000)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    await ui.press({ key: 'tab-trail' })
    await ui.press({ key: 'trail-view-menu' })
    await ui.press({ key: 'trail-view-log' })
    let text = await drawn(ui)
    expect(text).toContain('"children":["→ "]')
    expect(text).toContain('"label":"Build the UI"')
    expect(text).toContain('"children":["← "]')
    expect(text).toContain('"label":"general-purpose completed"')
    expect(text).toContain('"label":"Codex: Atlas M1')
    expect(text).toContain('"label":"UI work complete · 2 files · 42 pass"')
    expect(text).toContain('2 files')

    const notification = [
      '<task-notification><task-id>bxy5qrs4n</task-id>',
      '<summary>Finished checking the report</summary><status>done</status></task-notification>',
    ].join('')
    await $.turn.start({ turnId: 'notification', text: notification } as any)
    await clock.settle()
    text = await drawn(ui)
    expect(text).not.toContain('› Finished checking the report')
    expect(text).toContain('"label":"Finished checking the report"')

    await $.tool.call({ tool: 'PowerShell', command: 'wt new-tab --title "Codex: No report" codex', run_in_background: true } as any)
    await $.turn.start({ turnId: 'typed', text: 'Continue the main work.' } as any)
    await clock.settle()
    expect(await drawn(ui)).toContain('"label":"back · unverified · Codex: No report"')
    await $.turn.start({ turnId: 'typed-2', text: 'Keep going.' } as any)
    await clock.settle()
    expect((await drawn(ui)).match(/back · unverified/g)?.length).toBe(1)
    await ui.unmount()
  })
})

describe('milestone 1: UI primitives and engine noise', () => {
  test('row truncation keeps priority segments and filenames at widths 20 through 100', () => {
    const path = 'C:/Users/Neel/Documents/memory/atlas-branching.md'
    const filename = 'atlas-branching.md'
    for (let width = 20; width <= 100; width++) {
      const middle = truncateMiddleCells(path, width)
      expect(cellWidth(middle)).toBeLessThanOrEqual(width)
      expect(middle.endsWith(filename)).toBe(true)

      const row = layoutRow({
        width,
        prefix: '⚑ ',
        text: path,
        meta: 'turn 51 · extra context',
        right: '3h',
        middle: true,
      })
      const metadata = row.meta ? `${row.meta}${row.right ? ' · ' : ''}` : ''
      const drawn = `⚑ ${row.text}${metadata}${row.right ?? ''}`
      expect(cellWidth(drawn)).toBeLessThanOrEqual(width)
      expect(row.right).toBeTruthy()
    }

    const preserved = layoutRow({ width: 32, prefix: '⚑ ', text: 'Keep the important text', meta: 'turn 51', right: '3h' })
    expect(preserved.text).toBe('Keep the important text')
    expect(preserved.meta).toBeUndefined()
    expect(preserved.right).toBe('3h')
    expect(layoutRow({ width: 24, prefix: '⚑ ', text: path, right: '3h', middle: true }).text.endsWith(filename)).toBe(true)
  })

  test('bars choose the largest measured grid that fits at every width', () => {
    const tabs = [
      { key: 'map', label: 'Map', short: 'Map', compact: 'M', active: true, hotkey: 'm', onPress: () => undefined },
      { key: 'trail', label: 'Trail', short: 'Trail', compact: 'T', hotkey: 't', onPress: () => undefined },
      { key: 'open', label: 'Open 123456', short: 'Open 123456', compact: 'O', hotkey: 'o', onPress: () => undefined },
      { key: 'evidence', label: 'Evidence', short: 'Evid', compact: 'E', hotkey: 'e', onPress: () => undefined },
    ]
    const bottom = [
      { key: 'legend', label: 'Legend', short: 'Legend', compact: '≡', hotkey: 'l', onPress: () => undefined },
      { key: 'decisions', label: '12 decisions →', short: '12 dec →', compact: '12→', icon: '◇', hotkey: 'd', onPress: () => undefined },
      { key: 'questions', label: '8 open →', short: '8 open →', compact: '8→', icon: '?', hotkey: 'q', onPress: () => undefined },
      { key: 'mark', label: '+ Mark', short: '+ Mark', compact: '+', hotkey: 'k', onPress: () => undefined },
    ]
    expect(measuredBarItemWidth({ label: 'Map', hotkey: 'm' })).toBe(6)
    expect(measuredBarItemWidth({ label: 'Trail', activeMarker: '▸' })).toBe(6)
    expect(measuredBarItemWidth({ label: '9', icon: '◇', prefixGap: 1, hotkey: 'd', buttonChrome: 'bracketed' })).toBe(8)
    for (const collapse of [tuiCollapseBarLabels]) {
      let previousTabs = 0
      let previousBottom = 0
      for (let width = 20; width <= 100; width++) {
        const t = collapse(tabs, width, 1, 'tabs')
        const b = collapse(bottom, width, 1, 'bar')
        expect(t.labels).toHaveLength(4)
        expect(b.labels).toHaveLength(4)
        expect(t.grid.fits).toBe(true)
        expect(b.grid.fits).toBe(true)
        expect(t.grid.rowWidths.every(rowWidth => rowWidth <= width)).toBe(true)
        expect(b.grid.rowWidths.every(rowWidth => rowWidth <= width)).toBe(true)
        expect(t.labels[0]).toBeTruthy()
        expect(b.labels[3]).toBeTruthy()
        expect(t.grid.columns).toBeGreaterThanOrEqual(previousTabs)
        expect(b.grid.columns).toBeGreaterThanOrEqual(previousBottom)
        previousTabs = t.grid.columns
        previousBottom = b.grid.columns
      }
      if (collapse === tuiCollapseBarLabels) {
        expect(collapse(tabs, 20, 1, 'tabs').grid.columns).toBe(1)
        expect(collapse(tabs, 23, 1, 'tabs').grid.columns).toBe(2)
        expect(collapse(tabs, 100, 1, 'tabs').grid.columns).toBe(4)
      }
    }
  })

  test('rendered bars keep whole labels at the requested terminal widths', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()
    const surfaceWidths = [['terminal', [30, 40, 46, 60, 100]] as const]
    for (const [surface, widths] of surfaceWidths) {
      for (const bodyColumns of widths) {
        const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'atlas', props: { ...PANE_PROPS, bodyColumns } })
        const text = await drawn(ui)
        expect(text).toContain('Trail')
        expect(text).toContain('Legend')
        expect(text).toContain('Mark')
        expect(text).toContain('open')
        expect(text).not.toMatch(/"label":"[MTOE]"/)
        expect(text).not.toMatch(/"children":"▸[MTOE]"/)
        for (const tab of ['trail', 'open', 'evidence']) expect(text).toContain(`"key":"tab-${tab}"`)
        for (const key of ['bar-legend', 'mark']) expect(text).toContain(`"key":"${key}"`)
        for (const key of ['bar-legend', 'mark']) expect(await ui.find({ key, type: 'Button' })).toBeDefined()
        for (const key of ['bar-decisions', 'bar-questions']) expect(await ui.find({ key, type: 'Button' })).toBeUndefined()
        expect((await ui.find({ key: 'tab-bar' }))?.props.flexDirection).toBe('column')
        expect((await ui.find({ key: 'bottom-bar' }))?.props.flexDirection).toBe('column')
        expect((await ui.find({ key: 'tab-row-0' }))?.props.flexShrink).toBe(0)
        expect((await ui.find({ key: 'bar-row-0' }))?.props.flexShrink).toBe(0)
        await ui.unmount()
      }
    }
  })

  test('prompt markers leave only typed text and marker-only turns make no prompt event', () => {
    expect(stripPromptMarkers('<task-notification>done</task-notification>')).toBe('')
    expect(stripPromptMarkers('<agent-message from="Codex">done</agent-message>')).toBe('')
    expect(stripPromptMarkers('<pasted_content>one\ntwo</pasted_content>')).toBe('pasted 2 lines')
    expect(stripPromptMarkers('[Image #4]')).toBe('image')
    expect(stripPromptMarkers('Please use this. <pasted_content>a\nb</pasted_content> [Image #4]')).toBe('Please use this. pasted 2 lines image')
    let s = startTurn(emptySnapshot('s', ROOT, 0), '<task-notification>done</task-notification>', 1)
    s = startTurn(s, '<agent-message from="Codex">done</agent-message>', 2)
    expect(s.events.some(e => e.kind === 'prompt')).toBe(false)
    expect(s.suggestions).toHaveLength(0)
    s = startTurn(s, 'Build this with [Image #4].', 3)
    expect(s.events.find(e => e.kind === 'prompt')?.text).toBe('Build this with image.')
  })

  test('report markers use summary before status and remove XML tags', () => {
    const markerText = '<task-notification><task-id>bxy5qrs4n</task-id><summary>Done <em>cleanly</em></summary><status>done</status></task-notification>'
    const marker = reportMarker(markerText)
    expect(marker).toEqual({ agent: null, taskId: 'bxy5qrs4n', summary: 'Done cleanly' })
    const statusOnly = reportMarker('<task-notification><task-id>t2</task-id><status>blocked</status></task-notification>')
    expect(statusOnly?.summary).toBe('blocked')
    expect(statusOnly?.summary).not.toContain('<')
  })

  test('checkpoint text is not echoed and consecutive identical checkpoints collapse', () => {
    let s = emptySnapshot('s', ROOT, 0)
    s = touchFile(s, `${ROOT}/hooks/model.ts`, 'write', 1)
    s = addCheckpoint(s, 'Tests passed', 'tests', 'claude plugin test .', 2)
    s = touchFile(s, `${ROOT}/hooks/model.ts`, 'write', 3)
    s = addCheckpoint(s, 'Tests passed', 'tests', 'claude plugin test .', 4)
    const events = collapseEvents(s.events.filter(e => e.kind === 'checkpoint'))
    expect(events).toHaveLength(1)
    expect(events[0]?.text).toBe('Tests passed · claude plugin test . ×2')
    expect(events[0]?.text).not.toContain('Tests passed: Tests passed')
  })

  test('delegation detection, reports, malformed files and unverified closure are pure and bounded', () => {
    const agent = handoffStart('Agent', { description: 'Build the UI', subagent_type: 'general-purpose' })
    expect(agent?.label).toBe('Build the UI')
    const external = handoffStart('PowerShell', { command: 'wt -w 0 new-tab --title "Codex: Atlas" codex "Read C:/tmp/atlas-m1.md"', run_in_background: true })
    expect(external?.label).toBe('Codex: Atlas')
    expect(expectedReportPath(ROOT, external?.brief ?? null)).toBe(`${ROOT}/.claude/atlas/handoffs/atlas-m1.md`)
    const variablePath = startHandoff(emptySnapshot('variable-path', ROOT, 0), 'Atlas review', 'Codex', '$W/.claude/atlas/handoffs/atlas-j1.md', null, 1)
    expect(variablePath.events.at(-1)?.text).toContain('atlas-j1.md')
    expect(variablePath.events.at(-1)?.text).not.toContain('$W')
    const watcher = handoffStart('PowerShell', { command: 'Get-Content .\\generated\\atlas.json -Wait\nWrite-Output still-watching', description: 'Watch generated Atlas files', run_in_background: true })
    expect(watcher).toBeNull()
    const fallback = handoffStart('PowerShell', { command: 'Get-Content .\\generated\\atlas.json -Wait\nWrite-Output still-watching', run_in_background: true })
    expect(fallback).toBeNull()
    expect(handoffStart('PowerShell', { command: 'tasklist | grep codex', run_in_background: true })).toBeNull()
    expect(handoffStart('PowerShell', { command: 'tail codex-m2.log', run_in_background: true })).toBeNull()
    expect(handoffStart('PowerShell', { command: 'cat atlas-m2.md', run_in_background: true })).toBeNull()
    expect(handoffStart('PowerShell', { command: 'until test -f report.md; do sleep 1; done', run_in_background: true })).toBeNull()
    expect(handoffStart('PowerShell', { command: 'codex exec --title M2 fix', run_in_background: true })?.agent).toBe('Codex')
    expect(handoffStart('PowerShell', { command: 'echo ready && codex exec --title M2 fix', run_in_background: true })?.agent).toBe('Codex')
    expect(handoffStart('PowerShell', { command: 'claude -p "summarize"', run_in_background: true })?.agent).toBe('Claude')
    expect(parseHandoffReport('status: pending')).toBeNull()
    const partial = parseHandoffReport('status: done\nfiles:\n- hooks/view.tsx')
    expect(partial?.summary).toBe('No summary provided')
    expect(partial?.files).toEqual(['hooks/view.tsx'])
    const realShape = parseHandoffReport(`status: done
summary: Atlas M1 review fixes
branch: feat/m1-ui-library
tests: pending
files:
hooks/render-tui.tsx
hooks/delegation.ts
hooks/model.ts
hooks/register.tsx
hooks/view.tsx
types/index.d.ts
tests/atlas.test.tsx

A: The prose body must not become a file.`)
    expect(realShape?.files).toHaveLength(7)
    expect(realShape?.files).toEqual(['hooks/render-tui.tsx', 'hooks/delegation.ts', 'hooks/model.ts', 'hooks/register.tsx', 'hooks/view.tsx', 'types/index.d.ts', 'tests/atlas.test.tsx'])

    let files = emptySnapshot('s', ROOT, 0)
    files = touchFile(files, `${ROOT}/hooks/view.tsx`, 'write', 1)
    files = touchFile(files, 'hooks/view.tsx', 'write', 2, 'Codex')
    expect(resolveRepoPath(ROOT, 'hooks/view.tsx')).toBe(`${ROOT}/hooks/view.tsx`)
    expect(resolveRepoPath(ROOT, `${ROOT}\\hooks\\view.tsx`)).toBe(`${ROOT}/hooks/view.tsx`)
    expect(files.files).toHaveLength(1)
    expect(files.files[0]?.path).toBe(`${ROOT}/hooks/view.tsx`)
    expect(files.files[0]?.writes).toBe(2)

    const oldReport = 'status: done\nsummary: old\n'
    const newReport = 'status: done\nsummary: new\n'
    expect(reportChanged(reportFingerprint(oldReport), oldReport)).toBe(false)
    expect(reportChanged(reportFingerprint(oldReport), newReport)).toBe(true)

    let s = emptySnapshot('s', ROOT, 0)
    s = startHandoff(s, external?.label ?? 'Codex', external?.agent ?? 'Codex', external?.brief ?? null, expectedReportPath(ROOT, external?.brief ?? null), 1)
    s = reportHandoff(s, partial?.summary ?? 'done', 2, 'Codex', s.handoffs[0]?.id, partial?.tests ?? null, partial?.files ?? [])
    expect(s.handoffs[0]?.status).toBe('reported')
    expect(s.events.at(-1)?.kind).toBe('report-back')
    s = startHandoff(s, 'unverified', 'Codex', null, null, 3)
    s = closeUnverifiedHandoffs(s, 4)
    expect(s.handoffs.at(-1)?.status).toBe('closed')
    expect(s.events.at(-1)?.text).toContain('back · unverified')
    expect(closeUnverifiedHandoffs(s, 5)).toBe(s)
  })
})

describe('milestone 2: screens and surface parity', () => {
  const screenView = (tab: 'map' | 'trail' | 'open' | 'evidence') => ({
    setup: false,
    tab,
    refs: {},
    nextRef: 1,
    editingGoal: false,
    legend: false,
    popup: null,
    popupScroll: 0,
    legendScroll: 0,
    scroll: 0,
    expandedScroll: 0,
    fullConfirm: null,
    trailNewest: true,
    trailView: 'story' as const,
    expanded: null,
    mode: 'claude' as const,
  })

  test('each tab is a pure ScreenModel and the same snapshot feeds both surfaces', () => {
    let snapshot = observe(
      emptySnapshot('screen', ROOT, 0),
      {
        topic: 'Screen layers',
        decisions: ['Keep one model'],
        questions: ['Does parity hold?'],
        next: 'Add renderers',
        checkpoint: 'Model ready',
      },
      10,
    )
    snapshot = touchFile(snapshot, `${ROOT}/hooks/screens/map.ts`, 'write', 11)
    const builders = [['map', buildMap], ['trail', buildTrail], ['open', buildOpen], ['evidence', buildEvidence]] as const
    for (const [tab, build] of builders) {
      const view = screenView(tab)
      const first = build(snapshot, view, 20)
      const second = build(snapshot, view, 20)
      expect(first).toEqual(second)
      expect(first.tab).toBe(tab)
      expect(first.sections.every(section => section.heading && section.explain && Array.isArray(section.rows))).toBe(true)
      expect(first.sections.flatMap(section => section.rows).every(row => row.id && row.key && row.text !== undefined)).toBe(true)
      expect(JSON.stringify(first)).not.toContain('position')
      expect(JSON.stringify(first)).not.toContain('Button')
    }
  })

  test('Resume next actions belong only to the suggestion supplying the hint', () => {
    const suggested = observe(emptySnapshot('resume', ROOT, 0), { next: 'Suggested step' }, 1)
    const suggestionId = suggested.suggestions.at(-1)?.id
    expect(suggestionId).toBeTruthy()
    const resumeRow = (snapshot: ReturnType<typeof emptySnapshot>, mode: 'claude' | 'engine' = 'claude') =>
      buildMap(snapshot, { ...screenView('map'), mode }, 2).sections.find(section => section.key === 'next')?.rows[0]

    const pinned = resumeRow({ ...suggested, nextStep: 'Pinned step' })
    expect(pinned?.text).toBe('Pinned step')
    expect(pinned?.actions).toEqual([])
    expect(pinned?.dim).toBe(false)

    const detour = resumeRow(startDetour(suggested, 'Detour step', null, 2))
    expect(detour?.text).toContain('Finish "Detour step"')
    expect(detour?.actions).toEqual([])
    expect(detour?.dim).toBe(false)

    const suggestion = resumeRow(suggested)
    expect(suggestion?.text).toBe('Suggested step')
    expect(suggestion?.actions?.map(action => action.action)).toEqual([
      { type: 'confirm', id: suggestionId },
      { type: 'dismiss', id: suggestionId },
    ])

    const needsObserver = resumeRow(suggested, 'engine')
    expect(needsObserver?.actions?.map(action => action.label)).toEqual(['Turn on'])
  })

  test('file read and write counts keep their semantic tones on Map and Evidence', () => {
    let snapshot = emptySnapshot('file-counts', ROOT, 0)
    snapshot = touchFile(snapshot, `${ROOT}/hooks/model.ts`, 'read', 1)
    snapshot = touchFile(snapshot, `${ROOT}/hooks/model.ts`, 'write', 2)
    const map = buildMap(snapshot, screenView('map'), 3).sections.find(section => section.key === 'files')?.rows[0]
    const evidence = buildEvidence(snapshot, screenView('evidence'), 3).sections.find(section => section.key === 'files')?.rows[0]
    for (const row of [map, evidence]) {
      expect(row?.metaParts?.map(part => [part.text, part.tone])).toEqual([
        ['1e', 'write'],
        ['1r', 'read'],
      ])
    }
  })

  test('Atlas earlier-session expansion offers a confirmed full-resume action', () => {
    const snapshot = {
      ...emptySnapshot('current', ROOT, 0),
      recall: [{
        id: 'atlas:source-session',
        source: 'atlas' as const,
        sessionId: 'source-session',
        at: 0,
        goal: 'Saved goal',
        nextStep: 'Saved next step',
        detour: null,
        topic: 'Saved topic',
        decisions: [],
      }],
    }
    const view = screenView('evidence')
    const row = buildEvidence(snapshot, view, 1).sections.flatMap(section => section.rows).find(candidate => candidate.id === 'atlas:source-session')
    expect(row?.actions?.map(item => item.label)).toEqual(['Resume this', 'Resume full'])
    const pending = buildEvidence(snapshot, { ...view, fullConfirm: 'atlas:source-session' }, 1).sections
      .flatMap(section => section.rows)
      .find(candidate => candidate.id === 'atlas:source-session')
    expect(pending?.actions?.map(item => item.label)).toEqual(['Resume this', 'Confirm full resume'])
    expect(pending?.detail).toContain('this replaces your current map; press Confirm full resume to proceed')
  })

  test('Evidence marks every adopted earlier session unavailable and leaves the rest actionable', () => {
    const snapshot = {
      ...emptySnapshot('current', ROOT, 0),
      adopted: ['atlas:adopted-a', 'atlas:adopted-c'],
      recall: ['adopted-a', 'adopted-b', 'adopted-c'].map((name, index) => ({
        id: `atlas:${name}`,
        source: 'atlas' as const,
        sessionId: name,
        at: index,
        goal: `${name} goal`,
        nextStep: null,
        detour: null,
        topic: null,
        decisions: [],
      })),
    }
    const rows = buildEvidence(snapshot, screenView('evidence'), 1).sections.find(section => section.key === 'recall')?.rows ?? []

    for (const id of ['atlas:adopted-a', 'atlas:adopted-c']) {
      const row = rows.find(candidate => candidate.id === id)
      expect(row?.glyph).toBe('ok')
      expect(row?.dim).toBe(true)
      expect(row?.actions).toEqual([])
    }
    const available = rows.find(candidate => candidate.id === 'atlas:adopted-b')
    expect(available?.glyph).toBe('resume')
    expect(available?.dim).toBe(false)
    expect(available?.actions?.map(action => action.label)).toEqual(['Resume this', 'Resume full'])
  })

  test('Trail Story groups a turn, keeps the full prompt in its expansion, and marks sources', () => {
    let snapshot = startTurn(emptySnapshot('story', ROOT, 0), 'Build the story view. Keep the prompt intact.\n- show counts', 1)
    snapshot = observe(snapshot, { topic: 'Story layout', decisions: ['Keep the view pure'], questions: ['Does Log stay flat?'] }, 2)
    const story = buildTrail(snapshot, screenView('trail'), 3).sections.find(section => section.key === 'events')
    const row = story?.rows[0]
    expect(story?.heading).toBe('TRAIL · Story')
    expect(story?.rows).toHaveLength(1)
    expect(row?.text).toBe('Build the story view.')
    expect(row?.metaParts?.some(part => part.text === '1t')).toBe(true)
    expect(row?.detail?.join('\n')).toContain('Build the story view. Keep the prompt intact.')
    expect(row?.detail?.join('\n')).toContain('✻ Topic: Story layout')
    expect(row?.sourceMark).toBe('›')

    const log = buildTrail(snapshot, { ...screenView('trail'), trailView: 'log' }, 3).sections.find(section => section.key === 'events')
    expect(log?.heading).toBe('TRAIL · Log')
    expect(log?.rows.length).toBeGreaterThan(1)
    expect(log?.rows.some(candidate => candidate.sourceMark === '✻')).toBe(true)
  })

  test('terminal renders every screen at narrow and wide widths', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({
      tool: OBSERVE,
      topic: 'Cross-surface screens',
      decisions: ['Keep the data shared'],
      questions: ['Is the GUI native?'],
      next: 'Check both surfaces',
    } as any)
    await clock.settle()
    for (const surface of ['terminal'] as const) {
      for (const bodyColumns of [40, 80]) {
        const ui = await $.ui.mount({
          plugin: 'conversation-atlas',
          surface,
          component: 'Pane',
          requestId: 'atlas',
          props: { ...PANE_PROPS, bodyColumns },
        })
        const tabHeadings: Record<string, string[]> = {
          map: ['GOAL', 'CURRENT PATH', 'ACTIVITY'],
          trail: ['MAP OF TOPICS', 'TRAIL'],
          open: ['NEEDS YOUR CALL', 'OPEN QUESTIONS'],
          evidence: ['CHECKPOINTS', 'FILES'],
        }
        if (await ui.find({ key: 'tab-map', type: 'Button' })) await ui.press({ key: 'tab-map' })
        for (const tab of ['map', 'trail', 'open', 'evidence'] as const) {
          if (tab !== 'map') await ui.press({ key: `tab-${tab}` })
          const text = await drawn(ui)
          for (const heading of tabHeadings[tab] ?? []) expect(text).toContain(heading)
        }
        const text = await drawn(ui)
        expect(text).toContain('tab-trail')
        expect(text).toContain('bar-legend')
        await ui.unmount()
      }
    }
  })

  test('Trail renders legacy task ids and doubled handoff arrows cleanly', () => {
    const legacy: AtlasEvent = { id: 'legacy', at: 10, turn: 2, kind: 'report-back', text: '← ← <task-id>old-task</task-id> back · unverified · Codex' }
    const snapshot = { ...emptySnapshot('legacy', ROOT, 0), events: [legacy] }
    const rows = buildTrail(snapshot, { ...screenView('trail'), trailView: 'log' }, 20).sections.flatMap(section => section.rows)
    const row = rows.find(candidate => candidate.id === legacy.id)
    expect(eventText(legacy.text)).toBe('back · unverified · Codex')
    expect(row?.text).toBe('back · unverified · Codex')
    expect(JSON.stringify(row)).not.toContain('task-id')
    expect(JSON.stringify(row)).not.toContain('← ←')
  })

  test('handoff marks identify named agents and preserve default marks for built-in agents', () => {
    const snapshot = emptySnapshot('handoff-marks', ROOT, 0)
    const agents = ['Ollama', 'Codex', 'background', 'Claude']
    snapshot.handoffs = agents.map((agent, index) => ({
      id: `h${index}`, label: `Task ${index}`, agent, brief: null, reportPath: null,
      at: 100 + index * 10, turn: 1, status: 'reported', summary: null, tests: null,
      files: [], reportFingerprint: null, taskId: null,
    }))
    snapshot.events = agents.flatMap((agent, index) => ([
      { id: `handoff-${index}`, at: 100 + index * 10, turn: 1, kind: 'handoff' as const, text: `Task ${index}` },
      { id: `report-${index}`, at: 101 + index * 10, turn: 1, kind: 'report-back' as const, text: `Task ${index} complete` },
    ]))
    const rows = buildTrail(snapshot, { ...screenView('trail'), trailView: 'log' }, 200).sections
      .flatMap(section => section.rows)
    for (const index of [0, 1, 2, 3]) {
      const expected = index === 0 ? ['□', '#9aa5b1'] : ['⌬', '#7c8cff']
      for (const id of [`handoff-${index}`, `report-${index}`]) {
        const row = rows.find(candidate => candidate.id === id)
        expect(row?.detail?.[3]?.startsWith(`${expected[0]} `)).toBe(true)
        expect(row?.sourceMarkColor).toBe(expected[1])
      }
    }
  })

  test('Legend stays compact and section headings open fuller inline help', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Heading help' } as any)
    await clock.settle()
    const ui = await $.ui.mount({
      plugin: 'conversation-atlas',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'atlas',
      props: PANE_PROPS,
    })
    await ui.press({ key: 'bar-legend' })
    const inline = await drawn(ui)
    expect(inline).toContain('HOW TO USE')
    expect(inline).toContain('LEGEND')
    expect(inline).not.toContain('legend-more')
    expect(inline).not.toContain('LEGEND · MORE')
    await ui.press({ key: 'tab-trail' })
    const topicHeading = await ui.find({ key: 'topics-heading', type: 'Button' })
    expect(topicHeading).toBeDefined()
    const topicRow = (await ui.findAll({ type: 'Button' })).find((button: any) => String(button.props.key ?? '').startsWith('tsel-'))
    expect(topicRow).toBeDefined()
    await ui.press({ key: String(topicRow?.props.key ?? '') })
    expect(await drawn(ui)).toContain('kind: main')
    await ui.press({ key: 'topics-heading' })
    let help = await drawn(ui)
    expect(help).toContain('The observed topic tree for this session.')
    expect(help).toContain('help-down-topics')
    expect(help).not.toContain('kind: main')
    await ui.press({ key: 'topics-heading' })
    await ui.press({ key: 'events-heading' })
    help = await drawn(ui)
    expect(help).toContain('A chronological record of prompts, topics, decisions and checkpoints.')
    expect(help).toContain('help-down-events')
    await ui.press({ key: 'help-down-events' })
    help = await drawn(ui)
    expect(help).toMatch(/2\/\d+/)
    await ui.press({ key: 'topics-heading' })
    const switched = await drawn(ui)
    expect(switched).toContain('The observed topic tree for this session.')
    expect(switched).not.toContain('A chronological record of prompts, topics, decisions and checkpoints.')
    await ui.press({ key: 'topics-heading' })
    expect(await drawn(ui)).not.toContain('The observed topic tree for this session.')
    await ui.unmount()

    const compact = await $.ui.mount({
      plugin: 'conversation-atlas',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'atlas',
      props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 14 } },
    })
    await compact.press({ key: 'events-heading' })
    const compactHelp = await drawn(compact)
    expect(compactHelp).toContain('Press an event to open its full text and points.')
    expect(compactHelp).not.toContain('Use ↑ for newest first or ↓ for oldest first.')
    await compact.unmount()
  })

  test('terminal standard rows and working-set rows stay one line at 46 and 80 columns', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId ?? 'rows' }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.command.run({ command: 'atlas', args: 'mark M2 checkpoint', origin: { kind: 'composer' } } as any)
    await $.tool.call({ tool: 'Read', file_path: `${ROOT}/hooks/view.tsx` } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Screen rows' } as any)
    await $.turn.start({ turnId: 'rows', text: 'A prompt event for the trail.' } as any)
    await clock.settle()
    for (const bodyColumns of [46, 80]) {
      const ui = await $.ui.mount({
        plugin: 'conversation-atlas',
        surface: 'terminal',
        component: 'Pane',
        requestId: 'atlas',
        props: { ...PANE_PROPS, bodyColumns },
      })
      await ui.press({ key: 'tab-evidence' })
      const evidence = await ui.drawn()
      const evidenceText = JSON.stringify(evidence)
      const checkpointKey = [...evidenceText.matchAll(/"key":"(csel-[^"]+)"/g)].length
      expect(checkpointKey).toBeGreaterThan(0)
      const checkpoint = nodeByKey(evidence, evidenceText.match(/"key":"(csel-[^"]+)"/)?.[1] ?? '')
      expect(checkpoint).toBeDefined()
      expect(rowsOf(checkpoint, bodyColumns)).toBe(1)
      const file = nodeByKey(evidence, evidenceText.match(/"key":"(ef-[^"]+)"/)?.[1] ?? '')
      expect(file).toBeDefined()
      expect(rowsOf(file, bodyColumns)).toBe(1)
      expect(JSON.stringify(file)).toContain('"color":"#bb9af7"')
      expect(JSON.stringify(file)).toContain('"color":"#ff9e64"')

      await ui.press({ key: 'tab-trail' })
      const trail = await ui.drawn()
      const event = nodeByKey(trail, JSON.stringify(trail).match(/"key":"(evb-[^"]+)"/)?.[1] ?? '')
      const topic = nodeByKey(trail, JSON.stringify(trail).match(/"key":"(tsel-[^"]+)"/)?.[1] ?? '')
      expect(event && rowsOf(event, bodyColumns)).toBe(1)
      expect(topic && rowsOf(topic, bodyColumns)).toBe(1)
      expect(JSON.stringify(trail)).not.toContain('→ →')
      expect(JSON.stringify(trail)).not.toContain('← ←')
      await ui.unmount()
    }
  })

  test('all tab rows stay one line on both surfaces at 46 and 80 columns', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: 'Read', file_path: `${ROOT}/hooks/screens/map.ts` } as any)
    await $.tool.call({
      tool: OBSERVE,
      topic: 'Every tab stays readable',
      decisions: ['Keep rows bounded'],
      questions: ['Does every surface stay one line?'],
      next: 'Review the compact rows',
      checkpoint: 'Row layout tested',
    } as any)
    await clock.settle()
    for (const surface of ['terminal'] as const) {
      for (const bodyColumns of [46, 80]) {
        const ui = await $.ui.mount({
          plugin: 'conversation-atlas',
          surface,
          component: 'Pane',
          requestId: 'atlas',
          props: { ...PANE_PROPS, bodyColumns },
        })
        for (const tab of ['map', 'trail', 'open', 'evidence'] as const) {
          if (await ui.find({ key: `tab-${tab}`, type: 'Button' })) await ui.press({ key: `tab-${tab}` })
          const tree = await ui.drawn()
          const keys = [...JSON.stringify(tree).matchAll(/"key":"(head-[^"]+)"/g)].map(match => match[1] ?? '')
          expect(keys.length).toBeGreaterThan(0)
          for (const key of keys) expect(rowsOf(nodeByKey(tree, key), bodyColumns)).toBe(1)
        }
        await ui.unmount()
      }
    }
  })

  test('Legend fits above the bottom bar and keeps glyph spacing at short and tall heights', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()
    for (const bodyRows of [30, 45]) {
      const ui = await $.ui.mount({
        plugin: 'conversation-atlas',
        surface: 'terminal',
        component: 'Pane',
        requestId: 'atlas',
        props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows } },
      })
      await ui.press({ key: 'bar-legend' })
      const tree = await ui.drawn()
      expect(JSON.stringify(tree)).toContain('"key":"legend-panel"')
      const panel = nodeByKey(tree, 'legend-panel')
      expect(panel).toBeDefined()
      expect(Number(panel?.props?.height)).toBeLessThanOrEqual(bodyRows)
      const text = JSON.stringify(tree)
      expect(text).toContain('"children":["↩ "]')
      expect(text).toContain('"children":["✗ "]')
      expect(text).toContain('"children":["✎ "]')
      await ui.press({ key: 'bar-legend' })
      await ui.unmount()
    }
  })
})

const EARLIER = [
  { role: 'user', text: 'Build the release checklist pane for the team.', toolUses: [] },
  { role: 'assistant', text: 'Reading the code.', toolUses: [
    { tool: 'Read', input: { file_path: `${ROOT}/src/pane.ts` }, result: {} },
    { tool: 'Edit', input: { file_path: `${ROOT}/src/pane.ts`, old_string: 'a', new_string: 'b' }, result: {} },
    { tool: 'Bash', input: { command: 'npm test' }, result: {} },
  ] },
  { role: 'user', text: '<system-reminder>not typed</system-reminder>', toolUses: [] },
  { role: 'assistant', text: 'Done. Should the pane also show owners?', toolUses: [] },
]

const MAP_REPLY = 'Here it is:\n```json\n{"goal":"Ship the release checklist","topics":[{"topic":"Checklist pane"},{"topic":"Owner column","shift":"subtopic"},{"topic":"CI flakiness","shift":"possible-detour","why":"side trip"}],"decisions":["Keep it native"],"questions":["Who owns QA?"],"next":"Add the owner column"}\n```'

describe('joining a conversation late', () => {
  test('replays earlier rows for free on launch, and /atlas scan maps topics through one fork', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    let forks = 0
    on('session.messages', () => ({ value: EARLIER as any }))
    on('model.fork', () => {
      forks += 1
      return { value: { isAnswered: true, text: MAP_REPLY, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()
    expect(forks).toBe(0)
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    let text = await drawn(ui)
    expect(text).toContain('Build the release checklist pane for the team.')
    expect(text).toContain('pane.ts')
    expect(text).toContain('Should the pane also show owners?')
    expect(text).not.toContain('not typed')

    const scanned = await $.command.run({ command: 'atlas', args: 'scan', origin: { kind: 'composer' } } as any)
    expect(forks).toBe(1)
    expect(scanned.text).toContain('Mapped 3 topics')
    await ui.press({ key: 'tab-trail' })
    text = await drawn(ui)
    for (const word of ['Checklist pane', 'Owner column', 'CI flakiness']) expect(text).toContain(word)
    expect(text).not.toContain('Map earlier conversation')
    await ui.unmount()
  })

  test('shows scan progress while the fork is pending and the result after it finishes', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    on('model.fork', async () => {
      await clock.sleep(2_000)
      return { value: { isAnswered: true, text: MAP_REPLY, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()
    const running = $.command.run({ command: 'atlas', args: 'scan', origin: { kind: 'composer' } } as any)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    expect(await drawn(ui)).toContain('Mapping earlier conversation…')
    await clock.advance(2_000)
    await running
    expect(await drawn(ui)).toContain('Mapped 3 topics, 1 decisions, 1 open questions')
    await ui.unmount()
  })

  test('the title rule names the product and shortens when narrow', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()
    const wide = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    expect(await drawn(wide)).toContain(' Conversation Atlas ')
    await wide.unmount()
    const narrow = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: { ...PANE_PROPS, bodyColumns: 30 } })
    const t = await drawn(narrow)
    expect(t).toContain('" Atlas "')
    expect(t).not.toContain('Conversation Atlas')
    await narrow.unmount()
  })
})

describe('upgrades', () => {
  test('a snapshot kept from an older build gains every newer field before anything reads it', async () => {
    const { recall: _r, adopted: _a, scanned: _s, detectedGoal: _g, ...old } = emptySnapshot('s', ROOT, 0)
    const legacy = { ...old, detourHistory: [{ id: 'x1', reason: 'Old detour', at: 0, turn: 0, topicId: null, departure: { goal: null, topic: null, nextStep: null, checkpointId: null, decisions: [] }, outcomes: [], status: 'returned', endedAt: 1 }] } as any
    const up = upgrade(legacy)
    expect(up.recall).toEqual([])
    expect(up.adopted).toEqual([])
    expect(up.scanned).toBe('none')
    expect(up.detectedGoal).toBeNull()
    expect(up.detourHistory[0]?.exclusions).toEqual([])
    expect(upgrade(up)).toBe(up)
  })
})

function scrollTestView(): AtlasView {
  return {
    setup: false, tab: 'map', refs: {}, nextRef: 1, editingGoal: false, legend: false, popup: null,
    popupScroll: 0, legendScroll: 0, scroll: 0, trailNewest: true, trailView: 'story',
    expanded: null, expandedScroll: 0, fullConfirm: null,
  }
}

function scrollTestContext(el: Ctx['el'], width: number, rows: number, view: AtlasView): Ctx {
  const { Box } = el
  return {
    el, surface: 'terminal', width, rows, now: 1_800_000_000_000, mode: 'claude', setupDefault: 'claude',
    scan: { active: false, startedAt: 0, result: null, resultAt: 0 }, view,
    live: () => <Box />, act: () => undefined,
  }
}

describe('independent surface renderers', () => {
  test('terminal renderer owns its bar label rules', () => {
    expect(tuiCollapseBarLabels([], 20).labels).toEqual([])
  })
})

const scrollPaneProps = (bodyColumns: number, bodyRows: number) => ({
  title: 'Atlas', isFocused: true, bodyColumns, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows }, view: {},
})
const viewKey = { plugin: 'conversation-atlas', key: 'view' } as const
const snapshotKey = { plugin: 'conversation-atlas', key: 'snapshot' } as const

type ScrollFixture = { view: AtlasView & { hidden?: string[]; settingsPage?: number }; snapshot?: AtlasSnapshot }

function scrollWorld(on: On) {
  const base = world(on)
  const fixture: ScrollFixture = { view: scrollTestView() }
  // Override reads at the host-supported state boundary, preserving versions
  // and subscriptions. Atlas remains the only writer of its state.
  on('state.get', viewKey, async (_$, e, next) => {
    const held = await next(e)
    return held.value ? { value: { ...held.value, value: fixture.view } } : held
  })
  on('state.set', viewKey, async (_$, e, next) => {
    fixture.view = e.value
    return next(e)
  })
  on('state.get', snapshotKey, async (_$, e, next) => {
    const held = await next(e)
    return fixture.snapshot && held.value ? { value: { ...held.value, value: fixture.snapshot } } : held
  })
  on('state.set', snapshotKey, async (_$, e, next) => {
    fixture.snapshot = e.value
    return next(e)
  })
  return { ...base, fixture }
}

async function readScrollView(fixture: ScrollFixture): Promise<AtlasView> {
  return fixture.view
}

async function setScrollView(fixture: ScrollFixture, view: AtlasView): Promise<void> {
  fixture.view = view
}

async function setScrollSnapshot(fixture: ScrollFixture, snapshot: AtlasSnapshot): Promise<void> {
  fixture.snapshot = snapshot
}

async function wheel($: Engine, bodyRows: number, by: number): Promise<void> {
  await $.ui.scroll({
    component: 'Pane', requestId: 'atlas', offset: by, by, bodyRows, contentRows: 1_000, origin: { kind: 'person' },
  })
}

// Inspect the requested visual rows, including the clipping and translation
// props. ui.drawn() supplies a tree, so this does not claim native pixel QA.
function wrappedTextRows(value: unknown, width: number): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  const node = value as DrawnNode
  const children = Array.isArray(node.children) ? node.children : []
  if (node.type === 'Box' && node.props?.flexDirection === 'row' &&
      (children[0] as DrawnNode)?.props?.width === 2) {
    const guide = children[0] as DrawnNode
    expect(guide.props?.flexShrink).toBe(0)
    const text = children[1] as DrawnNode
    expect(text.props?.flexGrow).toBe(1)
    expect(text.props?.flexShrink).toBe(1)
    return wrappedTextRows(text, width - 2).map((line, index) => `${index === 0 ? '│ ' : '  '}${line}`)
  }
  if (node.type === 'Text') {
    expect(node.props?.wrap).toBe('wrap')
    return children.map(child => typeof child === 'string' ? child : iconText(child)).join('').split('\n').flatMap(line =>
      Array.from({ length: Math.max(1, Math.ceil(line.length / width)) }, (_, i) => line.slice(i * width, (i + 1) * width)),
    )
  }
  return children.flatMap(child => wrappedTextRows(child, width))
}

function visibleWindow(tree: unknown, bodyKey: string, windowKey: string, width: number): string[] {
  const body = nodeByKey(tree, bodyKey)
  const window = nodeByKey(tree, windowKey)
  expect(body?.props?.overflow).toBe('hidden')
  const offset = -Number(window?.props?.marginTop ?? 0)
  return wrappedTextRows(window, width).slice(offset, offset + Number(body?.props?.height))
}

function childrenOfNode(node: DrawnNode | undefined): DrawnNode[] {
  return Array.isArray(node?.children) ? node.children.filter(child => child && typeof child === 'object') as DrawnNode[] : []
}

describe('expansion hanging indent, spacing and section tones', () => {
  test('row expansions wrap beside the guide and count the drawn height at 46 and 80', async ($, on) => {
    const long = `Review ${'the loader and its retries '.repeat(4)}ENDMARK`
    let snapshot = emptySnapshot('expansion-test', ROOT, 0)
    snapshot = setGoal(snapshot, long, 'person', 1)
    let measured: ReturnType<typeof pane> | undefined
    let open = true
    on('ui.render', { component: 'Pane', requestId: 'expansion-test' }, ($, e) => {
      const view = { ...scrollTestView(), expanded: open ? 'goal' : null }
      measured = pane(scrollTestContext($.ui.resolve(e), e.props.bodyColumns, 100, view), snapshot)
      return measured.tree
    })
    for (const surface of ['terminal'] as const) {
      for (const width of [46, 80]) {
        open = true
        const ui = await $.ui.mount({
          plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'expansion-test',
          props: scrollPaneProps(width, 100),
        })
        const tree = await ui.drawn()
        const expansion = nodeByKey(tree, 'expansion-goal-row')
        expect(expansion).toBeDefined()
        const detail = nodeByKey(tree, 'detail-goal-row-0')
        expect(detail).toBeDefined()
        const lines = wrappedTextRows(detail, width - 2)
        expect(lines.length).toBeGreaterThan(1)
        expect(lines[0]?.startsWith('│ ')).toBe(true)
        for (const line of lines.slice(1)) expect(line.startsWith('  ')).toBe(true)
        expect(lines.join('')).not.toContain('…')
        expect(lines.map(line => line.slice(2)).join('')).toContain('ENDMARK')
        expect(rowsOf(detail, width - 2)).toBe(lines.length)
        // Header, wrapped detail, action row and exactly one trailing empty row.
        const detailLines = buildMap(snapshot, { ...scrollTestView(), mode: 'claude' }, 0).sections[0]?.rows[0]?.detail ?? []
        const drawnDetailHeight = detailLines.reduce((height, _, index) =>
          height + wrappedTextRows(nodeByKey(tree, `detail-goal-row-${index}`), width - 2).length, 0)
        expect(rowsOf(expansion, width)).toBe(1 + drawnDetailHeight + 1 + 1)
        const children = childrenOfNode(expansion)
        expect(children.at(-1)?.props?.key).toBe('expansion-gap-goal-row')
        expect(children.at(-1)?.props?.height).toBe(1)
        expect(children.filter(child => String(child.props?.key ?? '').startsWith('expansion-gap-'))).toHaveLength(1)
        open = false
        await ui.redraw()
        expect(nodeByKey(await ui.drawn(), 'expansion-gap-goal-row')).toBeUndefined()
        expect(measured?.maxExpandedScroll).toBe(0)
        await ui.unmount()
      }
    }
  })

  test('a wrapped Trail detail scrolls to its final row and counts its six-row window', async ($, on) => {
    const snapshot = startTurn(emptySnapshot('event-wrap', ROOT, 0), `Review ${'all loader retries '.repeat(18)}ENDMARK`, 1)
    let width = 46
    let scroll = 0
    let measured: ReturnType<typeof pane> | undefined
    const view = { ...scrollTestView(), tab: 'trail' as const }
    const event = buildTrail(snapshot, { ...view, mode: 'claude' }, 0).sections
      .flatMap(section => section.rows).find(row => row.kind === 'event')
    expect(event).toBeDefined()
    on('ui.render', { component: 'Pane', requestId: 'event-wrap' }, ($, e) => {
      const ctx = scrollTestContext($.ui.resolve(e), width, 100, {
        ...view, expanded: event?.id ?? null, expandedScroll: scroll,
      })
      measured = pane({ ...ctx, now: 0 }, snapshot)
      return measured.tree
    })
    for (const surface of ['terminal'] as const) {
      for (width of [46, 80]) {
        scroll = 0
        const ui = await $.ui.mount({
          plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'event-wrap', props: scrollPaneProps(width, 100),
        })
        const expected = (event?.detail ?? []).flatMap(line => line.split(/\r?\n/).flatMap(text =>
          Array.from({ length: Math.max(1, Math.ceil(text.length / (width - 4))) }, (_, i) =>
            `${i === 0 ? '│ ' : '  '}${text.slice(i * (width - 4), (i + 1) * (width - 4))}`),
        ))
        expect(measured?.maxExpandedScroll).toBe(expected.length - 6)
        scroll = measured?.maxExpandedScroll ?? 0
        await ui.redraw()
        const tree = await ui.drawn()
        const visible = visibleWindow(tree, `expanded-body-${event?.id}`, `expanded-window-${event?.id}`, width - 2)
        expect(visible).toEqual(expected.slice(-6))
        expect(visible.join('')).toContain('ENDMARK')
        expect(visible.join('')).not.toContain('…')
        expect(rowsOf(nodeByKey(tree, `expanded-detail-${event?.id}`), width)).toBe(7)
        expect(rowsOf(nodeByKey(tree, `expansion-${event?.key}`), width)).toBe(10)
        await ui.unmount()
      }
    }
  })

  test('section help ends with one empty row and collapsed help has none', async ($, on) => {
    const { clock, fixture } = scrollWorld(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await clock.settle()
    await setScrollView(fixture, { ...scrollTestView(), tab: 'trail', expanded: 'section:events' })
    const ui = await $.ui.mount({
      plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: scrollPaneProps(48, 40),
    })
    const help = nodeByKey(await ui.drawn(), 'help-events')
    const children = childrenOfNode(help)
    expect(children.at(-1)?.props?.key).toBe('help-gap-events')
    expect(children.at(-1)?.props?.height).toBe(1)
    expect(children.filter(child => child.props?.key === 'help-gap-events')).toHaveLength(1)
    await ui.press({ key: 'events-heading' })
    expect(nodeByKey(await ui.drawn(), 'help-gap-events')).toBeUndefined()
    await ui.unmount()
  })

  test('only the requested section headings gain their specified tones', () => {
    let snapshot = observe(emptySnapshot('heading-test', ROOT, 0), { decisions: ['Keep the API'] }, 1)
    snapshot = touchFile(snapshot, `${ROOT}/loader.ts`, 'write', 2)
    const view = { ...scrollTestView(), mode: 'claude' as const }
    const map = buildMap(snapshot, view, 3)
    expect(map.sections.find(section => section.heading === 'ACTIVITY')?.tone).toBe('path')
    expect(map.sections.find(section => section.heading === 'WORKING SET')?.tone).toBe('write')
    expect(map.sections.find(section => section.heading === 'LATEST')?.tone).toBe('checkpoint')
    expect(buildEvidence(snapshot, view, 3).sections.find(section => section.heading === 'FILES')?.tone).toBe('write')
  })
})

describe('popup and help row scrolling', () => {
  test('Trail Settings header, pager and compact fit stay aligned on both surfaces', async ($, on) => {
    let page = 0
    let width = 46
    on('ui.render', { component: 'Pane', requestId: 'trail-settings-layout' }, ($, e) => {
      const view = { ...scrollTestView(), popupScroll: 0 }
      const ctx = scrollTestContext($.ui.resolve(e), width, 30, view)
      return popupShell({ ...ctx, surface: e.surface }, trailViewPopup('story', true, [], page), { top: 0 })
    })
    for (const requestedWidth of [46, 80]) {
      width = requestedWidth
      for (const surface of ['terminal'] as const) {
        const ui = await $.ui.mount({
          plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'trail-settings-layout',
          props: scrollPaneProps(requestedWidth, 30),
        })
        for (page of [0, 1, 2]) {
          await ui.redraw()
          const tree = await ui.drawn()
          const popup = JSON.stringify(tree)
          expect(popup).toContain(`${page + 1}/3`)
          expect(popup).toContain(['» VIEW', '» ORDER', '» HIDE TYPES'][page])
          expect(nodeByKey(tree, 'trail-settings-page-name')?.props?.dimColor).toBeUndefined()
          expect(popup).toContain('trail-settings-header-gap')
          expect(popup).not.toContain('popup-up')
          expect(popup).not.toContain('popup-down')
          expect(await ui.find({ key: 'popup-close', type: 'Button' })).toBeDefined()
          const shell = nodeByKey(tree, 'atlas-popup')
          expect(shell?.props?.width).toBe(requestedWidth === 46 ? 42 : 64)
        }
        await ui.unmount()
      }
    }
  })

  test('popup windows reach every row of oversized and mixed items on both surfaces', async ($, on) => {
    const width = 38 // A 46-column context has a 42-column popup and 38-column body.
    const tall = Array.from({ length: 12 }, (_, i) => `ROW-${i}`.padEnd(width, '.')).join('') + 'LAST-LINE'
    const cases = [[tall], ['short', tall, 'last item']]
    let texts = cases[0] ?? []
    let at = 0
    on('ui.render', { component: 'Pane', requestId: 'popup-window-test' }, ($, e) => {
      const ctx = scrollTestContext($.ui.resolve(e), 46, 20, { ...scrollTestView(), popupScroll: at })
      const popup: ScreenPopup = {
        kind: 'item', title: 'WINDOW TEST',
        rows: texts.map((text, i) => ({ id: `row-${i}`, key: `row-${i}`, kind: 'text', text })),
      }
      return popupShell({ ...ctx, surface: e.surface }, popup, { top: 0 })
    })
    for (const surface of ['terminal'] as const) {
      const ui = await $.ui.mount({
        plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'popup-window-test', props: scrollPaneProps(48, 20),
      })
      for (const sample of cases) {
        texts = sample
        const expected = sample.flatMap(text =>
          Array.from({ length: Math.ceil(text.length / width) }, (_, i) => text.slice(i * width, (i + 1) * width)),
        )
        const max = expected.length - 4
        for (at = 0; at <= max + 1; at++) {
          await ui.redraw()
          const tree = await ui.drawn()
          expect(visibleWindow(tree, 'popup-body', 'popup-window', width)).toEqual(expected.slice(Math.min(at, max), Math.min(at, max) + 4))
          const topItem = sample.length === 1 || at === 0 ? 1 : 2
          expect(JSON.stringify(nodeByKey(tree, 'atlas-popup'))).toContain(`${topItem}/${sample.length}`)
        }
        expect(visibleWindow(await ui.drawn(), 'popup-body', 'popup-window', width).at(-1)).toBe(expected.at(-1))
        expect((await ui.find({ key: 'popup-down' }))?.props.dimColor).toBe(true)
      }
      await ui.unmount()
    }
  })

  test('popup buttons advance one row and stop with the final line visible', async ($, on) => {
    const { clock, fixture } = scrollWorld(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    const question = `Can we reach ${'every word '.repeat(45)}LAST-WORD?`
    const snapshot = observe(emptySnapshot('atlas-test-session', ROOT, 0), { topic: 'Scroll', questions: [question] }, 1)
    await setScrollSnapshot(fixture, snapshot)
    await clock.settle()
    await setScrollView(fixture, { ...scrollTestView(), tab: 'open', popup: { kind: 'item', id: snapshot.questions[0]?.id } })
    const ui = await $.ui.mount({
      plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: scrollPaneProps(48, 30),
    })
    await ui.press({ key: 'popup-down' })
    expect((await readScrollView(fixture)).popupScroll).toBe(1)
    expect((await readScrollView(fixture)).scroll).toBe(0)
    // End via wheel, then exercise both button clamps at the end.
    await wheel($, 30, 1_000)
    const end = (await readScrollView(fixture)).popupScroll
    expect(end).toBeGreaterThan(5)
    const tree = await ui.drawn()
    const last = visibleWindow(tree, 'popup-body', 'popup-window', 38).at(-1)
    expect(last).toBe('topic: Scroll')
    await ui.press({ key: 'popup-down' })
    expect((await readScrollView(fixture)).popupScroll).toBe(end)
    await ui.press({ key: 'popup-up' })
    expect((await readScrollView(fixture)).popupScroll).toBe(end - 1)
    await ui.unmount()
  })

  test('section help at width 46 reaches all wrapped words through expanded-scroll', async ($, on) => {
    const { clock, fixture } = scrollWorld(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await clock.settle()
    for (const surface of ['terminal'] as const) {
      await setScrollView(fixture, { ...scrollTestView(), tab: 'trail' })
      const ui = await $.ui.mount({
        plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'atlas', props: scrollPaneProps(48, 40),
      })
      await ui.press({ key: 'events-heading' })
      const snapshot = emptySnapshot('atlas-test-session', ROOT, 0)
      const help = buildTrail(snapshot, { ...scrollTestView(), mode: 'claude' }, 0).sections.find(s => s.key === 'events')?.help
      const width = 44 // 46 columns less the help's two-column indent; this empty Trail has no scrollbar.
      const expected = (help ?? []).flatMap(text => {
        return text.split('\n').flatMap(line =>
          Array.from({ length: Math.max(1, Math.ceil(line.length / (width - 2))) }, (_, i) =>
            `${i === 0 ? '│ ' : '  '}${line.slice(i * (width - 2), (i + 1) * (width - 2))}`),
        )
      })
      expect(expected[0]).not.toContain('checkpoints.')
      const reached = new Set<string>()
      let end = 0
      for (let step = 0; step <= expected.length; step++) {
        const tree = await ui.drawn()
        const visible = visibleWindow(tree, 'help-body-events', 'help-window-events', width)
        visible.forEach(line => reached.add(line))
        expect(visible.join('')).not.toContain('…')
        expect(visible).toEqual(expected.slice(step, step + 5))
        end = (await readScrollView(fixture)).expandedScroll
        const down = await ui.find({ key: 'help-down-events' })
        if (down?.props.dimColor) break
        await ui.press({ key: 'help-down-events' })
        expect((await readScrollView(fixture)).expandedScroll).toBe(end + 1)
      }
      expect([...reached]).toEqual([...new Set(expected)])
      expect(end).toBe(expected.length - 5)
      await ui.press({ key: 'help-down-events' })
      expect((await readScrollView(fixture)).expandedScroll).toBe(end)
      await ui.unmount()
    }
  })

  test('Trail Settings owns wheel gestures even when the body can scroll', async ($, on) => {
    const { clock, fixture } = scrollWorld(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    const now = 1_800_000_000_000
    let snapshot = observe(emptySnapshot('atlas-test-session', ROOT, now), { topic: 'Trail' }, now)
    for (let i = 0; i < 12; i++) snapshot = startTurn(snapshot, `Review item ${i}.`, now + i + 1)
    await setScrollSnapshot(fixture, snapshot)
    await clock.settle()
    await setScrollView(fixture, { ...scrollTestView(), tab: 'trail', scroll: 2 })
    const ui = await $.ui.mount({
      plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: scrollPaneProps(48, 20),
    })
    expect(await ui.find({ key: 'scroll-down' })).toBeDefined()
    await ui.press({ key: 'trail-view-menu' })
    const before = await readScrollView(fixture)
    await wheel($, 20, 1)
    const after = await readScrollView(fixture) as AtlasView & { settingsPage: number }
    expect(after.settingsPage).toBe(1)
    expect(after.popupScroll).toBe(0)
    expect(after.scroll).toBe(before.scroll)
    await wheel($, 20, -1)
    expect((await readScrollView(fixture) as AtlasView & { settingsPage: number }).settingsPage).toBe(0)
    await wheel($, 20, -100)
    expect((await readScrollView(fixture) as AtlasView & { settingsPage: number }).settingsPage).toBe(0)
    await wheel($, 20, 1)
    await wheel($, 20, 1)
    expect((await readScrollView(fixture) as AtlasView & { settingsPage: number }).settingsPage).toBe(2)
    await wheel($, 20, 1)
    expect((await readScrollView(fixture) as AtlasView & { settingsPage: number }).settingsPage).toBe(2)
    await ui.unmount()
  })
})

describe('scroll bounds belong to the rendering surface', () => {
  test('buttons and wheel use surface bounds in either render order, with ambiguous wheel fallback', async ($, on) => {
    const { clock, fixture } = scrollWorld(on)
    const measured = new Map<string, ReturnType<typeof pane>>()
    let measuringView = scrollTestView()
    let snapshot = emptySnapshot('atlas-test-session', ROOT, 0)
    // Measure independently with the pure renderer; the assertions below
    // exercise dispatch and wheel surface selection, not renderer arithmetic.
    on('ui.render', { component: 'Pane', requestId: 'measure-scroll-bounds' }, ($, e) => {
      const view = measuringView
      const ctx = scrollTestContext($.ui.resolve(e), Math.max(20, e.props.bodyColumns - 2), e.props.scroll.bodyRows, view)
      const drawn = pane({ ...ctx, surface: e.surface }, snapshot)
      measured.set(e.surface, drawn)
      return drawn.tree
    })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    snapshot = observe(snapshot, {
      topic: 'Bounds', questions: Array.from({ length: 12 }, (_, i) => `${String.fromCharCode(65 + i).repeat(450)} end?`),
    }, 1)
    for (let i = 0; i < 8; i++) snapshot = touchFile(snapshot, `${ROOT}/file-${i}.ts`, 'read', i + 2)
    await setScrollSnapshot(fixture, snapshot)
    await clock.settle()
    const terminalProps = scrollPaneProps(48, 12)
    const terminal = await $.ui.mount({
      plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: terminalProps,
    })
    const measureTerminal = await $.ui.mount({
      plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'measure-scroll-bounds', props: terminalProps,
    })
    const scenarios = [
      { view: { ...scrollTestView(), tab: 'open' as const }, field: 'scroll', bound: 'maxScroll', down: 'scroll-down', up: 'scroll-up' },
      {
        view: { ...scrollTestView(), tab: 'open' as const, popup: { kind: 'item' as const, id: snapshot.questions[0]?.id } },
        field: 'popupScroll', bound: 'maxPopupScroll', down: 'popup-down', up: 'popup-up',
      },
      {
        view: { ...scrollTestView(), tab: 'trail' as const, expanded: 'section:events' },
        field: 'expandedScroll', bound: 'maxExpandedScroll', down: 'help-down-events', up: 'help-up-events',
      },
      { view: { ...scrollTestView(), legend: true }, field: 'legendScroll', bound: 'maxLegendScroll', down: 'scroll-down', up: 'scroll-up' },
    ] as const
    for (const scenario of scenarios) {
      measuringView = scenario.view
      await setScrollView(fixture, scenario.view)
      await terminal.redraw()
      await measureTerminal.redraw()
      const terminalMax = measured.get('terminal')?.[scenario.bound] ?? 0
      expect(terminalMax, scenario.field).toBeGreaterThan(0)
      for (const order of [[terminal], [terminal]] as const) {
        await order[0]?.redraw()
        for (const [ui, max, bodyRows] of [[terminal, terminalMax, 12]] as const) {
          // A clipped Legend owns the wheel; it has no separate paging buttons.
          if (scenario.field !== 'legendScroll') {
            await setScrollView(fixture, { ...scenario.view, [scenario.field]: max - 1 })
            await ui.press({ key: scenario.down })
            expect((await readScrollView(fixture))[scenario.field]).toBe(max)
            await ui.press({ key: scenario.down })
            expect((await readScrollView(fixture))[scenario.field]).toBe(max)
          }
          await setScrollView(fixture, { ...scenario.view, [scenario.field]: 0 })
          if (scenario.field !== 'legendScroll') await ui.press({ key: scenario.up })
          await wheel($, bodyRows, -1_000)
          expect((await readScrollView(fixture))[scenario.field]).toBe(0)
          await wheel($, bodyRows, 1_000)
          expect((await readScrollView(fixture))[scenario.field]).toBe(max)
        }
      }
      await setScrollView(fixture, scenario.view)
      await wheel($, 99, 1_000) // No matching surface: use the largest bound.
      expect((await readScrollView(fixture))[scenario.field]).toBe(terminalMax)
    }
    measuringView = { ...scrollTestView(), tab: 'open' }
    await setScrollView(fixture, measuringView)
    await terminal.redraw()
    await measureTerminal.redraw()
    const terminalMax = measured.get('terminal')?.maxScroll ?? 0
    for (const [ui, max] of [[terminal, terminalMax]] as const) {
      const cells = (await ui.findAll({ type: 'Button' })).filter(cell => cell.key?.startsWith('sb-'))
      await ui.press({ key: String(cells.at(-1)?.key) })
      expect((await readScrollView(fixture)).scroll).toBe(max)
    }
    await terminal.unmount()
    await measureTerminal.unmount()
  })
})

describe('pane interactions: sort, scrollbar, expand, footer', () => {
  const mountPane = ($: any, props: any = PANE_PROPS) => $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props })

  test('Trail Settings pages through view and order controls', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Alpha topic' } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Omega topic', shift: 'sibling' } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-trail' })
    await ui.press({ key: 'trail-view-menu' })
    expect(await drawn(ui)).toContain('TRAIL SETTINGS')
    expect(await drawn(ui)).toContain('1/3')
    expect(await drawn(ui)).toContain('» VIEW')
    expect(await drawn(ui)).toContain('[x] Story · grouped by turn')
    expect(String((await ui.find({ key: 'trail-view-menu', type: 'Button' }))?.props.label).trim()).toBe('≡')
    expect(await ui.find({ key: 'trail-view-log', type: 'Button' })).toBeDefined()
    expect(await ui.find({ key: 'trail-sort', type: 'Button' })).toBeUndefined()
    await ui.press({ key: 'trail-view-log' })
    expect(await drawn(ui)).toContain('TRAIL SETTINGS')
    expect(await drawn(ui)).toContain('[x] Log · one event per line')
    expect(await drawn(ui)).toContain('[ ] Story · grouped by turn')
    const events = async () => {
      const t = await drawn(ui)
      const heading = await ui.find({ type: 'Text', text: /TRAIL ·/ })
      return `${heading?.text ?? ''} ${t.slice(t.indexOf('"events-heading"'))}`
    }
    let t = await events()
    expect(t).toContain('TRAIL · Log')
    await ui.press({ key: 'popup-close' })
    await ui.press({ key: 'trail-view-menu' })
    let popup = await drawn(ui)
    expect(popup).toContain('1/3')
    expect(popup).toContain('» VIEW')
    expect(popup).not.toContain('popup-up')
    expect(popup).not.toContain('popup-down')
    expect(popup).toContain('trail-settings-header-gap')
    await ui.press({ key: 'settings-page-next' })
    popup = await drawn(ui)
    expect(popup).toContain('2/3')
    expect(popup).toContain('» ORDER')
    expect(await ui.find({ key: 'trail-sort', type: 'Button' })).toBeDefined()
    expect(String((await ui.find({ key: 'trail-sort', type: 'Button' }))?.props.label)).toContain('▼ Event time')
    await ui.press({ key: 'trail-sort' })
    expect(await drawn(ui)).toContain('TRAIL SETTINGS')
    expect(await drawn(ui)).toContain('▲ Event time')
    t = await events()
    expect(t).not.toContain('newest first')
    expect(t.indexOf('Alpha topic')).toBeLessThan(t.indexOf('Omega topic'))
    await ui.press({ key: 'popup-close' })
    await ui.press({ key: 'trail-view-menu' })
    await ui.press({ key: 'settings-page-next' })
    await ui.press({ key: 'trail-sort' })
    t = await events()
    expect(t).toContain('TRAIL · Log')
    expect(t).not.toContain('oldest first')
    expect(t.indexOf('Omega topic')).toBeLessThan(t.indexOf('Alpha topic'))
    await ui.press({ key: 'bar-legend' })
    expect(await drawn(ui)).toContain('↑ = newest first; ↓ = oldest first.')
    await ui.unmount()
  })

  test('Trail Settings pages clamp and hide toggles stay open without changing intent', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock, fixture } = scrollWorld(on)
    const runAtlas = (args: string) => $.command.run({
      command: 'atlas', args, origin: { kind: 'composer' },
    } as Parameters<typeof $.command.run>[0])
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await runAtlas('goal Keep intent')
    await runAtlas('next Preserve next')
    const before = fixture.snapshot
    await runAtlas('hide h')
    const listed = await runAtlas('filters')
    expect(listed.text).toContain('h (hand-offs)')
    const rejected = await runAtlas('hide x')
    expect(rejected.text).toContain('b (report-backs), h (hand-offs)')
    await runAtlas('show h')
    expect((await runAtlas('filters')).text).toBe('no filters')
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    let popup = ''
    await ui.press({ key: 'tab-trail' })
    await ui.press({ key: 'trail-view-menu' })
    await ui.press({ key: 'settings-page-prev' })
    expect(await drawn(ui)).toContain('1/3')
    await ui.press({ key: 'settings-page-next' })
    await ui.press({ key: 'settings-page-next' })
    await ui.press({ key: 'settings-page-next' })
    popup = await drawn(ui)
    expect(popup).toContain('3/3')
    expect(popup).toContain('» HIDE TYPES')
    expect(popup).toContain('[ ] Report-backs')
    expect(popup).toContain('shown')
    expect(popup).not.toContain('popup-up')
    expect(popup).not.toContain('popup-down')
    await ui.press({ key: 'settings-page-prev' })
    expect(await drawn(ui)).toContain('2/3')
    await ui.press({ key: 'settings-page-next' })
    expect(await drawn(ui)).toContain('3/3')
    expect(await ui.find({ key: 'trail-filter-b-toggle', type: 'Button' })).toBeDefined()
    await ui.press({ key: 'trail-filter-b-toggle' })
    expect(await drawn(ui)).toContain('TRAIL SETTINGS')
    expect(await drawn(ui)).toContain('hidden')
    await ui.press({ key: 'trail-filter-b-toggle' })
    expect(await drawn(ui)).toContain('shown')
    await ui.press({ key: 'trail-filter-b-toggle' })
    const closed = await ui.find({ key: 'popup-close', type: 'Button' })
    expect(String(closed?.props.label).trim()).toBe('✕')
    expect(await drawn(ui)).not.toContain('⚙')
    expect(await drawn(ui)).not.toContain('\uFE0F')
    await ui.press({ key: 'popup-close' })
    expect(await drawn(ui)).not.toContain('TRAIL SETTINGS')
    expect(fixture.view.hidden).toContain('b')
    const snapshot = fixture.snapshot as AtlasSnapshot
    expect(snapshot.goal).toEqual(before?.goal)
    expect(snapshot.nextStep).toEqual(before?.nextStep)
    expect(snapshot.detour).toEqual(before?.detour)
    expect(snapshot.checkpoints.filter(item => item.kind === 'marked')).toEqual(before?.checkpoints.filter(item => item.kind === 'marked'))
    expect(snapshot.goal?.text).toBe('Keep intent')
    expect(snapshot.nextStep).toBe('Preserve next')
    await clock.settle()
    await ui.unmount()
  })

  test('hide and show report-backs filter Trail rows while counts and snapshot remain intact', { timeoutMs: 20_000 }, async ($, on) => {
    const now = 1_800_000_000_000
    const { clock, fixture } = scrollWorld(on)
    const runAtlas = (args: string) => $.command.run({
      command: 'atlas', args, origin: { kind: 'composer' },
    } as Parameters<typeof $.command.run>[0])
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    const prompt = startTurn(emptySnapshot('filter-test', ROOT, now), 'Review the build.', now + 1)
    const original = reportHandoff(prompt, 'Build done', now + 2, 'Codex')
    await setScrollSnapshot(fixture, original)
    await setScrollView(fixture, { ...scrollTestView(), tab: 'trail', trailView: 'log' })
    const hiddenView = {
      ...scrollTestView(), mode: 'claude' as const, tab: 'trail' as const, trailView: 'log' as const, hidden: ['b'],
    }
    const filtered = buildTrail(original, hiddenView, now + 2)
    const events = filtered.sections.find(section => section.key === 'events')
    expect(events?.rows.map(row => row.text)).toEqual(['Review the build.'])
    expect(events?.count).toBe('1 hidden')
    expect(original.events.some(event => event.kind === 'report-back')).toBe(true)
    expect(original.handoffs).toEqual([])
    const visible = buildTrail(original, { ...hiddenView, hidden: [] }, now + 2)
    expect(new Set(visible.sections.find(section => section.key === 'events')?.rows.map(row => row.text))).toEqual(
      new Set(['Review the build.', 'Build done']),
    )
    const story = buildTrail(original, { ...hiddenView, trailView: 'story' }, now + 2)
    const summary = story.sections.find(section => section.key === 'events')?.rows[0]
    expect(summary?.metaParts?.some(part => part.text === '1b')).toBe(true)
    await runAtlas('hide b')
    expect(fixture.view.hidden).toContain('b')
    await runAtlas('show b')
    expect(fixture.view.hidden).not.toContain('b')
    const after = fixture.snapshot as AtlasSnapshot
    expect(after.goal).toEqual(original.goal)
    expect(after.detour).toEqual(original.detour)
    expect(after.nextStep).toEqual(original.nextStep)
    expect(after.checkpoints.filter(item => item.kind === 'marked')).toEqual(original.checkpoints.filter(item => item.kind === 'marked'))
    await clock.settle()
  })

  test('a scrollbar appears when the body overflows and its cells jump the scroll', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    for (let i = 0; i < 8; i++) await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/file${i}.ts` } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Scrolling', questions: ['Does it scroll?'], next: 'Check the bar' } as any)
    await clock.settle()
    const ui = await mountPane($, { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 14 } })
    expect(await ui.find({ key: 'sb-0' })).toBeDefined()
    expect(await drawn(ui)).not.toMatch(/"marginTop":-\d+/)
    await ui.press({ key: 'sb-9' })
    expect(await drawn(ui)).toMatch(/"marginTop":-\d+/)
    await ui.unmount()
  })

  test('Chat ⇒ puts a chip in the draft; only a chip left in the text sends the full item', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock, seen } = world(on)
    const fills: string[] = []
    on('prompt.fill', (_$: any, e: any) => {
      fills.push(e.text)
      return { isFilled: true }
    })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    const long = `We keep the pane native ${'and boring '.repeat(10)}ENDMARK`
    await $.command.run({ command: 'atlas', args: `decision ${long}`, origin: { kind: 'composer' } } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-evidence' })
    await ui.press({ key: (await drawn(ui)).match(/"key":"(dsel-[^"]+)"/)?.[1] ?? '' })
    const add = (await drawn(ui)).match(/"key":"(add-[^"]+)"/)?.[1]
    expect(add).toBeDefined()
    await ui.press({ key: add ?? '' })
    await clock.settle()
    expect(fills).toHaveLength(1)
    expect(fills[0]).toContain('[Atlas #1:')
    expect(seen.toasts.join('|')).toContain('Added to your message as Atlas #1')

    const withChip = await $.prompt.submit({ text: 'see [Atlas #1: decision "x"] please', wait: false, origin: { kind: 'composer' } } as any)
    expect(JSON.stringify(withChip)).toContain('ENDMARK')
    expect(JSON.stringify(withChip)).toContain('attached deliberately by the user')
    const without = await $.prompt.submit({ text: 'see it please', wait: false, origin: { kind: 'composer' } } as any)
    expect(JSON.stringify(without)).not.toContain('ENDMARK')
    await ui.unmount()
  })

  test('a refused fill is reported, not silent', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock, seen } = world(on)
    on('prompt.fill', () => ({ isFilled: false, refusal: 'dialog' as const }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.command.run({ command: 'atlas', args: `decision Short one ${'x'.repeat(80)}`, origin: { kind: 'composer' } } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-evidence' })
    await ui.press({ key: (await drawn(ui)).match(/"key":"(dsel-[^"]+)"/)?.[1] ?? '' })
    await ui.press({ key: (await drawn(ui)).match(/"key":"(add-[^"]+)"/)?.[1] ?? '' })
    await clock.settle()
    expect(seen.toasts.join('|')).toContain('could not add to the message')
    await ui.unmount()
  })

  test('clicking a Trail event expands its full text inline with actions', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    on('turn.start', () => ({ turnId: 'turn-1' }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.turn.start({ turnId: 'turn-1', text: 'Refactor the loader.\n- keep the API stable\n- add retries with backoff' } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-trail' })
    let t = await drawn(ui)
    expect(t).not.toContain('add retries with backoff')
    const btn = t.match(/"key":"(evb-[^"]+)"/)?.[1]
    expect(btn).toBeDefined()
    await ui.press({ key: btn ?? '' })
    t = await drawn(ui)
    expect(await ui.find({ key: 'atlas-popup' })).toBeUndefined()
    const expanded = await ui.find({ key: `expanded-detail-${btn?.slice(4)}` })
    expect(expanded?.props.position).toBeUndefined()
    expect(Number(expanded?.props.marginLeft)).toBe(2)
    expect(t).toContain('› Refactor the loader.')
    expect(t).toContain('turn: 1')
    expect(t).toContain('when: now')
    expect(t).toContain('Refactor the loader.')
    expect(t).toContain('add retries with backoff')
    expect(t).toContain('"key":"add-evb-')
    const close = t.match(/"key":"(close-evb-[^"]+)"/)?.[1]
    expect(close).toBeDefined()
    await ui.press({ key: close ?? '' })
    expect(await drawn(ui)).not.toContain('expanded-detail-story-1')
    await ui.unmount()
  })

  test('a long Trail expansion shows six lines and scrolls its own detail', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    on('turn.start', () => ({ turnId: 'popup-scroll' }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.turn.start({ turnId: 'popup-scroll', text: `Refactor the loader.\n${Array.from({ length: 15 }, (_, i) => `- point ${i}`).join('\n')}` } as any)
    await clock.settle()
    const ui = await mountPane($, { ...PANE_PROPS, bodyColumns: 72 })
    await ui.press({ key: 'tab-trail' })
    const event = (await ui.findAll({ type: 'Button' })).find((button: any) => String(button.props.key ?? '').startsWith('evb-'))
    expect(event).toBeDefined()
    await ui.press({ key: String(event?.props.key ?? '') })
    const before = await drawn(ui)
    expect(before).toContain('"key":"expanded-down"')
    expect(before).toContain('"key":"expanded-up"')
    expect(before).toContain('› Refactor the loader.')
    await ui.press({ key: 'expanded-down' })
    const after = await drawn(ui)
    expect(after).not.toContain('kind: prompt')
    expect(after).toContain('- point 2')
    await ui.unmount()
  })

  test('a Trail event expansion stays in normal flow under the clicked row', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId ?? 'anchor' }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.turn.start({ turnId: 'anchor', text: 'First prompt.' } as any)
    await $.turn.start({ turnId: 'anchor-2', text: 'Second prompt.' } as any)
    await $.turn.start({ turnId: 'anchor-3', text: 'Third prompt.' } as any)
    await clock.settle()
    const ui = await mountPane($, { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 30 } })
    await ui.press({ key: 'tab-trail' })
    const events = (await ui.findAll({ type: 'Button' })).filter((button: any) => String(button.props.key ?? '').startsWith('evb-'))
    expect(events.length).toBeGreaterThanOrEqual(3)
    await ui.press({ key: String(events.at(-1)?.props.key ?? '') })
    expect(await ui.find({ key: 'atlas-popup' })).toBeUndefined()
    const tree = await drawn(ui)
    expect(tree).toContain('"key":"expanded-detail-')
    expect(tree).not.toContain('"key":"atlas-popup"')
    await ui.unmount()
  })

  test('clicking a long item shows it in full and Close collapses', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    const long = `We will keep the pane native ${'and boring '.repeat(10)}ENDMARK`
    await $.command.run({ command: 'atlas', args: `decision ${long}`, origin: { kind: 'composer' } } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-evidence' })
    expect(await drawn(ui)).not.toContain('"key":"add-')
    const sel = (await drawn(ui)).match(/"key":"(dsel-[^"]+)"/)?.[1]
    expect(sel).toBeDefined()
    await ui.press({ key: sel ?? '' })
    expect(await drawn(ui)).toContain('ENDMARK')
    const after = await drawn(ui)
    expect(after).toContain('Chat ⇒')
    expect(after).not.toContain('Send to Claude')
    const close = (after.match(/"key":"(close-[^"]+)"/)?.[1]) ?? ''
    await ui.press({ key: close })
    expect(await drawn(ui)).not.toContain('Chat ⇒')
    await ui.unmount()
  })

  test('goal expansion shows a differing detected goal and adopts it only when pressed', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, goal: 'Build the original pane' } as any)
    await clock.settle()
    const ui = await mountPane($)
    const suggestion = (await drawn(ui)).match(/"key":"(ok-s\d+)"/)?.[1]
    expect(suggestion).toBeDefined()
    await ui.press({ key: suggestion ?? '' })
    await $.tool.call({ tool: OBSERVE, goal: 'Polish the popup UI' } as any)
    await clock.settle()
    await ui.press({ key: 'goal-row' })
    const expanded = await drawn(ui)
    expect(expanded).toContain('Atlas currently reads your aim as: Polish the popup UI')
    expect(expanded).toContain('Use this as my goal')
    await ui.press({ key: 'use-detected-goal' })
    expect(await drawn(ui)).toContain('Polish the popup UI')
    await ui.unmount()
  })

  test('the footer button says what it is and opens Atlas', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock, seen } = world(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as any)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Footer work', decisions: ['Do the footer'] } as any)
    await clock.settle()
    const before = seen.opens.length
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'SessionMode', props: { modes: [] } } as any)
    const t = await drawn(ui)
    expect(t).toContain('"label":"Atlas: Footer work')
    await ui.press({ key: 'atlas-open' })
    await clock.settle()
    expect(seen.opens.length).toBeGreaterThan(before)
    await ui.unmount()
  })
})


function rowText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const node = value as DrawnNode
  if (typeof node.props?.label === 'string') return node.props.label
  const gap = node.props?.flexDirection === 'row' ? ' '.repeat(Number(node.props?.gap) || 0) : ''
  return (Array.isArray(node.children) ? node.children : []).map(rowText).join(gap)
}

describe('b4 row anatomy', () => {
  test('gutter, Story counts and single Trail icons draw on both surfaces at 46 and 80', async ($, on) => {
    const now = 1_800_000_000_000
    let snapshot = startTurn(emptySnapshot('b4', ROOT, now - 120_000), 'Review the row layout.', now - 110_000)
    snapshot = observe(snapshot, { topic: 'Row layout', decisions: ['Reserve a blank cell', 'Color each count by its kind'] }, now - 100_000)
    for (let i = 0; i < 2; i++) snapshot = touchFile(snapshot, `${ROOT}/${'long-name-'.repeat(10)}.ts`, 'write', now - 90_000)
    for (let i = 0; i < 3; i++) snapshot = touchFile(snapshot, `${ROOT}/${'long-name-'.repeat(10)}.ts`, 'read', now - 80_000)
    snapshot = addCheckpoint(snapshot, 'Milestone for Claude', 'claude', null, now - 60_000)
    let tab: AtlasView['tab'] = 'map'
    let log = false
    on('ui.render', { component: 'Pane', requestId: 'b4-rows' }, ($, e) => {
      const view = { ...scrollTestView(), tab, trailView: log ? 'log' as const : 'story' as const,
        expanded: tab === 'trail' && !log ? 'story-1' : null }
      const ctx = { ...scrollTestContext($.ui.resolve(e), e.props.bodyColumns, 100, view), now, surface: e.surface }
      return pane(ctx, snapshot).tree
    })
    const story = buildTrail(snapshot, { ...scrollTestView(), tab: 'trail', mode: 'claude' }, now)
      .sections.find(section => section.key === 'events')?.rows[0]
    expect(story?.meta).toBeUndefined()
    expect(story?.right).toBe('1m')
    expect(story?.metaParts?.map(part => [part.text, part.tone])).toEqual([
      ['2e', 'write'], ['3r', 'read'], ['1t', 'path'], ['2d', 'decision'],
    ])
    expect(story?.detail?.[2]).toBe('counts: 2 edits · 3 reads · 1 topic · 2 decisions')
    for (const surface of ['terminal'] as const) {
      for (const width of [46, 80]) {
        tab = 'map'
        log = false
        const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'b4-rows',
          props: scrollPaneProps(width, 100) })
        let tree = await ui.drawn()
        const file = buildMap(snapshot, { ...scrollTestView(), mode: 'claude' }, now)
          .sections.flatMap(section => section.rows).find(row => row.kind === 'file')
        const head = nodeByKey(tree, `head-${file?.key}`)
        const line = rowText(head)
        expect(line).toContain('… ')
        expect(line).toMatch(/… .*1m$/)
        expect(cellWidth(line)).toBeLessThanOrEqual(width)
        tab = 'trail'
        await ui.redraw()
        tree = await ui.drawn()
        const storyHead = nodeByKey(tree, 'head-evb-story-1')
        expect(rowText(storyHead)).toContain('2e 3r 1t 2d 1m')
        expect(rowText(storyHead)).not.toContain('turn 1')
        expect(rowText(storyHead).startsWith('› ')).toBe(true)
        const encoded = JSON.stringify(storyHead)
        for (const color of [C.write, C.read, C.path, C.decision]) expect(encoded).toContain(color)
        const eventLine = story?.detail?.findIndex(line => line.startsWith('✻ ')) ?? -1
        const detail = nodeByKey(tree, `expanded-line-story-1-${eventLine}`)
        expect(rowText(detail)).toMatch(/^│ ✻ /)
        expect(JSON.stringify(detail)).toContain('#d97757')
        log = true
        await ui.redraw()
        tree = await ui.drawn()
        const checkpoint = snapshot.events.find(event => event.kind === 'checkpoint')
        const checkpointHead = rowText(nodeByKey(tree, `head-evb-${checkpoint?.id}`))
        expect(checkpointHead.startsWith('⚑ ')).toBe(true)
        expect(checkpointHead).not.toContain('✻')
        expect(checkpointHead).not.toMatch(/^C /)
        expect(checkpointHead.match(/⚑/g)?.length).toBe(1)
        expect(JSON.stringify(tree)).not.toContain('\uFE0F')
        await ui.unmount()
      }
    }
  })
})


function iconFixture(): AtlasSnapshot {
  const snapshot = sampleSnapshot()
  const kinds: AtlasEvent['kind'][] = [
    'prompt', 'topic', 'goal', 'detour', 'return', 'promote', 'decision', 'question', 'resolved',
    'checkpoint', 'next', 'resume', 'dismiss', 'handoff', 'report-back',
  ]
  snapshot.events = kinds.map((kind, index) => ({
    id: `icon-${kind}`, kind, text: `Fixture ${kind}`, turn: index + 10, at: SAMPLE_NOW - index,
  }))
  snapshot.activity = ['running', 'done', 'failed'].map((state, index) => ({
    id: `icon-activity-${state}`, kind: 'test', label: state, state: state as 'running' | 'done' | 'failed',
    at: SAMPLE_NOW - index, endedAt: state === 'running' ? null : SAMPLE_NOW, agent: null,
  }))
  snapshot.files = ['read', 'write'].map((op, index) => ({
    path: `fixture-${op}.ts`, reads: 1, writes: index, lastOp: op as 'read' | 'write', at: SAMPLE_NOW, turn: 1,
  }))
  return snapshot
}

function iconNodes(value: unknown): DrawnNode[] {
  if (!value || typeof value !== 'object') return []
  const node = value as DrawnNode
  return [node, ...childrenOfNode(node).flatMap(iconNodes)]
}

function iconText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (!value || typeof value !== 'object') return ''
  const node = value as DrawnNode
  const children = Array.isArray(node.children) ? node.children : []
  return children.map(iconText).join('')
}

describe('b5: icon colors, source marks and complete Legend', () => {
  test('Legend keys match every tab row across the sample and all event, file and activity kinds', () => {
    const used = new Set<GlyphKey>()
    for (const snapshot of [sampleSnapshot(), iconFixture()]) {
      for (const build of [buildMap, buildTrail, buildOpen, buildEvidence]) {
        for (const trailView of ['story', 'log'] as const) {
          const model = build(snapshot, { ...scrollTestView(), mode: 'claude', trailView }, SAMPLE_NOW)
          for (const row of model.sections.flatMap(section => section.rows)) {
            if (row.glyph) used.add(row.glyph)
            if (row.fresh) used.add('fresh')
          }
        }
      }
    }
    const listed = new Set(LEGEND.map(([key]) => key))
    expect([...used].filter(key => !listed.has(key))).toEqual([])
    expect([...listed].filter(key => !used.has(key))).toEqual([])
  })

  test('dim row icons retain glyph color without dim or italic on both surfaces', async ($, on) => {
    const snapshot = sampleSnapshot()
    const view = scrollTestView()
    on('ui.render', { component: 'Pane', requestId: 'icon-color' }, ($, e) => {
      const ctx = scrollTestContext($.ui.resolve(e), e.props.bodyColumns, 100, view)
      return pane({ ...ctx, surface: e.surface }, snapshot).tree
    })
    for (const surface of ['terminal'] as const) {
      const ui = await $.ui.mount({
        plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'icon-color', props: scrollPaneProps(80, 100),
      })
      const tree = await ui.drawn()
      const row = nodeByKey(tree, 'head-activity-activity-done')
      expect(row).toBeDefined()
      const icon = iconNodes(row).find(node => node.type === 'Text' && iconText(node) === '✓ ')
      expect(icon?.props?.color).toBe(GLYPH.ok.color)
      expect(icon?.props?.dimColor).not.toBe(true)
      expect(icon?.props?.italic).not.toBe(true)
      expect(iconNodes(row).some(node => node.props?.dimColor === true)).toBe(true)
      await ui.unmount()
    }
  })

  test('expansion marks omit engine prefixes and color Claude and Codex on both Trail layouts', async ($, on) => {
    const snapshot = iconFixture()
    snapshot.checkpoints = [{
      id: 'icon-checkpoint', kind: 'claude', name: 'Fixture checkpoint', turn: 19, at: SAMPLE_NOW,
      goal: null, topic: null, files: [], detail: null,
    }]
    let view = { ...scrollTestView(), tab: 'trail' as const }
    on('ui.render', { component: 'Pane', requestId: 'icon-marks' }, ($, e) => {
      const ctx = scrollTestContext($.ui.resolve(e), 80, 100, view)
      return pane({ ...ctx, surface: e.surface }, snapshot).tree
    })
    for (const surface of ['terminal'] as const) {
      for (const trailView of ['story', 'log'] as const) {
        for (const [kind, mark, color] of [
          ['topic', '', ''], ['checkpoint', '✻', '#d97757'],
          ['handoff', '⌬', '#7c8cff'], ['report-back', '⌬', '#7c8cff'],
        ]) {
          const event = snapshot.events.find(candidate => candidate.kind === kind)
          expect(event).toBeDefined()
          view = { ...view, trailView, expanded: trailView === 'log' ? event?.id ?? null : `story-${event?.turn}` }
          const model = buildTrail(snapshot, { ...view, mode: 'claude' }, SAMPLE_NOW)
          const row = model.sections.flatMap(section => section.rows).find(candidate => candidate.id === view.expanded)
          expect(row?.detail?.[3]).toBe(`${mark ? `${mark} ` : ''}Fixture ${kind}`)
          const ui = await $.ui.mount({
            plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'icon-marks', props: scrollPaneProps(80, 100),
          })
          const tree = await ui.drawn()
          const line = nodeByKey(tree, `expanded-line-${view.expanded}-3`)
          expect(line).toBeDefined()
          expect(iconText(line)).toBe(`│ ${mark ? `${mark} ` : ''}Fixture ${kind}`)
          if (mark) {
            const icon = iconNodes(line).find(node => node.type === 'Text' && iconText(node) === mark)
            expect(icon?.props?.color).toBe(color)
          }
          expect(JSON.stringify(tree)).not.toContain('⚙')
          expect(JSON.stringify(tree)).not.toContain('\uFE0F')
          await ui.unmount()
        }
      }
    }
  })

  test('Legend never shrinks lines and scroll reaches every entry and wrapped help at 46 and 80', async ($, on) => {
    let view = { ...scrollTestView(), legend: true }
    let measured: ReturnType<typeof pane> | undefined
    let full: ReturnType<typeof legendPanel> | undefined
    on('ui.render', { component: 'Pane', requestId: 'icon-legend' }, ($, e) => {
      const ctx = scrollTestContext($.ui.resolve(e), e.props.bodyColumns, 18, view)
      ctx.surface = e.surface
      full = legendPanel(ctx)
      measured = pane(ctx, sampleSnapshot())
      return measured.tree
    })
    for (const surface of ['terminal'] as const) {
      for (const width of [46, 80]) {
        view = { ...view, legendScroll: 0 }
        const ui = await $.ui.mount({
          plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'icon-legend', props: scrollPaneProps(width, 18),
        })
        const tree = await ui.drawn()
        const panel = nodeByKey(tree, 'legend-panel')
        const content = nodeByKey(tree, 'legend-content')
        const lines = childrenOfNode(content)
        expect(panel?.props?.overflow).toBe('hidden')
        const innerWidth = width - 4
        const heights = lines.map(line => rowsOf(line, innerWidth))
        const total = heights.reduce((sum, height) => sum + height, 0)
        expect(rowsOf(full, width)).toBe(total + 2)
        expect(measured?.maxLegendScroll).toBe(total + 2 - Number(panel?.props?.height))
        expect(heights[1]).toBeGreaterThan(1)
        expect(heights[2]).toBeGreaterThan(1)
        const counts = lines.find(line => iconText(line).startsWith('counts:'))
        expect(rowsOf(counts, innerWidth)).toBeGreaterThan(1)
        expect(content?.props?.flexShrink).toBe(0)
        for (const line of lines) expect(line.props?.flexShrink).toBe(0)
        for (const [key] of LEGEND) expect(nodeByKey(content, `lg-${key}`)?.props?.flexShrink).toBe(0)
        const viewport = Number(panel?.props?.height) - 2
        const reachable = new Set<string>()
        const reachableLines = new Set<number>()
        for (let at = 0; at <= (measured?.maxLegendScroll ?? 0); at++) {
          view = { ...view, legendScroll: at }
          await ui.redraw()
          const scrollingPanel = nodeByKey(await ui.drawn(), 'legend-panel')
          expect(childrenOfNode(scrollingPanel)[0]?.props?.marginTop).toBe(-at)
          let top = 0
          for (let index = 0; index < lines.length; index++) {
            const height = heights[index] ?? 0
            if (top >= at && top + height <= at + viewport) {
              reachableLines.add(index)
              for (const [key] of LEGEND) if (nodeByKey(lines[index], `lg-${key}`)) reachable.add(key)
            }
            top += height
          }
        }
        expect(reachableLines.size).toBe(lines.length)
        expect([...reachable].sort()).toEqual(LEGEND.map(([key]) => key).sort())
        view = { ...view, legendScroll: measured?.maxLegendScroll ?? 0 }
        await ui.redraw()
        const lastTree = await ui.drawn()
        expect(JSON.stringify(nodeByKey(lastTree, 'legend-content'))).toContain('resume earlier session')
        await ui.unmount()
      }
    }
  })
})
