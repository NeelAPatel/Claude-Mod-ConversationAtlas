import { expect, mock, test } from 'claude-code/testing'

const ROOT = 'F:/work/atlas'
const PANE_PROPS = { title: 'Atlas', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 12 }, view: {} } as any

function world(on: any) {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on, { setup: { observer: 'claude', at: 1_800_000_000_000 } })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'atlas-gui-fit' }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: `mcp__conversation-atlas__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { ok: true } }))
  return clock
}

const nodes = (value: any): any[] => !value || typeof value !== 'object'
  ? []
  : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.children)]

test('GUI fit keeps every tab label whole at 30, 46, and 80 columns', { timeoutMs: 30_000 }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  for (const bodyColumns of [30, 46, 80]) {
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: { ...PANE_PROPS, bodyColumns } })
    const tree = nodes(await ui.drawn())
    const expected = bodyColumns < 40 ? ['Map', 'Trail', 'Open', 'Evid'] : ['Map', 'Trail', 'Open', 'Evidence']
    for (const [index, key] of ['tab-map', 'tab-trail', 'tab-open', 'tab-evidence'].entries()) {
      const button = tree.find(node => node.type === 'Button' && node.props?.key === key)
      expect(button).toBeDefined()
      expect(String(button.props.label).replace(/\u00a0/g, '')).toContain(expected[index])
      const cell = tree.find(node => node.type === 'Box' && node.props?.key === `tab-${key}`)
      expect(cell.props.flexShrink).toBe(0)
      expect(cell.props.width).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('GUI section help expands inline without its own paging controls', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true } as any)
  await $.tool.call({ tool: 'mcp__conversation-atlas__observe', topic: 'GUI fit topic' } as any)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas', props: PANE_PROPS })
  await ui.press({ key: 'tab-trail' })
  await ui.press({ key: 'events-heading' })
  const tree = nodes(await ui.drawn())
  expect(tree.some(node => node.type === 'Text' && JSON.stringify(node.children).includes('A chronological record of prompts, topics, decisions and checkpoints.'))).toBe(true)
  expect(tree.some(node => node.props?.key === 'expanded-up' || node.props?.key === 'expanded-down')).toBe(false)
  expect(tree.some(node => typeof node.props?.key === 'string' && /help-(up|down)-/.test(node.props.key))).toBe(false)
  await ui.unmount()
})
