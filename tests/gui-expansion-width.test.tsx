import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = 'F:/work/atlas'
const FILE = `${ROOT}/src/desktop-expansion.ts`

type Node = {
  type?: string
  props?: Record<string, unknown>
  children?: unknown[]
}

function elements(value: unknown): Node[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(elements)
  const node = value as Node
  return [node, ...elements(node.children)]
}

function setup(on: On) {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on, { setup: { observer: 'claude', at: 1_800_000_000_000 } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'gui-expansion-width-session' }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__conversation-atlas__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { ok: true } }))
  return clock
}

for (const bodyColumns of [64, 80, 120]) {
  test(`desktop ${bodyColumns}: Map, Open and Evidence details keep separate rows`, { timeoutMs: 30_000 }, async ($, on) => {
    const clock = setup(on)
    await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
    await $.tool.call({
      tool: 'mcp__conversation-atlas__observe',
      topic: 'Desktop expansion fixture',
      decisions: ['Keep desktop details readable at every width'],
    })
    await $.tool.call({ tool: 'Write', file_path: FILE, content: 'Desktop expansion fixture' })
    await $.tool.call({ tool: 'Read', file_path: FILE })
    await clock.settle()
    const ui = await $.ui.mount({
      plugin: 'conversation-atlas',
      surface: 'desktop',
      component: 'Pane',
      requestId: 'atlas',
      props: {
        title: 'Atlas',
        isFocused: true,
        bodyColumns,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 80 },
        view: {},
      },
    })
    for (const [tab, prefix, count] of [
      ['map', 'sel-f-', 5],
      ['open', 'dsel-', 7],
      ['evidence', 'ef-', 4],
    ] as const) {
      await ui.press({ key: `tab-${tab}` })
      const button = (await ui.findAll({ type: 'Button' })).find(row => String(row.props.key ?? '').startsWith(prefix))
      if (!button?.props.key) throw new Error(`Missing ${tab} expansion fixture at ${bodyColumns} columns`)
      const key = String(button.props.key)
      await ui.press({ key })
      const tree = elements(await ui.drawn())
      const expansion = tree.find(node => node.type === 'Box' && node.props?.key === key)
      if (!expansion) throw new Error(`Missing ${tab} expanded container at ${bodyColumns} columns`)
      const descendants = elements(expansion)
      expect(descendants.some(node => node.type === 'Box' && node.props?.width === 0)).toBe(false)
      const lines = descendants.filter(node => String(node.props?.key ?? '').startsWith(`detail-${key}-`))
      expect(lines.length).toBeGreaterThan(2)
      expect(lines).toHaveLength(count)
      for (const line of lines) {
        expect(line.type).toBe('Box')
        expect(line.props?.flexDirection).toBe('row')
        const texts = elements(line.children).filter(node => node.type === 'Text')
        expect(texts).toHaveLength(1)
        expect(texts[0]?.props?.wrap).toBe('wrap')
        expect(texts[0]?.children).toHaveLength(1)
        expect(typeof texts[0]?.children?.[0]).toBe('string')
        expect(String(texts[0]?.children?.[0])).not.toContain('\n')
      }
      await ui.press({ key })
    }
    await ui.unmount()
  })
}
