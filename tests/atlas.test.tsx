import { describe, expect, mock, test } from 'claude-code/testing'

import { confirmSuggestion, emptySnapshot, observe, returnFromDetour, setItemStatus, startTurn } from '../hooks/model'

const ROOT = 'F:/work/atlas'
const OBSERVE = 'mcp__conversation-atlas__observe'
const PANE_PROPS = { title: 'Atlas', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as any

function world(on: any) {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on)
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

describe('model: observation never writes intent', () => {
  test('Claude can propose a goal and a detour but not set them', async () => {
    let s = emptySnapshot('s', ROOT, 0)
    s = observe(s, { topic: 'Plugin architecture', goal: 'Build Conversation Atlas' }, 1)
    s = observe(s, { topic: 'Investigating UI capabilities', shift: 'possible-detour', why: 'Side research' }, 2)
    expect(s.goal).toBeNull()
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

describe('hooks', () => {
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
  test('the Legend opens above a pinned app bar, marks itself ^, and explains sections', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
    await $.tool.call({ tool: OBSERVE, topic: 'Pane layout', decisions: ['Keep it native'] } as any)
    await clock.settle()
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
      expect(await drawn(ui)).not.toContain('Legend ^')
      await ui.press({ key: 'bar-legend' })
      const open = await drawn(ui)
      expect(open).toContain('Legend ^')
      expect(open).toContain('your goal (confirmed)')
      expect(open).toContain('Topics from the start of the work to now')
      await ui.press({ key: 'bar-decisions' })
      const decisions = await drawn(ui)
      expect(decisions).toContain('dec ^')
      expect(decisions).not.toContain('Legend ^')
      await ui.press({ key: 'bar-decisions' })
      expect(await drawn(ui)).not.toContain(' ^"')
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
    expect(tiny).toContain('"label":"≡"')
    expect(tiny).toContain('"label":"?1"')
    await narrow.unmount()

    const short = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 14 } } })
    expect(await short.find({ key: 'scroll-down' })).toBeDefined()
    expect(await short.find({ key: 'bar-legend' })).toBeDefined()
    await short.press({ key: 'scroll-down' })
    expect(await drawn(short)).toMatch(/"marginTop":-\d+/)
    expect(await short.find({ key: 'bar-legend' })).toBeDefined()
    await short.unmount()
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
    on('session.messages', () => ({ value: EARLIER }))
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
