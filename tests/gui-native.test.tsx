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
    const tabPaths = (value: any, path = ''): Record<string, string> => {
      if (!value || typeof value !== 'object') return {}
      if (Array.isArray(value)) return Object.assign({}, ...value.map((child, index) => tabPaths(child, `${path}/${index}`)))
      const own = value.type === 'Button' && String(value.props?.key ?? '').startsWith('tab-') ? { [value.props.key]: path } : {}
      return Object.assign(own, ...((value.children ?? []).map((child: any, index: number) => tabPaths(child, `${path}/${index}`))))
    }
    const initialTabPaths = tabPaths(await ui.drawn())
    const accents = { 'tab-map': '#e0af68', 'tab-trail': '#9ece6a', 'tab-open': '#f7768e', 'tab-evidence': '#7aa2f7' }
    for (const [tab, key] of [['map', 'tab-map'], ['trail', 'tab-trail'], ['open', 'tab-open'], ['evidence', 'tab-evidence']] as const) {
      const button = await ui.find({ key, type: 'Button' })
      if (!button) throw new Error(`missing desktop tab ${key} at ${bodyColumns} columns`)
      await ui.press({ key })
      const activeBaseline = elements(await ui.drawn()).find(node => node.type === 'Svg' && node.props?.alt === 'Tab strip baseline')
      expect(activeBaseline?.props.source).toContain(accents[key])
      expect(activeBaseline?.props.height).toBe(8)
      expect(JSON.stringify(await ui.drawn())).not.toContain('━')
      expect(tabPaths(await ui.drawn())).toEqual(initialTabPaths)
      if ((await ui.find({ key, type: 'Button' }))?.props.variant !== 'primary') throw new Error(`tab ${key} did not use the primary variant`)
      expect((await text(ui)).toLowerCase()).not.toContain('did not load')
      const tree = elements(await ui.drawn())
      expect(tree.some(node => node.type === 'Box' && node.props?.position === 'absolute')).toBe(false)
      expect(tree.some(node => node.props?.key === 'atlas-popup')).toBe(false)
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
        if (bodyColumns === 80) {
          const oldBudget = Math.max(1, bodyColumns - 2 - 3 - 2 - 2)
          expect(String(long.props.label).length).toBeGreaterThan(oldBudget)
        }
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
    expect(await ui.find({ key: 'observer-toggle', type: 'Button' })).toBeUndefined()
    await ui.press({ key: 'legend-howto' })
    drawn = await text(ui)
    expect((await ui.find({ key: 'observer-toggle', type: 'Button' }))?.props.variant).toBe('primary')
    expect(drawn).not.toContain('OBSERVER')
    expect(drawn).toContain('Observer mode:')
    await ui.press({ key: 'legend-howto' })
    const legendColumns = elements(await ui.drawn()).filter(node => String(node.props?.key ?? '').startsWith('legend-columns-'))
    expect(legendColumns).toHaveLength(bodyColumns >= 64 ? 2 : 1)
    expect(drawn.match(/your goal \(confirmed\)/g)?.length).toBe(1)
    expect(drawn.match(/report back/g)?.length).toBe(1)
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
    for (const key of ['trail-sort', 'trail-filter-b-toggle', 'trail-filter-h-toggle']) {
      if (!(await ui.find({ key, type: 'Button' }))) throw new Error(`Trail toolbar is missing ${key} at ${bodyColumns} columns`)
    }
    if (!(await ui.find({ key: 'trail-view-select', type: 'Select' }))) throw new Error(`Trail view Select is missing at ${bodyColumns} columns`)
    expect(await ui.find({ key: 'trail-view-menu', type: 'Button' })).toBeUndefined()
    expect((await ui.find({ key: 'events-heading', type: 'Button' }))?.props.label).toBe('?')
    expect((await ui.find({ key: 'trail-view-select', type: 'Select' }))?.props.options).toEqual([{ value: 'story', label: 'Story' }, { value: 'log', label: 'Log' }])
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

test('desktop Trail toolbar controls update the displayed view, order, and filters', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = setup(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await $.tool.call({ tool: 'mcp__conversation-atlas__observe', topic: 'Trail toolbar fixture' } as any)
  await clock.settle()
  for (const bodyColumns of [46, 80]) {
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: { ...PANE, bodyColumns } })
    await ui.press({ key: 'tab-trail' })
    const labels = async () => Object.fromEntries((await ui.findAll({ type: 'Button' })).map((button: any) => [button.props.key, button.props.label]))
    expect((await labels())['trail-sort']).toBe('Newest ▼')
    expect((await labels())['trail-filter-b-toggle']).toBe('✓ Report-backs')
    expect((await labels())['trail-filter-h-toggle']).toBe('✓ Hand-offs')
    const toolbarText = await text(ui)
    expect(toolbarText).not.toMatch(/>View</)
    expect(toolbarText).not.toMatch(/>Order</)
    expect(toolbarText).not.toMatch(/>Show</)
    await $.ui.select({ plugin: 'conversation-atlas', key: 'trail-view-select', value: 'log' } as any)
    expect(await text(ui)).toContain('TRAIL · Log')
    expect((await ui.find({ key: 'trail-view-select', type: 'Select' }))?.props.value).toBe('log')
    await ui.press({ key: 'trail-sort' })
    expect((await labels())['trail-sort']).toBe('Oldest ▲')
    await ui.press({ key: 'trail-sort' })
    expect((await labels())['trail-sort']).toBe('Newest ▼')
    await ui.press({ key: 'trail-filter-b-toggle' })
    expect((await labels())['trail-filter-b-toggle']).toBe('○ Report-backs')
    expect((await ui.find({ key: 'trail-filter-b-toggle', type: 'Button' }))?.props.dimColor).toBe(true)
    await ui.press({ key: 'trail-filter-b-toggle' })
    await $.ui.select({ plugin: 'conversation-atlas', key: 'trail-view-select', value: 'story' } as any)
    await ui.unmount()
  }
})

test('desktop overflow items expand inline and close without popup actions', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = setup(on)
  const longQuestion = `Should this resolved question expand inline with its complete detail and actions on the desktop surface? ${'Additional context for the inline expansion. '.repeat(3)}`
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await $.tool.call({ tool: 'mcp__conversation-atlas__observe', questions: [longQuestion] } as any)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: PANE })
  await ui.press({ key: 'tab-open' })
  const row = (await ui.findAll({ type: 'Button' })).find((button: any) => String(button.props.label ?? '').startsWith('Should this resolved question'))
  if (!row?.props.key) throw new Error('Open tab fixture did not create the long question row')
  await ui.press({ key: String(row.props.key) })
  const expanded = await text(ui)
  expect(expanded).toContain('Additional context for the inline expansion.')
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.some((button: any) => button.props.label === 'Chat ⇒')).toBe(true)
  expect(buttons.some((button: any) => button.props.label === '✕')).toBe(false)
  await ui.press({ key: String(row.props.key) })
  expect(await text(ui)).not.toContain('Additional context for the inline expansion.')
  const tree = elements(await ui.drawn())
  expect(tree.some(node => node.props?.key === 'atlas-popup')).toBe(false)
  expect(tree.some(node => node.type === 'Box' && node.props?.position === 'absolute')).toBe(false)
  await ui.unmount()
})

test('desktop Trail detail labels stay one per row at every width', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = setup(on)
  on('turn.start', () => ({ turnId: 'gui-detail-layout' }))
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await $.turn.start({ turnId: 'gui-detail-layout', text: 'Check the compact detail layout.\n- retain full width notes' } as any)
  await clock.settle()
  for (const bodyColumns of [46, 80]) {
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: { ...PANE, bodyColumns } })
    await ui.press({ key: 'tab-trail' })
    const event = (await ui.findAll({ type: 'Button' })).find((button: any) => String(button.props.key ?? '').startsWith('evb-'))
    if (!event?.props.key) throw new Error(`Trail event missing at ${bodyColumns} columns`)
    await ui.press({ key: String(event.props.key) })
    const tree = elements(await ui.drawn())
    const grids = tree.filter(node => String(node.props?.key ?? '').startsWith('expanded-line-story-1-grid-'))
    expect(grids).toHaveLength(0)
    expect(tree.some(node => node.type === 'Box' && node.props?.width === 0)).toBe(false)
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.filter((button: any) => button.props.label === 'Chat ⇒')).toHaveLength(1)
    expect(buttons.filter((button: any) => button.props.label === '✕')).toHaveLength(0)
    const detail = await text(ui)
    expect(detail).toContain('turn: 1')
    expect(detail).toContain('when: now')
    expect(detail.indexOf('turn: 1')).toBeLessThan(detail.indexOf('when: now'))
    await ui.unmount()
  }
})

test('desktop shows an inline notice for stale terminal popup state', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = setup(on)
  const viewKey = { plugin: 'conversation-atlas', key: 'view' } as const
  const fixture = { view: { setup: false, tab: 'map', refs: {}, nextRef: 1, editingGoal: false, legend: false, popup: { kind: 'trail-view' }, popupScroll: 0, legendScroll: 0, scroll: 0, trailNewest: true, trailView: 'story', expanded: null, expandedScroll: 0, fullConfirm: null } as any }
  on('state.get', viewKey, async (_$, e, next) => {
    const held = await next(e)
    return held.value ? { value: { ...held.value, value: fixture.view } } : held
  })
  on('state.set', viewKey, async (_$, e, next) => {
    fixture.view = e.value
    return next(e)
  })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: PANE })
  expect(await text(ui)).toContain('A panel from the terminal view is open')
  expect((await ui.find({ key: 'popup-close', type: 'Button' }))?.props.label).toBe('Close it')
  await ui.press({ key: 'popup-close' })
  expect(fixture.view.popup).toBeNull()
  expect(await text(ui)).not.toContain('A panel from the terminal view is open')
  await ui.unmount()
})

test('desktop overflow draws every file row for native scrolling', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = setup(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 20; i++) {
    await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/overflow-${i}.ts` })
  }
  await clock.settle()
  const ui = await $.ui.mount({
    plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas',
    props: { ...PANE, scroll: { offset: 0, bodyRows: 12 } },
  })
  await ui.press({ key: 'tab-evidence' })
  expect(await ui.find({ key: 'scroll-up', type: 'Button' })).toBeUndefined()
  expect(await ui.find({ key: 'scroll-down', type: 'Button' })).toBeUndefined()
  expect(await ui.find({ key: 'sb-thumb' })).toBeUndefined()
  const tree = elements(await ui.drawn())
  const root = tree.find(node => node.props?.key === 'pane-root')
  expect(root).toBeDefined()
  expect(root?.props.height).toBeUndefined()
  expect(tree.some(node => node.type === 'Box' && Number(node.props?.marginTop) < 0)).toBe(false)
  // Evidence lists at most 12 files (the cap), all drawn without a window. Title cells may clip text; body and Legend containers must never clip a scroll window.
  const windows = tree.filter(node => node.type === 'Box' && node.props?.overflow === 'hidden')
  for (const window of windows) {
    expect(window.props.height).toBeUndefined()
    expect(elements(window.children).some(node => node.type === 'Box')).toBe(false)
  }
  const files = await ui.findAll({ type: 'Button' })
  expect(files.filter(button => String(button.props.key).startsWith('ef-')).length).toBe(12)
  const drawn = await text(ui)
  expect(new Set(drawn.match(/overflow-\d+\.ts/g)).size).toBe(12)
  await ui.unmount()
})
