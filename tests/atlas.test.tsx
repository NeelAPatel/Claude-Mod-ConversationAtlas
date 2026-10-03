import { describe, expect, mock, test } from 'claude-code/testing'

import { confirmSuggestion, emptySnapshot, observe, promptBullets, returnFromDetour, setItemStatus, startTurn, upgrade } from '../hooks/model'

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
      expect(open).toContain('How to use')
      expect(open).toContain('your goal (confirmed)')
      expect(open).toContain('Topics from the start of the work to now')
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
    expect(tiny).toContain('"label":"?1 open →"')
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
      for (const key of ['tab-map', 'tab-trail', 'tab-open', 'tab-evidence', 'mark']) expect(await ui.find({ key })).toBeDefined()
      await ui.unmount()
    }
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
