import { expect, mock, test } from 'claude-code/testing'

import type { AtlasView } from '../types'
import { SAMPLE_NOW, sampleSnapshot } from './fixtures/sample'
import { GOLDENS } from './golden/manifest'

const PLUGIN = 'conversation-atlas'
const ROOT = 'F:/work/atlas'
const CAPTURE_GOLDENS = false
type DrawnNode = {
  type?: string
  props?: Record<string, unknown>
  children?: unknown[]
}

type Style = {
  color?: string
  bold?: true
  italic?: true
  dim?: true
}

type Segment = { text: string; style: Style }
type Lines = Segment[][]

function childrenOf(node: DrawnNode): unknown[] {
  if (Array.isArray(node.children)) return node.children
  return Array.isArray(node.props?.children) ? node.props.children : []
}

function styleOf(props: Record<string, unknown> | undefined, parent: Style): Style {
  const style: Style = { ...parent }
  if (typeof props?.color === 'string') style.color = props.color
  if (props?.bold === true) style.bold = true
  if (props?.italic === true) style.italic = true
  if (props?.dimColor === true) style.dim = true
  return style
}

function textLines(text: string, style: Style): Lines {
  return text.split('\n').map(line => (line ? [{ text: line, style }] : []))
}

function append(left: Lines, right: Lines, gap = ''): Lines {
  if (!left.length) return right
  if (!right.length) return left
  const out = left.map(line => [...line])
  const first = right[0] ?? []
  out[0] = [...(out[0] ?? []), ...(gap ? [{ text: gap, style: {} }] : []), ...first]
  for (const line of right.slice(1)) out.push([...line])
  return out
}

function layout(value: unknown, parent: Style = {}): Lines {
  if (typeof value === 'string') return textLines(value, parent)
  if (!value || typeof value !== 'object') return []
  const node = value as DrawnNode
  const props = node.props ?? {}
  const type = node.type ?? ''
  const own = styleOf(props, parent)

  if (type === 'Client') return []
  if (type === 'Text') {
    const kids = childrenOf(node)
    if (!kids.length) return typeof props.text === 'string' ? textLines(props.text, own) : []
    return kids.reduce<Lines>((out, child) => append(out, layout(child, own)), [])
  }
  if (type === 'Button') {
    const label = typeof props.label === 'string' ? props.label : ''
    return textLines(label, own)
  }

  const kids = childrenOf(node).map(child => layout(child, own)).filter(lines => lines.length)
  if (!kids.length) return []
  const direction = props.flexDirection === 'row' ? 'row' : 'column'
  if (direction === 'column') return kids.flat()
  const gap = typeof props.gap === 'number' && props.gap > 0 ? ' '.repeat(props.gap) : ''
  return kids.reduce<Lines>((out, child) => append(out, child, out.length ? gap : ''), [])
}

function compactStyle(style: Style): string {
  const parts = [
    style.color ? `color:${style.color}` : '',
    style.bold ? 'bold' : '',
    style.italic ? 'italic' : '',
    style.dim ? 'dim' : '',
  ].filter(Boolean)
  return parts.join(',')
}

function stableLines(tree: unknown): string[] {
  const lines = layout(tree)
  return lines.map(line => {
    const text = line.map(segment => segment.text).join('')
    const styles: string[] = []
    let offset = 0
    for (const segment of line) {
      const style = compactStyle(segment.style)
      if (style) styles.push(`${offset}:${style}`)
      offset += segment.text.length
    }
    return styles.length ? `${text}  {${styles.join('|')}}` : text
  })
}

function unifiedDiff(expected: string, actual: string): string {
  const normalizedExpected = expected.replace(/\r\n/g, '\n')
  const normalizedActual = actual.replace(/\r\n/g, '\n')
  if (normalizedExpected === normalizedActual) return ''
  const before = normalizedExpected.replace(/\n$/, '').split('\n')
  const after = normalizedActual.replace(/\n$/, '').split('\n')
  const rows = [`--- expected`, `+++ actual`, `@@ -1,${before.length} +1,${after.length} @@`]
  const count = Math.max(before.length, after.length)
  for (let i = 0; i < count; i++) {
    if (before[i] === after[i]) rows.push(` ${before[i] ?? ''}`)
    else {
      if (before[i] !== undefined) rows.push(`-${before[i]}`)
      if (after[i] !== undefined) rows.push(`+${after[i]}`)
    }
  }
  return rows.join('\n')
}

function world(on: any, store: Record<string, unknown> = { setup: { observer: 'claude', at: SAMPLE_NOW } }) {
  const clock = mock.clock(on, { now: SAMPLE_NOW })
  mock.store(on, store)
  const golden = {
    async assert(_$: any, name: string, tree: unknown) {
      const actual = `${stableLines(tree).join('\n')}\n`
      if (CAPTURE_GOLDENS) {
        ;(globalThis as any).console?.log(`CAPTURE_GOLDEN ${name} ${JSON.stringify(actual)}`)
        return
      }
      const expected = GOLDENS[name]
      expect(expected, `Golden is missing from manifest: ${name}`).toBeDefined()
      const diff = unifiedDiff(expected ?? '', actual)
      expect(diff, `Golden mismatch: ${name}\n${diff}`).toBe('')
    },
  }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'golden-sample-session' }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: `mcp__conversation-atlas__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', (_$: any, e: any) => ({ result: e.tool === 'Bash' ? { stdout: '', stderr: '', interrupted: false } : { ok: true } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  return { clock, golden }
}

async function mountSample($: any, surface: 'terminal' | 'desktop', bodyColumns: number, tab: AtlasView['tab'], name: string | null) {
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: 'atlas',
    props: { title: 'Atlas', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as any)
  if (name) {
    if (tab !== 'map' || await ui.find({ key: 'tab-map', type: 'Button' })) await ui.press({ key: `tab-${tab}` })
  }
  return ui
}

test('golden pane snapshots match the fixed sample', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, golden } = world(on, { setup: { observer: 'claude', at: SAMPLE_NOW }, [`session:golden-sample-session`]: sampleSnapshot() })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const bodyColumns of [46, 80]) {
      for (const tab of ['map', 'trail', 'open', 'evidence'] as const) {
        const name = `${surface}-${bodyColumns}-${tab}`
        const ui = await mountSample($, surface, bodyColumns, tab, name)
        await golden.assert($, name, await ui.drawn())
        await ui.unmount()
      }

      const legend = await mountSample($, surface, bodyColumns, 'map', null)
      await legend.press({ key: 'tab-map' })
      await legend.press({ key: 'bar-legend' })
      await golden.assert($, `${surface}-${bodyColumns}-legend`, await legend.drawn())
      await legend.press({ key: 'bar-legend' })
      await legend.unmount()

      const expanded = await mountSample($, surface, bodyColumns, 'trail', null)
      await expanded.press({ key: 'tab-trail' })
      const events = (await expanded.findAll({ type: 'Button' })).filter((button: any) => String(button.props.key ?? '').startsWith('evb-'))
      expect(events.length).toBeGreaterThanOrEqual(3)
      await expanded.press({ key: String(events[2]?.props.key ?? '') })
      await golden.assert($, `${surface}-${bodyColumns}-trail-expanded`, await expanded.drawn())
      const close = (await expanded.findAll({ type: 'Button' })).find((button: any) => String(button.props.key ?? '').startsWith('close-evb-'))
      await expanded.press({ key: String(close?.props.key ?? '') })
      await expanded.unmount()
    }
  }
})

test('golden setup snapshots match the consent screen', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, golden } = world(on, { [`session:golden-sample-session`]: sampleSnapshot() })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as any)
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const bodyColumns of [46, 80]) {
      const name = `${surface}-${bodyColumns}-setup`
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        requestId: 'atlas',
        props: { title: 'Atlas', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
      } as any)
      await golden.assert($, name, await ui.drawn())
      await ui.unmount()
    }
  }
})
