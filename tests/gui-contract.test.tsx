import { expect, mock, test } from 'claude-code/testing'
import type { AtlasView } from '../types'

const ROOT = 'F:/work/atlas'
const PANE_PROPS = { title: 'Atlas', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as any
const MAP_REPLY = 'Here it is:\n```json\n{"goal":"Ship the release checklist","topics":[{"topic":"Checklist pane"},{"topic":"Owner column","shift":"subtopic"},{"topic":"CI flakiness","shift":"possible-detour","why":"side trip"}],"decisions":["Keep it native"],"questions":["Who owns QA?"],"next":"Add the owner column"}\n```'

function world(on: any, entries: Record<string, unknown> = { setup: { observer: 'claude', at: 1_800_000_000_000 } }) {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on, entries)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'atlas-test-session' }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: `mcp__conversation-atlas__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { ok: true } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  return { clock }
}

async function drawn(ui: any): Promise<string> { return JSON.stringify(await ui.drawn()) }

test('desktop pane mounts and validates without overlays on every tab at supported widths', { timeoutMs: 30_000 }, async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await $.tool.call({ tool: 'mcp__conversation-atlas__observe', topic: 'Desktop contract topic', decisions: ['Desktop contract decision'], questions: ['Desktop contract question?'] } as any)
  await clock.settle()
  for (const bodyColumns of [46, 80]) {
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: { ...PANE_PROPS, bodyColumns } })
    for (const key of ['tab-trail', 'tab-open', 'tab-evidence', 'tab-map']) {
      if (await ui.find({ key, type: 'Button' })) await ui.press({ key })
      const text = await drawn(ui)
      expect(text).not.toContain('did not load')
      expect(text).not.toContain('fallback')
      const tree = await ui.drawn()
      expect(JSON.stringify(tree)).not.toContain('atlas-popup')
      const hasAbsoluteBox = (value: any): boolean => Array.isArray(value)
        ? value.some(hasAbsoluteBox)
        : Boolean(value && typeof value === 'object' && ((value.type === 'Box' && value.props?.position === 'absolute') || hasAbsoluteBox(value.children)))
      expect(hasAbsoluteBox(tree)).toBe(false)
    }
    if (await ui.find({ key: 'tab-trail', type: 'Button' })) await ui.press({ key: 'tab-trail' })
    for (const key of ['trail-sort', 'trail-filter-b-toggle', 'trail-filter-h-toggle'])
      expect(await ui.find({ key, type: 'Button' })).toBeDefined()
    expect(await ui.find({ key: 'trail-view-select', type: 'Select' })).toBeDefined()
    expect(await ui.find({ key: 'trail-view-story', type: 'Button' })).toBeUndefined()
    expect(await ui.find({ key: 'trail-view-log', type: 'Button' })).toBeUndefined()
    expect(await ui.find({ key: 'trail-view-menu', type: 'Button' })).toBeUndefined()
    await ui.press({ key: 'bar-legend' })
    expect(await drawn(ui)).not.toContain('did not load')
    await ui.unmount()
  }
})

test('desktop keyed controls dispatch tab, Legend, setup, and section-help actions', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await $.tool.call({ tool: 'mcp__conversation-atlas__observe', topic: 'Keyed desktop topic' } as any)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
  for (const [key, content] of [['tab-trail', 'TRAIL'], ['tab-open', 'OPEN'], ['tab-evidence', 'FILES'], ['tab-map', 'CURRENT PATH']] as const) {
    await ui.press({ key })
    expect(await drawn(ui)).toContain(content)
  }
    await ui.press({ key: 'bar-legend' })
    expect(await drawn(ui)).toContain('LEGEND')
    await ui.press({ key: 'tab-trail' })
  await ui.press({ key: 'events-heading' })
  expect(await drawn(ui)).toContain('A chronological record of prompts, topics, decisions and checkpoints.')
  await ui.unmount()
})

test('desktop Setup screen and setup choices remain available at both contract widths', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock } = world(on, {})
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await clock.settle()
  for (const bodyColumns of [46, 80]) {
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: { ...PANE_PROPS, bodyColumns } })
    await $.command.run({ command: 'atlas', args: 'setup', origin: { kind: 'composer' } } as any)
    await ui.redraw()
    const before = await drawn(ui)
    expect(before).toContain('setup-claude')
    expect(before).toContain('setup-engine')
    expect(before).not.toContain('did not load')
    await ui.press({ key: 'setup-engine' })
    expect(await drawn(ui)).not.toContain('did not load')
    await ui.unmount()
  }
})

test('desktop text exposes observed topics, decisions, and questions', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await $.tool.call({ tool: 'mcp__conversation-atlas__observe', topic: 'Visible desktop topic', decisions: ['Visible desktop decision'], questions: ['Visible desktop question?'] } as any)
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/visible-desktop-file.ts` } as any)
  await $.command.run({ command: 'atlas', args: 'goal Confirmed desktop goal' , origin: { kind: 'composer' } } as any)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
  for (const [key, content] of [['tab-trail', 'Visible desktop topic'], ['tab-open', 'Visible desktop question?']] as const) {
    if (await ui.find({ key, type: 'Button' })) await ui.press({ key })
    expect(await drawn(ui)).toContain(content)
  }
  expect(await drawn(ui)).toContain('Visible desktop decision')
  await ui.press({ key: 'tab-map' })
  expect(await drawn(ui)).toContain('Confirmed desktop goal')
  await ui.press({ key: 'tab-evidence' })
  expect(await drawn(ui)).toContain('visible-desktop-file.ts')
  await ui.unmount()
})

test('desktop wheel passes through to the engine without a view write', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock } = world(on)
  const viewKey = { plugin: 'conversation-atlas', key: 'view' } as const
  let view: AtlasView | undefined
  let writes = 0
  on('state.set', viewKey, async (_$, e, next) => {
    view = e.value
    writes += 1
    return next(e)
  })
  const engineResult = { deny: 'test engine result' }
  let reachedEngine = 0
  on('ui.scroll', { component: 'Pane', requestId: 'atlas' }, (_$, e) => {
    expect(e.by).toBe(1)
    reachedEngine += 1
    return engineResult
  })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await clock.settle()
  const bodyRows = 12
  const ui = await $.ui.mount({
    plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas',
    props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows } },
  })
  await ui.press({ key: 'tab-map' })
  expect(view?.scroll).toBe(0)
  const beforeWrites = writes
  const beforeView = view
  const result = await $.ui.scroll({
    component: 'Pane', requestId: 'atlas', offset: 1, by: 1,
    bodyRows, contentRows: 1_000, origin: { kind: 'person' },
  })
  expect(reachedEngine).toBe(1)
  expect(result).toEqual(engineResult)
  expect(writes).toBe(beforeWrites)
  expect(view).toEqual(beforeView)
  expect(view?.scroll).toBe(0)
  await ui.unmount()
})

test('desktop scan keeps the live Client mounted while the scan runs', { timeoutMs: 20_000 }, async ($, on) => {
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

test('desktop tab cells are equalized and separated from the active baseline at both widths', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await clock.settle()
  for (const bodyColumns of [46, 80]) {
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: { ...PANE_PROPS, bodyColumns } })
    await ui.press({ key: 'tab-map' })
    const buttons = await ui.findAll({ type: 'Button' })
    const tabs = ['tab-map', 'tab-trail', 'tab-open', 'tab-evidence'].map(key => buttons.find((button: any) => button.props.key === key))
    if (!tabs.every(Boolean)) throw new Error(`Missing tab buttons at ${bodyColumns}: ${JSON.stringify(buttons.map((button: any) => button.props.key))}`)
    const lengths = tabs.map((button: any) => String(button.props.label).length)
    if (new Set(lengths).size !== 1) throw new Error(`Unequal tab labels at ${bodyColumns}: ${JSON.stringify(tabs.map((button: any) => button.props.label))}`)
    const all = (value: any): any[] => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(all) : [value, ...all(value.children)]
    const tree = all(await ui.drawn())
    expect(tree.some(node => node.type === 'Box' && node.props?.key === 'tab-baseline-gap')).toBe(false)
    const baseline = async () => all(await ui.drawn()).find(node => node.type === 'Svg' && node.props?.alt === 'Tab strip baseline')
    expect((await baseline())?.props.height).toBe(8)
    expect((await baseline())?.props.source).toContain('#e0af68')
    await ui.press({ key: 'tab-open' })
    expect((await baseline())?.props.source).toContain('#f7768e')
    await ui.unmount()
  }
})
