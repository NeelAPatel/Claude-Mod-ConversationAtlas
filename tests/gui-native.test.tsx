import { expect, mock, test } from 'claude-code/testing'

const ROOT = 'F:/work/atlas'
const PANE = { title: 'Atlas', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} } as any

function setup(on: any) {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on, { setup: { observer: 'claude', at: 1_800_000_000_000 } })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'atlas-native-test' }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: `mcp__conversation-atlas__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { ok: true } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  return clock
}

async function text(ui: any): Promise<string> {
  return JSON.stringify(await ui.drawn())
}

test('desktop renderer uses flexible native controls and clean pane chrome', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = setup(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await $.tool.call({ tool: 'mcp__conversation-atlas__observe', topic: 'Native desktop topic', decisions: ['Native decision'], questions: ['Native question?'] } as any)
  await clock.settle()

  for (const bodyColumns of [46, 80]) {
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: { ...PANE, bodyColumns } })
    for (const [tab, key] of [['map', 'tab-map'], ['trail', 'tab-trail'], ['open', 'tab-open'], ['evidence', 'tab-evidence']] as const) {
      const button = await ui.find({ key, type: 'Button' })
      if (!button) throw new Error(`missing desktop tab ${key} at ${bodyColumns} columns`)
      await ui.press({ key })
      if ((await ui.find({ key, type: 'Button' }))?.props.variant !== 'primary') throw new Error(`tab ${key} did not use the primary variant`)
      expect((await text(ui)).toLowerCase()).not.toContain('did not load')
      expect(tab).toBeDefined()
    }
    await ui.press({ key: 'bar-legend' })
    let drawn = await text(ui)
    expect(drawn).toContain('LEGEND')
    for (const glyph of ['─', '│', '┃', '╭', '╮', '╰', '╯']) expect(drawn).not.toContain(glyph)
    const buttons = await ui.findAll({ type: 'Button' })
    for (const button of buttons) {
      expect(String(button.props.label ?? '')).not.toMatch(/^\[/)
    }
    for (const key of ['tab-map', 'tab-trail', 'tab-open', 'tab-evidence', 'bar-legend', 'mark']) {
      if (!(await ui.find({ key, type: 'Button' }))) throw new Error(`missing desktop control ${key}`)
    }
    if ((await ui.find({ key: 'bar-legend', type: 'Button' }))?.props.width !== undefined) throw new Error('Legend button has a fixed width')
    if ((await ui.find({ key: 'mark', type: 'Button' }))?.props.width !== undefined) throw new Error('Mark button has a fixed width')

    await ui.press({ key: 'tab-trail' })
    if (!(await ui.find({ key: 'trail-view-menu', type: 'Button' }))) throw new Error('Trail tab is missing its Settings control')
    await ui.press({ key: 'trail-view-menu' })
    const close = await ui.find({ key: 'popup-close', type: 'Button' })
    if (!close) throw new Error('Trail Settings popup did not expose its native close button')
    expect(close.props.role).toBe('dismiss')
    await ui.unmount()
  }
  const setupUi = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: { ...PANE, bodyColumns: 46 } })
  await $.command.run({ command: 'atlas', args: 'setup', origin: { kind: 'composer' } } as any)
  await setupUi.redraw()
  if (!(await setupUi.find({ key: 'setup-claude', type: 'Button' }))) throw new Error('Setup is missing its primary button')
  if (!(await setupUi.find({ key: 'setup-engine', type: 'Button' }))) throw new Error('Setup is missing its secondary button')
  expect((await text(setupUi)).toLowerCase()).not.toContain('did not load')
  await setupUi.unmount()
})

test('desktop native rows still expose scrolling when content overflows', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = setup(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  for (let i = 0; i < 20; i++) {
    await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/overflow-${i}.ts` } as any)
  }
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: { ...PANE, scroll: { offset: 0, bodyRows: 12 } } })
  const scrollDown = await ui.find({ key: 'scroll-down', type: 'Button' })
  if (!scrollDown) throw new Error(`desktop overflow has no scroll-down button: ${await text(ui)}`)
  expect(scrollDown.props.dimColor).toBe(false)
  await ui.unmount()
})
