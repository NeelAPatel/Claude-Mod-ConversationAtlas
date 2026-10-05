import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { AtlasSnapshot, AtlasView } from '../types'
import { goalSuggestions } from '../hooks/model'

const ROOT = 'F:/work/atlas'
const SNAP = { plugin: 'conversation-atlas', key: 'snapshot' } as const
const VIEW = { plugin: 'conversation-atlas', key: 'view' } as const
const OBSERVE = 'mcp__conversation-atlas__observe'
const PROPS = {
  title: 'Atlas', isFocused: true, placement: 'dock',
  scroll: { offset: 0, bodyRows: 100 }, view: {},
} as const

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown }

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object') return []
  const node = value as Node
  return [node, ...nodes(node.children ?? node.props?.children)]
}

function setup(on: On) {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on, { setup: { observer: 'claude', at: 1_800_000_000_000 } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'fix2-session' }))
  on('session.root', () => ({ value: ROOT }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__conversation-atlas__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { ok: true } }))
  const state: { snapshot?: AtlasSnapshot; view?: AtlasView; snapshotWrites: number } = { snapshotWrites: 0 }
  on('state.set', SNAP, async (_$, e, next) => {
    state.snapshot = e.value as AtlasSnapshot
    state.snapshotWrites++
    return next(e)
  })
  on('state.set', VIEW, async (_$, e, next) => {
    state.view = e.value as AtlasView
    return next(e)
  })
  return { clock, state }
}

// Only the suggestion rows: the goal's own detail also names the detected aim.
const altRows = (tree: unknown) => JSON.stringify(nodes(tree).filter(node => String(node.props?.key ?? '').startsWith('goal-alternative-')))

for (const surface of ['terminal', 'desktop'] as const) {
  for (const bodyColumns of [46, 80]) {
    test(`${surface} ${bodyColumns}: dismiss derived goals without intent writes and keep them hidden after observation`, async ($, on) => {
      const { clock, state } = setup(on)
      await $.session.start({ cwd: ROOT, surface, isInteractive: true })
      await $.command.run({ command: 'atlas', args: 'goal Ship the API', origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: bodyColumns } })
      await $.tool.call({ tool: OBSERVE, topic: 'Write onboarding docs', goal: 'Audit terminal spacing' })
      await clock.settle()
      const before = state.snapshot!
      const alternatives = goalSuggestions(before)
      expect(alternatives.length).toBeGreaterThan(1)
      const ui = await $.ui.mount({
        plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'atlas', props: { ...PROPS, bodyColumns },
      })
      await ui.press({ key: 'goal-row' })
      const block = nodes(await ui.drawn()).find(node => node.props?.key === 'suggested-goals')
      const elements = nodes(block)
      const guides = elements.filter(node => String(node.props?.key).includes('guide'))
      expect(guides.length).toBeGreaterThan(0)
      const firstRow = elements.findIndex(node => node.props?.key === 'goal-alternative-0')
      const firstGuide = elements.findIndex(node => String(node.props?.key).includes('guide'))
      expect(firstGuide).toBeLessThan(firstRow)
      for (let index = 0; index < alternatives.length; index++) {
        const row = elements.find(node => node.props?.key === `suggested-goal-alternative-${index}`)
        const contents = nodes(row)
        const dismiss = contents.findIndex(node => node.props?.key === `dismiss-goal-${index}`)
        const spacer = contents.findIndex(node => node.props?.key === `suggested-spacer-goal-alternative-${index}`)
        expect(dismiss).toBeGreaterThan(-1)
        expect(spacer).toBeGreaterThan(dismiss)
        expect(contents[spacer]?.props?.height).toBe(1)
      }
      if (surface === 'terminal') {
        expect(JSON.stringify(guides)).toContain('│ ')
      } else {
        const line = elements.find(node => node.type === 'Svg' && node.props?.alt === 'Suggested goals guide')
        expect(line?.props?.width).toBe(1)
        expect(String(line?.props?.source)).toContain('#41414a')
        expect(String(line?.props?.source)).toContain('non-scaling-stroke')
      }
      const writes = state.snapshotWrites
      await ui.press({ key: 'dismiss-goal-0' })
      expect(state.snapshotWrites).toBe(writes)
      expect(state.snapshot).toEqual(before)
      expect(state.view?.dismissedGoalAlts).toEqual([alternatives[0]])
      const remaining = altRows(await ui.drawn())
      expect(remaining).not.toContain(alternatives[0]!)
      for (const text of alternatives.slice(1)) expect(remaining).toContain(text)
      await $.turn.start({ turnId: 'fix2-next', text: 'Review database indexes.' })
      await $.tool.call({ tool: OBSERVE, topic: 'Review database indexes' })
      await clock.settle()
      await ui.redraw()
      expect(state.snapshot?.goal).toEqual(before.goal)
      expect(altRows(await ui.drawn())).not.toContain(alternatives[0]!)
      await $.command.run({ command: 'atlas', args: 'goal Ship the service', origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: bodyColumns } })
      expect(state.view?.dismissedGoalAlts).toEqual([alternatives[0]])
      await ui.unmount()
    })

    test(`${surface} ${bodyColumns}: Legend How to use toggles and preserves its choice`, async ($, on) => {
      const { state } = setup(on)
      await $.session.start({ cwd: ROOT, surface, isInteractive: true })
      const ui = await $.ui.mount({
        plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'atlas', props: { ...PROPS, bodyColumns },
      })
      await ui.press({ key: 'bar-legend' })
      const collapsed = JSON.stringify(await ui.find({ key: 'legend-content' }))
      expect((await ui.find({ key: 'legend-howto', type: 'Button' }))?.props.label).toBe('▸ How to use')
      expect(collapsed.indexOf('LEGEND')).toBeLessThan(collapsed.indexOf('Marks:'))
      expect(collapsed.indexOf('Marks:')).toBeLessThan(collapsed.indexOf('legend-howto'))
      expect(collapsed).not.toContain('observer-toggle')
      expect(collapsed).not.toContain('counts:')
      expect(collapsed).not.toContain('1. Each row')
      expect(collapsed).not.toContain('2. Press a row')
      expect(collapsed).not.toContain('3. ')
      expect(collapsed).not.toContain('4. Nothing')
      expect(collapsed).not.toContain('auto: picked by Atlas')
      const notes = nodes(await ui.drawn()).filter(node => node.type === 'Text'
        && JSON.stringify(node.children ?? node.props?.children ?? node.props?.text).includes('✦ suggested / goal detected'))
      expect(notes).toHaveLength(1)
      expect(collapsed).toContain('before an icon: just changed')
      await ui.press({ key: 'legend-howto' })
      expect(state.view?.legendScroll).toBe(0)
      expect(state.view?.popup).toBeNull()
      expect((await ui.find({ key: 'legend-howto', type: 'Button' }))?.props.label).toBe('▾ How to use')
      const expanded = JSON.stringify(await ui.find({ key: 'legend-content' }))
      for (const text of ['1. Each row', '2. Press a row', '3. ', '4. Nothing']) expect(expanded).toContain(text)
      expect(expanded).toContain('Observer mode:')
      expect(expanded).not.toContain('OBSERVER')
      expect(expanded.indexOf('4. Nothing')).toBeLessThan(expanded.indexOf('Observer mode:'))
      expect(expanded.indexOf('Observer mode:')).toBeLessThan(expanded.indexOf('counts:'))
      expect(expanded.indexOf('counts:')).toBeLessThan(expanded.indexOf('✦ suggested / goal detected'))
      const indented = nodes(await ui.find({ key: 'legend-content' })).find(node => node.props?.marginLeft === 2)
      expect(indented?.type).toBe('Box')
      for (const text of ['1. Each row', '4. Nothing', 'observer-toggle', 'counts:']) {
        expect(JSON.stringify(indented)).toContain(text)
      }
      await ui.press({ key: 'observer-toggle' })
      expect(state.view?.legendHowTo).toBe(true)
      expect(JSON.stringify(await ui.find({ key: 'observer-toggle' }))).toContain('Engine only')
      await ui.press({ key: 'observer-toggle' })
      await ui.press({ key: 'bar-legend' })
      await ui.press({ key: 'bar-legend' })
      expect((await ui.find({ key: 'legend-howto', type: 'Button' }))?.props.label).toBe('▾ How to use')
      await ui.press({ key: 'tab-trail' })
      await ui.press({ key: 'bar-legend' })
      expect((await ui.find({ key: 'legend-howto', type: 'Button' }))?.props.label).toBe('▾ How to use')
      await ui.press({ key: 'legend-howto' })
      expect((await ui.find({ key: 'legend-howto', type: 'Button' }))?.props.label).toBe('▸ How to use')
      expect(JSON.stringify(await ui.find({ key: 'legend-content' }))).not.toContain('1. Each row')
      await ui.unmount()
    })
  }
}
