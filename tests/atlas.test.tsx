import { describe, expect, mock, test } from 'claude-code/testing'

import { addCheckpoint, closeUnverifiedHandoffs, collapseEvents, confirmSuggestion, emptySnapshot, observe, promptBullets, reportHandoff, reportMarker, resolveRepoPath, returnFromDetour, setItemStatus, startHandoff, startTurn, stripPromptMarkers, touchFile, upgrade } from '../hooks/model'
import { expectedReportPath, handoffStart, parseHandoffReport, reportChanged, reportFingerprint } from '../hooks/delegation'
import { barWidth, collapseBarLabels } from '../hooks/ui'
import { C } from '../hooks/view'

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
    await ui.press({ key: 'return' })

    const first = await $.prompt.submit({ text: 'continue', wait: false, origin: { kind: 'composer' } } as any)
    const second = await $.prompt.submit({ text: 'and then?', wait: false, origin: { kind: 'composer' } } as any)
    expect(JSON.stringify(first)).toContain('return packet')
    expect(JSON.stringify(second)).not.toContain('return packet')
    expect(JSON.stringify(second)).toContain('Build Conversation Atlas')
    await ui.unmount()
  })
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

  test('Legend is a toggle panel, menus are boxed, and no label ends with a caret suffix', { timeoutMs: 20_000 }, async ($, on) => {
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
      await ui.press({ key: 'observer-toggle' })
      expect(await drawn(ui)).toContain('Observer: Engine only')
      await ui.press({ key: 'observer-toggle' })
      await ui.press({ key: 'bar-decisions' })
      const decisions = await drawn(ui)
      expect(decisions).toContain('DECISIONS')
      expect(decisions).not.toContain('LEGEND')
      await ui.press({ key: 'bar-decisions' })
      expect(await drawn(ui)).not.toContain('DECISIONS')
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
    expect(tiny).toContain('"label":"1 open →"')
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
    const row = (await drawn(ui)).match(/"key":"(dsel-[^"]+)"/)?.[1]
    expect(row).toBeDefined()
    await ui.press({ key: row ?? '' })
    const buttons = await ui.findAll({ type: 'Button' })
    const settle = buttons.find((b: any) => String(b.props.key ?? '').startsWith('set-'))
    const drop = buttons.find((b: any) => String(b.props.key ?? '').startsWith('drp-'))
    expect(settle?.props.variant).toBe('primary')
    expect(drop?.props.plain).toBe(true)
    expect(drop?.props.label).toBe(' Drop ')
    const t = await drawn(ui)
    expect(t).toContain(`"color":"${C.action}"`)
    expect(t).toContain(`"hover":{"color":"${C.action}"}`)
    expect(t).toContain('"children":["["]')
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
    expect(close?.props.label).toBe(' Close ')
    const t = await drawn(ui)
    expect(t).toContain(`"color":"${C.action}"`)
    expect(t).toContain('"children":["["]')
    await ui.unmount()
  })

  test('active tabs are coloured Text and their headings use the tab accent', { timeoutMs: 20_000 }, async ($, on) => {
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
    expect(t).toContain(`"color":"${C.trail}"`)
    expect(t).toContain('"children":["TRAIL"]')
    await ui.unmount()
    const desktop = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    if (await desktop.find({ key: 'tab-map', type: 'Button' })) await desktop.press({ key: 'tab-map' })
    expect(await drawn(desktop)).toContain('"color":"yellowBright"')
    await desktop.unmount()
  })

  test('settled decisions draw the checkpoint glyph in checkpoint blue', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.command.run({ command: 'atlas', args: 'decision Keep the pane native', origin: { kind: 'composer' } } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-evidence' })
    const t = await drawn(ui)
    expect(t).toContain(`"color":"${C.checkpoint}"`)
    expect(t).toContain('"children":["◆"]')
    await ui.unmount()
  })

  test('the decisions popup lists settled before observed decisions', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, decisions: ['Observed decision'] } as any)
    await $.command.run({ command: 'atlas', args: 'decision Settled decision', origin: { kind: 'composer' } } as any)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    await ui.press({ key: 'bar-decisions' })
    const t = await drawn(ui)
    expect(t).toContain('DECISIONS')
    expect(t).toContain('Settled decision')
    expect(t).toContain('Observed decision')
    const popup = t.slice(t.indexOf('"key":"atlas-popup"'))
    expect(popup.indexOf('Settled decision')).toBeLessThan(popup.indexOf('Observed decision'))
    await ui.unmount()
  })

  test('a capped decisions popup fills its body with at least five collapsed rows', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    for (const text of ['Keep native', 'Ship pane', 'Use cache', 'Read docs', 'Add tests', 'Open tab', 'Show map', 'Pin goal', 'Close popup']) {
      await $.command.run({ command: 'atlas', args: `decision ${text}`, origin: { kind: 'composer' } } as any)
    }
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
    await ui.press({ key: 'bar-decisions' })
    const popup = (await drawn(ui)).slice((await drawn(ui)).indexOf('"key":"atlas-popup"'))
    expect(popup).toContain('DECISIONS MADE')
    expect(popup).toContain('9 settled · 0 heard')
    expect((popup.match(/"key":"dsel-/g) ?? []).length).toBeGreaterThanOrEqual(5)
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
    expect(text).toContain('→ Build the UI')
    expect(text).toContain('← general-purpose completed')
    expect(text).toContain('→ Codex: Atlas')
    expect(text).toContain('← UI work complete')
    expect(text).toContain('2 files')

    await $.turn.start({ turnId: 'notification', text: '<task-notification>Finished checking the report</task-notification>' } as any)
    await clock.settle()
    text = await drawn(ui)
    expect(text).not.toContain('› Finished checking the report')
    expect(text).toContain('← Finished checking the report')

    await $.tool.call({ tool: 'PowerShell', command: 'wt new-tab --title "Codex: No report" codex "Read C:/tmp/no-report.md"', run_in_background: true } as any)
    await $.turn.start({ turnId: 'typed', text: 'Continue the main work.' } as any)
    await clock.settle()
    expect(await drawn(ui)).toContain('← back · unverified')
    await ui.unmount()
  })
})

describe('milestone 1: UI primitives and engine noise', () => {
  test('bar labels collapse without dropping the active tab or Mark at every width and surface', () => {
    const tabs = [
      { key: 'map', label: 'Map', short: 'Map', compact: 'M', active: true, onPress: () => undefined },
      { key: 'trail', label: 'Trail', short: 'Trail', compact: 'T', onPress: () => undefined },
      { key: 'open', label: 'Open 12', short: 'Open 12', compact: 'O', onPress: () => undefined },
      { key: 'evidence', label: 'Evidence', short: 'Evid', compact: 'E', onPress: () => undefined },
    ]
    const bottom = [
      { key: 'legend', label: 'Legend', short: 'Legend', compact: '≡', onPress: () => undefined },
      { key: 'decisions', label: '12 decisions →', short: '12 dec →', compact: '12→', onPress: () => undefined },
      { key: 'questions', label: '8 open →', short: '8 open →', compact: '8→', onPress: () => undefined },
      { key: 'mark', label: '+ Mark', short: '+ Mark', compact: '+', onPress: () => undefined },
    ]
    for (const surface of ['terminal', 'desktop'] as const) {
      for (let width = 20; width <= 100; width++) {
        const t = collapseBarLabels(tabs, width, surface)
        const b = collapseBarLabels(bottom, width, surface)
        expect(t.labels).toHaveLength(4)
        expect(b.labels).toHaveLength(4)
        expect(barWidth(t.labels)).toBeLessThanOrEqual(width)
        expect(barWidth(b.labels)).toBeLessThanOrEqual(width)
        expect(t.labels[0]).toBeTruthy()
        expect(b.labels[3]).toBeTruthy()
      }
    }
  })

  test('rendered bars keep every tab and Mark at narrow and wide widths without wrapping', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await clock.settle()
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const bodyColumns of [24, 40, 60, 100]) {
        const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'atlas', props: { ...PANE_PROPS, bodyColumns } })
        const text = await drawn(ui)
        expect(text).toMatch(/▸(?:Map|M)/)
        for (const tab of ['trail', 'open', 'evidence']) expect(text).toContain(`"key":"tab-${tab}"`)
        for (const key of ['bar-legend', 'bar-decisions', 'bar-questions', 'mark']) expect(text).toContain(`"key":"${key}"`)
        for (const key of ['bar-legend', 'bar-decisions', 'bar-questions', 'mark']) expect(await ui.find({ key, type: 'Button' })).toBeDefined()
        expect((await ui.find({ key: 'tab-bar' }))?.props.flexWrap).not.toBe('wrap')
        expect((await ui.find({ key: 'bottom-bar' }))?.props.flexWrap).not.toBe('wrap')
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
    const watcher = handoffStart('PowerShell', { command: 'Get-Content .\\generated\\atlas.json -Wait\nWrite-Output still-watching', description: 'Watch generated Atlas files', run_in_background: true })
    expect(watcher?.label).toBe('Watch generated Atlas files')
    expect(watcher?.agent).toBe('background')
    const fallback = handoffStart('PowerShell', { command: 'Get-Content .\\generated\\atlas.json -Wait\nWrite-Output still-watching', run_in_background: true })
    expect(fallback?.label).toBe('Get-Content .\\generated\\atlas.json -Wait')
    expect(fallback?.agent).toBe('background')
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
    expect(t).toContain('newest first')
    expect(t.indexOf('Omega topic')).toBeLessThan(t.indexOf('Alpha topic'))
    await ui.press({ key: 'trail-sort' })
    t = await events()
    expect(t).toContain('oldest first')
    expect(t.indexOf('Alpha topic')).toBeLessThan(t.indexOf('Omega topic'))
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
    await $.tool.call({ tool: OBSERVE, topic: 'Long text', decisions: [long] } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-open' })
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
    await $.tool.call({ tool: OBSERVE, topic: 'T', decisions: [`Short one ${'x'.repeat(80)}`] } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-open' })
    await ui.press({ key: (await drawn(ui)).match(/"key":"(dsel-[^"]+)"/)?.[1] ?? '' })
    await ui.press({ key: (await drawn(ui)).match(/"key":"(add-[^"]+)"/)?.[1] ?? '' })
    await clock.settle()
    expect(seen.toasts.join('|')).toContain('could not add to the message')
    await ui.unmount()
  })

  test('clicking any Trail event opens a boxed popup with full prompt text and bullets, and a tab closes it', { timeoutMs: 20_000 }, async ($, on) => {
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
    expect(t).toContain('EVENT')
    const popup = await ui.find({ key: 'atlas-popup' })
    expect(popup?.props.position).toBe('absolute')
    expect(Number(popup?.props.width)).toBeLessThan(72)
    expect(Number(popup?.props.width)).toBeGreaterThan(0)
    expect(Number(popup?.props.height)).toBeGreaterThan(0)
    expect(popup?.props.overflow).toBe('hidden')
    expect(popup?.props.backgroundColor).toBe('#16161e')
    const popupChildren = childrenOf(popup)
    expect(popupChildren.length).toBe(3)
    for (const child of popupChildren) expect(child.props.backgroundColor).toBe('#16161e')
    const popupBody = popupChildren[1]
    expect(popupBody?.props.backgroundColor).toBe('#16161e')
    for (const row of childrenOf(popupBody)) expect(row.props.backgroundColor).toBe('#16161e')
    // The runtime exposes the render tree, not terminal cells. These structural
    // guarantees are the strongest opacity/flush-width check available here.
    expect(t).toContain('Refactor the loader.')
    expect(t.indexOf('add retries with backoff')).toBeGreaterThan(t.indexOf('EVENT'))
    expect(t).toContain('• keep the API stable')
    expect(t).toContain('"key":"add-ev-')
    await ui.press({ key: 'tab-map' })
    expect(await drawn(ui)).not.toContain('"children":["EVENT"]')
    await ui.unmount()
  })

  test('a long decisions menu stays small and scrolls its own list', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    for (let i = 1; i <= 15; i++) await $.tool.call({ tool: OBSERVE, decisions: [`Decision option${i} ${String.fromCharCode(96 + i)}`] } as any)
    await clock.settle()
    const ui = await mountPane($, { ...PANE_PROPS, bodyColumns: 72 })
    await ui.press({ key: 'bar-decisions' })
    const first = (text: string) => text.slice(text.indexOf('"key":"atlas-popup"')).match(/"key":"dsel-[^"]+"[^}]*"label":"([^"]+)"/)?.[1]
    const before = await drawn(ui)
    expect(await ui.find({ key: 'popup-down' })).toBeDefined()
    const firstBefore = first(before)
    await ui.press({ key: 'popup-down' })
    const firstAfter = first(await drawn(ui))
    expect(firstAfter).toBeDefined()
    expect(firstAfter).not.toBe(firstBefore)
    await ui.unmount()
  })

  test('ui.scroll moves the popup, not the already-scrolled body', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    for (let i = 1; i <= 15; i++) {
      await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/file${i}.ts` } as any)
      await $.tool.call({ tool: OBSERVE, decisions: [`Decision option${i} ${String.fromCharCode(96 + i)}`] } as any)
    }
    await clock.settle()
    const ui = await mountPane($, { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 14 } })
    await ui.press({ key: 'scroll-down' })
    const bodyAt = (text: string) => text.match(/"marginTop":(-?\d+)/)?.[1]
    const beforePopup = bodyAt(await drawn(ui))
    expect(beforePopup).toBeDefined()
    await ui.press({ key: 'bar-decisions' })
    await clock.settle()
    const whileOpen = bodyAt(await drawn(ui))
    try {
      await $.ui.scroll({ in: 'atlas', to: 'end' } as any)
    } catch (error) {
      // The test runtime rejects the absolute popup's synthetic site offset after
      // the hook has handled it; the body state is still the contract under test.
      expect(String(error)).toContain('offset')
    }
    const afterPopupScroll = bodyAt(await drawn(ui))
    expect(afterPopupScroll).toBe(whileOpen)
    await ui.unmount()
  })

  test('clicking a long item shows it in full and Close collapses', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    const long = `We will keep the pane native ${'and boring '.repeat(10)}ENDMARK`
    await $.tool.call({ tool: OBSERVE, topic: 'Long text', decisions: [long] } as any)
    await clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab-open' })
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
