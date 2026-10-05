import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { AtlasSnapshot } from '../hooks/model'

const ROOT = 'F:/work/atlas'
const PANE = {
  title: 'Atlas', isFocused: true, placement: 'dock',
  scroll: { offset: 0, bodyRows: 12 }, view: {},
} as const
const TAB_KEYS = ['tab-map', 'tab-trail', 'tab-open', 'tab-evidence']
const CONTROL_KEYS = [...TAB_KEYS, 'bar-legend', 'mark']

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
  on('session.id', () => ({ value: 'atlas-fix7-tabstrip' }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__conversation-atlas__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { ok: true } }))
  return clock
}

test('desktop tab strip keeps six controls and inline Legend at all six widths', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = world(on)
  let snapshot: AtlasSnapshot | undefined
  on('state.set', { plugin: 'conversation-atlas', key: 'snapshot' }, async (_$, e, next) => {
    snapshot = e.value
    return next(e)
  })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await clock.settle()
  for (const bodyColumns of [31, 40, 46, 60, 80, 120]) {
    const ui = await $.ui.mount({
      plugin: 'conversation-atlas', surface: 'desktop', component: 'Pane', requestId: 'atlas',
      props: { ...PANE, bodyColumns },
    })
    await ui.press({ key: 'tab-map' })
    const tree = nodes(await ui.drawn())
    const strip = tree.find(node => node.type === 'Box' && node.props?.key === 'tab-bar')
    expect(strip).toBeDefined()
    const stripNodes = nodes(strip)
    const buttons = stripNodes.filter(node => node.type === 'Button')
    expect(buttons.map(node => node.props?.key)).toEqual(CONTROL_KEYS)
    for (const key of CONTROL_KEYS) {
      expect(tree.filter(node => node.type === 'Button' && node.props?.key === key)).toHaveLength(1)
    }
    const row = stripNodes.find(node => node.type === 'Box' && node.props?.flexDirection === 'row')
    expect(row?.props?.flexWrap).toBe('wrap')
    expect(row?.props?.gap).toBe(1)
    expect(nodes(row).filter(node => node.type === 'Button')).toHaveLength(6)
    expect(tree.some(node => node.props?.key === 'app-bar')).toBe(false)
    for (const node of tree.filter(node => node.type === 'Box')) {
      expect(node.props?.width === 0).toBe(false)
      for (const prop of ['margin', 'marginX', 'marginY', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom']) {
        expect(Number(node.props?.[prop]) < 0).toBe(false)
      }
    }
    for (const node of stripNodes) expect(node.props?.overflow).toBeUndefined()
    const labels = bodyColumns - 2 < 40 ? ['Map', 'Trail', 'Open', 'Evid'] : ['Map', 'Trail', 'Open', 'Evidence']
    const labelWidth = Math.max(...labels.map(label => label.length))
    for (const [index, key] of TAB_KEYS.entries()) {
      const cell = stripNodes.find(node => node.type === 'Box' && node.props?.key === `tab-${key}`)
      expect(cell?.props?.flexGrow).toBe(1)
      expect(cell?.props?.flexShrink).toBe(0)
      expect(cell?.props?.width).toBeUndefined()
      const left = '\u00a0'.repeat(Math.floor((labelWidth - labels[index].length) / 2))
      const right = '\u00a0'.repeat(Math.ceil((labelWidth - labels[index].length) / 2))
      expect(buttons[index].props?.label).toBe(`${left}${labels[index]}${right}`)
      expect(buttons[index].props?.hotkey).toBe(['m', 't', 'o', 'e'][index])
    }
    for (const [key, label, hotkey, cellKey] of [
      ['bar-legend', 'Legend', 'l', 'bar-legend'],
      ['mark', '+ Mark', 'k', 'bar-mark'],
    ]) {
      const button = buttons.find(node => node.props?.key === key)
      expect(button?.props?.label).toBe(label)
      expect(button?.props?.hotkey).toBe(hotkey)
      expect(button?.props?.variant).toBe('secondary')
      expect(button?.props?.width).toBeUndefined()
      const cell = stripNodes.find(node => node.type === 'Box' && node.props?.key === cellKey)
      expect(cell?.props?.flexGrow).toBe(0)
      expect(cell?.props?.flexShrink).toBe(0)
      expect(cell?.props?.width).toBeUndefined()
    }
    const baseline = stripNodes.find(node => node.type === 'Svg' && node.props?.alt === 'Tab strip baseline')
    expect(baseline?.type).toBe('Svg')
    expect(stripNodes.indexOf(baseline!)).toBeGreaterThan(stripNodes.indexOf(buttons[5]))
    expect(await ui.find({ key: 'legend-panel' })).toBeUndefined()
    await ui.press({ key: 'bar-legend' })
    expect((await ui.find({ key: 'bar-legend', type: 'Button' }))?.props.variant).toBe('primary')
    const open = nodes(await ui.drawn())
    const legendIndex = open.findIndex(node => node.props?.key === 'legend-panel')
    const bodyIndex = open.findIndex(node => String(node.props?.key ?? '').startsWith('screen-'))
    expect(legendIndex).toBeGreaterThan(0)
    expect(bodyIndex).toBeGreaterThan(legendIndex)
    const openStrip = open.find(node => node.props?.key === 'tab-bar')
    expect(JSON.stringify(openStrip)).toContain('━━━━━━')
    await ui.press({ key: 'bar-legend' })
    expect((await ui.find({ key: 'bar-legend', type: 'Button' }))?.props.variant).toBe('secondary')
    expect(await ui.find({ key: 'legend-panel' })).toBeUndefined()
    const markedBefore = snapshot?.checkpoints.filter(item => item.kind === 'marked').length ?? 0
    await ui.press({ key: 'mark' })
    expect(snapshot?.checkpoints.filter(item => item.kind === 'marked').length).toBe(markedBefore + 1)
    await ui.unmount()
  }
})
