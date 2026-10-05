import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const ROOT = 'F:/work/atlas'
const PANE = {
  title: 'Atlas', isFocused: true, bodyColumns: 80, placement: 'dock',
  scroll: { offset: 0, bodyRows: 12 }, view: {},
} as const

type Node = {
  type?: string
  props?: Record<string, unknown>
  children?: unknown
}

function nodes(value: unknown): Node[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(nodes)
  const node = value as Node
  return [node, ...nodes(node.children)]
}

function world(on: On) {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on, { setup: { observer: 'claude', at: 1_800_000_000_000 } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'atlas-fix6a-scroll' }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__conversation-atlas__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { ok: true } }))
  return clock
}

test('desktop Legend and tab strip use full native scrolling at 46 and 80', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await clock.settle()
  for (const bodyColumns of [46, 80]) {
    const ui = await $.ui.mount({
      plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas',
      props: { ...PANE, bodyColumns },
    })
    await ui.press({ key: 'bar-legend' })
    const tree = nodes(await ui.drawn())
    const legend = tree.find(node => node.props?.key === 'legend-panel')
    expect(legend).toBeDefined()
    for (const node of nodes(legend)) {
      if (node.type !== 'Box') continue
      expect(node.props?.height).toBeUndefined()
      expect(node.props?.overflow).toBeUndefined()
      expect(node.props?.marginTop).toBeUndefined()
    }
    const tabBar = tree.find(node => node.props?.key === 'tab-bar')
    expect(tabBar).toBeDefined()
    const labels = nodes(tabBar).filter(node => node.type === 'Button').map(node => node.props?.label)
    expect(labels).not.toContain('Up')
    expect(labels).not.toContain('Down')
    expect(labels).not.toContain('▲')
    expect(labels).not.toContain('▼')
    expect(await ui.find({ key: 'scroll-up' })).toBeUndefined()
    expect(await ui.find({ key: 'scroll-down' })).toBeUndefined()
    expect(await ui.find({ key: 'sb-thumb' })).toBeUndefined()
    const before = await ui.find({ key: 'legend-howto', type: 'Button' })
    expect(String(before?.props.label)).toContain('▸')
    await ui.press({ key: 'legend-howto' })
    const after = await ui.find({ key: 'legend-howto', type: 'Button' })
    expect(String(after?.props.label)).toContain('▾')
    expect(JSON.stringify(await ui.drawn())).toContain('1. Each row is one thing Atlas saw')
    await ui.press({ key: 'legend-howto' })
    expect(String((await ui.find({ key: 'legend-howto', type: 'Button' }))?.props.label)).toContain('▸')
    await ui.press({ key: 'bar-legend' })
    await ui.unmount()
  }
})

test('terminal tab strip retains its arrow scroll buttons at 46 and 80', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 20; i++) {
    await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/overflow-${i}.ts` })
  }
  await clock.settle()
  for (const bodyColumns of [46, 80]) {
    const ui = await $.ui.mount({
      plugin: 'conversation-atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas',
      props: { ...PANE, bodyColumns },
    })
    expect((await ui.find({ key: 'scroll-up', type: 'Button' }))?.props.label).toBe('▲')
    expect((await ui.find({ key: 'scroll-down', type: 'Button' }))?.props.label).toBe('▼')
    await ui.unmount()
  }
})
