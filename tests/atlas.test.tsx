import { describe, expect, mock, test } from 'claude-code/testing'

import { addCheckpoint, closeUnverifiedHandoffs, collapseEvents, confirmSuggestion, emptySnapshot, goalSuggestions, observe, promptBullets, reportHandoff, reportMarker, resolveRepoPath, returnFromDetour, setGoal, setItemStatus, startHandoff, startTurn, stripPromptMarkers, touchFile, upgrade } from '../hooks/model'
import { expectedReportPath, handoffStart, parseHandoffReport, reportChanged, reportFingerprint } from '../hooks/delegation'
import { cellWidth, collapseBarLabels, layoutRow, measuredBarItemWidth, truncateMiddleCells } from '../hooks/ui'
import { C, rowsOf } from '../hooks/view'
import { buildEvidence } from '../hooks/screens/evidence'
import { buildMap } from '../hooks/screens/map'
import { buildOpen } from '../hooks/screens/open'
import { buildTrail, eventText } from '../hooks/screens/trail'
import type { AtlasEvent } from '../types'

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

  test('confirming a detour keeps a Trailhead departure snapshot and return emits one packet', async () => {
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

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
      const text = await drawn(ui)
      for (const word of ['Passive observatory', 'model.ts', 'Tests passed', 'Wire the pane', 'Keep the UI native']) expect(text).toContain(word)
      if (surface === 'desktop') expect(text).not.toContain('did not load')
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
        'Close',
      ]) {
        expect(expanded).toContain(text)
      }
      await ui.unmount()
    }
  )
})

const TRAILHEAD_CHECKPOINT = JSON.stringify({
  format: 'trailhead-checkpoint',
  storageVersion: 1,
  checkpointSequence: 3,
  savedAt: '2026-10-01T12:00:00.000Z',
  projectRoot: ROOT,
  sessionId: 'old-trailhead-session',
  snapshot: {
    activeGoalId: 'goal-1',
    activeDetourId: 'detour-1',
    goals: [{ id: 'goal-1', objective: 'Ship the release checklist', intendedNextStep: 'Wire the checklist pane' }],
    detours: [{ id: 'detour-1', reason: 'Investigate flaky tests' }],
    decisions: [{ id: 'decision-1', conclusion: 'Keep the UI native', scope: 'active-goal' }],
  },
})

describe('merge: Trailhead features inside Atlas', () => {
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

  test('/atlas recover lists a Trailhead trail and resuming restores goal, next step and decision', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    on('fs.list', (_$: any, e: any) => (/[\\/]\.claude[\\/]trailhead$/.test(String(e.path)) ? { value: [{ name: 'old-trailhead-session.a.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] } : { value: [] }))
    on('fs.read', () => ({ value: TRAILHEAD_CHECKPOINT }))
    on('fs.write', () => ({ value: undefined }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()
    const listed = await $.command.run({ command: 'atlas', args: 'recover', origin: { kind: 'composer' } } as any)
    expect(listed.text).toContain('Ship the release checklist')
    expect(listed.text).toContain('trailhead')
    const resumed = await $.command.run({ command: 'atlas', args: 'recover 1', origin: { kind: 'composer' } } as any)
    expect(resumed.text).toContain('Resumed trailhead session')
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    const text = await drawn(ui)
    expect(text).toContain('Ship the release checklist')
    expect(text).toContain('Wire the checklist pane')
    expect(text).toContain('Investigate flaky tests')
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
    for (const surface of ['terminal', 'desktop'] as const) {
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
    on('fs.list', (_$: any, event: any) => /[\\/]\.claude[\\/]trailhead$/.test(String(event.path))
      ? { value: [{ name: 'prior.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }
      : { value: [] })
    on('fs.read', () => ({ value: TRAILHEAD_CHECKPOINT }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Action layout', next: 'Check the next action', decisions: ['Keep the observed action'] } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Side action', shift: 'possible-detour', why: 'Check the side path' } as any)
    await clock.settle()

    const ui = await mountPane($)
    await ui.press({ key: 'tab-open' })
    const collapsed = await drawn(ui)
    const suggestionButton = (await ui.findAll({ type: 'Button' })).find((button: any) => button.props.label === 'Check the next action')
    const suggestionKey = String(suggestionButton?.props.key ?? '')
    const decisionKey = collapsed.match(/"key":"(dsel-[^"]+)"/)?.[1]
    expect(suggestionKey).toBeDefined()
    expect(decisionKey).toBeDefined()
    for (const label of ['Pin next', 'Dismiss', 'Take detour', 'Not a detour', 'Settle', 'Drop']) expect(collapsed).not.toContain(label)

    await ui.press({ key: suggestionKey ?? '' })
    let expanded = await drawn(ui)
    expect(expanded).toContain('kind: next suggestion')
    expect(expanded).toContain('source: Claude')
    expect(expanded).toContain('topic: Action layout')
    expect(expanded).toContain('Pin next')
    expect(expanded).toContain('Dismiss')
    expect(expanded).toContain('Close')
    expect(expanded).not.toContain('Settle')

    await ui.press({ key: decisionKey ?? '' })
    expanded = await drawn(ui)
    expect(expanded).toContain('kind: observed decision')
    expect(expanded).toContain('source: Claude')
    expect(expanded).toContain('topic: Action layout')
    expect(expanded).toContain('Settle')
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
    expect(evidenceExpanded).toContain('Close')
    await ui.unmount()
  })

  test('the expanded goal Close control uses the bracketed action style', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.command.run({ command: 'atlas', args: 'goal Ship the pane', origin: { kind: 'composer' } } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'goal-row' })
    const close = await ui.find({ key: 'close-goal', type: 'Button' })
    expect(close?.props.plain).toBe(true)
    expect(close?.props.label).toBe('Close')
    const t = await drawn(ui)
    expect(t).toContain(`"color":"${C.action}"`)
    expect(t).toContain('"children":["["]')
    await ui.unmount()
  })

  test('active tabs stay coloured and section headings are Buttons', { timeoutMs: 20_000 }, async ($, on) => {
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
    expect(t).toContain('"key":"events-heading"')
    expect(await ui.find({ key: 'events-heading', type: 'Button' })).toBeDefined()
    await ui.unmount()
    const desktop = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    if (await desktop.find({ key: 'tab-map', type: 'Button' })) await desktop.press({ key: 'tab-map' })
    expect(await drawn(desktop)).toContain('"color":"yellowBright"')
    await desktop.unmount()
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
    expect(open).toContain('Settle')
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
    for (const surface of ['terminal', 'desktop'] as const) {
      let previousTabs = 0
      let previousBottom = 0
      for (let width = 20; width <= 100; width++) {
        const t = collapseBarLabels(tabs, width, surface, 1, 'tabs')
        const b = collapseBarLabels(bottom, width, surface, 1, 'bar')
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
      if (surface === 'terminal') {
        expect(collapseBarLabels(tabs, 20, surface, 1, 'tabs').grid.columns).toBe(1)
        expect(collapseBarLabels(tabs, 23, surface, 1, 'tabs').grid.columns).toBe(2)
        expect(collapseBarLabels(tabs, 100, surface, 1, 'tabs').grid.columns).toBe(4)
      }
    }
  })

  test('rendered bars keep whole labels at the requested terminal and desktop widths', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()
    const surfaceWidths = [['terminal', [30, 40, 46, 60, 100]] as const, ['desktop', [30, 60]] as const]
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
hooks/ui/index.tsx
hooks/delegation.ts
hooks/model.ts
hooks/register.tsx
hooks/view.tsx
types/index.d.ts
tests/atlas.test.tsx

A: The prose body must not become a file.`)
    expect(realShape?.files).toHaveLength(7)
    expect(realShape?.files).toEqual(['hooks/ui/index.tsx', 'hooks/delegation.ts', 'hooks/model.ts', 'hooks/register.tsx', 'hooks/view.tsx', 'types/index.d.ts', 'tests/atlas.test.tsx'])

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
    trailNewest: true,
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

  test('terminal and desktop render every screen at narrow and wide widths', { timeoutMs: 20_000 }, async ($, on) => {
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
    for (const surface of ['terminal', 'desktop'] as const) {
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
        if (surface === 'desktop') {
          expect(text).not.toContain('"children":["["]')
          expect(text).not.toContain('────')
        }
        await ui.unmount()
      }
    }
  })

  test('Trail renders legacy task ids and doubled handoff arrows cleanly', () => {
    const legacy: AtlasEvent = { id: 'legacy', at: 10, turn: 2, kind: 'report-back', text: '← ← <task-id>old-task</task-id> back · unverified · Codex' }
    const snapshot = { ...emptySnapshot('legacy', ROOT, 0), events: [legacy] }
    const rows = buildTrail(snapshot, screenView('trail'), 20).sections.flatMap(section => section.rows)
    const row = rows.find(candidate => candidate.id === legacy.id)
    expect(eventText(legacy.text)).toBe('back · unverified · Codex')
    expect(row?.text).toBe('back · unverified · Codex')
    expect(JSON.stringify(row)).not.toContain('task-id')
    expect(JSON.stringify(row)).not.toContain('← ←')
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
    expect(help).not.toContain('help-down-topics')
    expect(help).not.toContain('kind: main')
    await ui.press({ key: 'topics-heading' })
    await ui.press({ key: 'events-heading' })
    help = await drawn(ui)
    expect(help).toContain('A chronological record of prompts, topics, decisions and checkpoints.')
    expect(help).toContain('help-down-events')
    await ui.press({ key: 'help-down-events' })
    help = await drawn(ui)
    expect(help).toContain('2/6')
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
    for (const surface of ['terminal', 'desktop'] as const) {
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

  test('desktop loads the live client and advances its scan animation', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    on('model.fork', async () => {
      await clock.sleep(2_000)
      return { value: { isAnswered: true, text: MAP_REPLY, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    })
    await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
    await clock.settle()
    const running = $.command.run({ command: 'atlas', args: 'scan', origin: { kind: 'composer' } } as any)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    const before = await drawn(ui)
    expect(before).toContain('Mapping earlier conversation…')
    expect(before).not.toContain('did not load')
    const clientBefore = JSON.stringify(await ui.drawn({ in: 'live-scan' }))
    await ui.advance(100)
    const clientAfter = JSON.stringify(await ui.drawn({ in: 'live-scan' }))
    expect(clientAfter).not.toBe(clientBefore)
    expect(clientAfter).not.toContain('did not load')
    await clock.advance(2_000)
    await running
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

describe('pane interactions: sort, scrollbar, expand, footer', () => {
  const mountPane = ($: any, props: any = PANE_PROPS) => $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props })

  test('the trail sort button flips the order of events', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Alpha topic' } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Omega topic', shift: 'sibling' } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-trail' })
    const events = async () => {
      const t = await drawn(ui)
      return t.slice(t.indexOf('"trail-sort"'))
    }
    let t = await events()
    expect(String((await ui.find({ key: 'trail-sort', type: 'Button' }))?.props.label).trim()).toBe('↑')
    expect(t).not.toContain('newest first')
    expect(t.indexOf('Omega topic')).toBeLessThan(t.indexOf('Alpha topic'))
    await ui.press({ key: 'trail-sort' })
    t = await events()
    expect(String((await ui.find({ key: 'trail-sort', type: 'Button' }))?.props.label).trim()).toBe('↓')
    expect(t).not.toContain('oldest first')
    expect(t.indexOf('Alpha topic')).toBeLessThan(t.indexOf('Omega topic'))
    await ui.press({ key: 'bar-legend' })
    expect(await drawn(ui)).toContain('↑ = newest first; ↓ = oldest first.')
    await ui.unmount()
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

  test('Add to message puts a chip in the draft; only a chip left in the text sends the full item', { timeoutMs: 20_000 }, async ($, on) => {
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
    expect(t).toContain('kind: prompt')
    expect(t).toContain('turn: 1')
    expect(t).toContain('when: now')
    expect(t).toContain('Refactor the loader.')
    expect(t).toContain('add retries with backoff')
    expect(t).toContain('"key":"add-evb-')
    const close = t.match(/"key":"(close-evb-[^"]+)"/)?.[1]
    expect(close).toBeDefined()
    await ui.press({ key: close ?? '' })
    expect(await drawn(ui)).not.toContain('kind: prompt')
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
    expect(before).toContain('│ kind: prompt')
    await ui.press({ key: 'expanded-down' })
    const after = await drawn(ui)
    expect(after).not.toContain('│ kind: prompt')
    expect(after).toContain('│ - point 2')
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
    expect(after).toContain('Add to message')
    expect(after).not.toContain('Send to Claude')
    const close = (after.match(/"key":"(close-[^"]+)"/)?.[1]) ?? ''
    await ui.press({ key: close })
    expect(await drawn(ui)).not.toContain('Add to message')
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
