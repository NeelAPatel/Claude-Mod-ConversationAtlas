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

function elements(value: any): any[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(elements)
  return [value, ...elements(value.children)]
}

test('desktop renderer uses flexible native controls and clean pane chrome', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = setup(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await $.tool.call({ tool: 'mcp__conversation-atlas__observe', topic: 'Native desktop topic', decisions: ['Native decision'], questions: ['Native question?'] } as any)
  await $.tool.call({ tool: 'mcp__conversation-atlas__observe', topic: 'Long nested topic title that must end in an ellipsis at narrow widths', shift: 'subtopic', questions: ['Long nested question title that must also end with an ellipsis at thirty, forty-six, and eighty columns'] } as any)
  const file = `${ROOT}/src/a-deliberately-long-desktop-file-name-that-needs-middle-truncation.ts`
  await $.tool.call({ tool: 'Write', file_path: file, content: 'native desktop file' } as any)
  await $.tool.call({ tool: 'Read', file_path: file } as any)
  await clock.settle()

  for (const bodyColumns of [30, 46, 80]) {
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: { ...PANE, bodyColumns } })
    const baseline = elements(await ui.drawn()).find(node => node.type === 'Svg' && node.props?.alt === 'Tab strip baseline')
    if (!baseline) throw new Error(`desktop tab strip has no SVG baseline at ${bodyColumns} columns`)
    for (const [tab, key] of [['map', 'tab-map'], ['trail', 'tab-trail'], ['open', 'tab-open'], ['evidence', 'tab-evidence']] as const) {
      const button = await ui.find({ key, type: 'Button' })
      if (!button) throw new Error(`missing desktop tab ${key} at ${bodyColumns} columns`)
      await ui.press({ key })
      if ((await ui.find({ key, type: 'Button' }))?.props.variant !== 'primary') throw new Error(`tab ${key} did not use the primary variant`)
      expect((await text(ui)).toLowerCase()).not.toContain('did not load')
      expect(tab).toBeDefined()
      expect(await text(ui)).toContain('…')
      if (tab === 'open') {
        const drawnOpen = await text(ui)
        expect(drawnOpen).toContain('OBSERVED DECISIONS')
        expect(drawnOpen).toContain('OPEN QUESTIONS')
        expect(drawnOpen).toContain('"children":["1"]')
        expect(drawnOpen).toContain('"children":["2"]')
        const long = (await ui.findAll({ type: 'Button' })).find((button: any) => String(button.props.label ?? '').startsWith('Long nested'))
        if (!long || !String(long.props.label).endsWith('…')) throw new Error(`long Open row was not truncated at ${bodyColumns} columns: ${JSON.stringify(long?.props)}`)
      }
      if (tab === 'map') {
        const heads = elements(await ui.drawn())
        const nested = heads.find(head => head.type === 'Box' && String(head.props?.key ?? '').startsWith('head-path-') && Number(head.props.marginLeft) > 0)
        if (!nested) throw new Error(`nested topic row did not render with depth indentation at ${bodyColumns} columns`)
      }
      if (tab === 'evidence') {
        const drawnEvidence = await text(ui)
        expect(drawnEvidence).toContain('1e')
        expect(drawnEvidence).toContain('1r')
        expect(drawnEvidence).toContain('now')
        const fileButton = (await ui.findAll({ type: 'Button' })).find((button: any) => String(button.props.label ?? '').startsWith('src/') && String(button.props.label ?? '').includes('…'))
        if (!fileButton) throw new Error(`long file path was not middle-truncated at ${bodyColumns} columns`)
      }
    }
    await ui.press({ key: 'bar-legend' })
    let drawn = await text(ui)
    expect(drawn).toContain('LEGEND')
    expect((await ui.find({ key: 'bar-legend', type: 'Button' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'observer-toggle', type: 'Button' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'mark', type: 'Button' }))?.props.variant).toBe('secondary')
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
    expect((await ui.find({ key: 'events-heading', type: 'Button' }))?.props.label).toBe('?')
    await ui.press({ key: 'trail-view-menu' })
    const close = await ui.find({ key: 'popup-close', type: 'Button' })
    if (!close) throw new Error('Trail Settings popup did not expose its native close button')
    expect(close.props.role).toBe('dismiss')
    expect(await text(ui)).toContain('» VIEW')
    for (const key of ['settings-page-prev', 'settings-page-next']) {
      if (!(await ui.find({ key, type: 'Button' }))) throw new Error(`Trail Settings pager is missing ${key} at ${bodyColumns} columns`)
    }
    if (!(await ui.find({ key: 'trail-view-story', type: 'Button' }))) throw new Error(`Trail Settings rows are missing at ${bodyColumns} columns`)
    expect(await text(ui)).toContain('1/')
    const popup = elements(await ui.drawn()).find(node => node.type === 'Box' && node.props?.key === 'atlas-popup')
    expect(popup?.props?.borderStyle).toBe('round')
    if (bodyColumns >= 46) {
      await ui.press({ key: 'settings-page-next' })
      if (!(await ui.find({ key: 'trail-sort', type: 'Button' }))) throw new Error(`Trail Settings pager did not reveal its next setting page at ${bodyColumns} columns`)
    }
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
  const thumb = await ui.find({ key: 'sb-thumb', type: 'Button' })
  if (!thumb) throw new Error('desktop overflow has no visible, pressable SVG thumb')
  await ui.press({ key: 'sb-thumb' })
  await ui.unmount()
})
