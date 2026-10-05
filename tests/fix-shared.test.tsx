import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { AtlasSnapshot } from '../types'

const ROOT = 'F:/work/atlas'
const SNAP = { plugin: 'conversation-atlas', key: 'snapshot' } as const
const PROPS = {
  title: 'Atlas',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

function world(on: On) {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on, { setup: { observer: 'claude', at: 1_800_000_000_000 } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'fix-shared-session' }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__conversation-atlas__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { ok: true } }))
  const state: { snapshot?: AtlasSnapshot } = {}
  on('state.set', SNAP, async (_$, e, next) => {
    state.snapshot = e.value as AtlasSnapshot
    return next(e)
  })
  return { clock, state }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: row presses expand and collapse without expansion close buttons`, async ($, on) => {
    const { clock } = world(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await $.command.run({ command: 'atlas', args: 'goal Ship the pane', origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 80 } })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'atlas', props: PROPS })
    await ui.press({ key: 'goal-row' })
    expect(JSON.stringify(await ui.drawn())).toContain('confirmed: Ship the pane')
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.some(button => String(button.props.key).startsWith('close-'))).toBe(false)
    expect(await ui.find({ key: 'expansion-close-cell-goal-row' })).toBeUndefined()
    expect(await ui.find({ key: 'expansion-actions-goal-row' })).toBeUndefined()
    await ui.press({ key: 'goal-row' })
    expect(JSON.stringify(await ui.drawn())).not.toContain('confirmed: Ship the pane')
    await ui.unmount()
  })

  test(`${surface}: settled ledger Reopen returns a decision to observed`, async ($, on) => {
    const { clock, state } = world(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await $.tool.call({ tool: 'mcp__conversation-atlas__observe', decisions: ['Keep the pane native'] })
    await clock.settle()
    const before = state.snapshot!
    const id = before.decisions[0]!.id
    const ui = await $.ui.mount({ plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'atlas', props: PROPS })
    await ui.press({ key: 'tab-open' })
    await ui.press({ key: `dsel-${id}` })
    await ui.press({ key: `set-${id}` })
    await ui.press({ key: 'tab-evidence' })
    await ui.press({ key: `dsel-${id}` })
    const buttons = await ui.findAll({ type: 'Button' })
    const controls = buttons.map(button => String(button.props.key))
    expect(controls.some(key => key.startsWith('close-'))).toBe(false)
    expect((await ui.find({ key: `restore-${id}`, type: 'Button' }))?.props.label).toBe('Reopen')
    expect(controls.indexOf(`restore-${id}`)).toBeLessThan(controls.indexOf(`weight-${id}`))
    expect(controls.indexOf(`weight-${id}`)).toBeLessThan(controls.indexOf(`add-dsel-${id}`))
    await ui.press({ key: `restore-${id}` })
    const after = state.snapshot!
    expect(after.decisions.find(item => item.id === id)?.status).toBe('observed')
    expect(JSON.stringify(await ui.drawn())).not.toContain('Keep the pane native')
    await ui.unmount()
  })

  for (const bodyColumns of [46, 80]) {
    test(`${surface} ${bodyColumns}: editing starts with current goal, Cancel preserves it, Enter replaces it`, async ($, on) => {
      const { clock, state } = world(on)
      await $.session.start({ cwd: ROOT, surface, isInteractive: true })
      await $.command.run({ command: 'atlas', args: 'goal Ship the pane', origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 80 } })
      await clock.settle()
      const before = state.snapshot!
      const ui = await $.ui.mount({
        plugin: 'conversation-atlas', surface, component: 'Pane', requestId: 'atlas', props: { ...PROPS, bodyColumns },
      })
      expect((await ui.find({ key: 'edit-goal', type: 'Button' }))?.props.label).toBe('Edit')
      await ui.press({ key: 'edit-goal' })
      expect(await ui.find({ key: 'goal-row', type: 'Button' })).toBeDefined()
      expect((await ui.find({ key: 'goal-input', type: 'Input' }))?.props.value).toBe('Ship the pane')
      expect((await ui.find({ key: 'cancel-goal', type: 'Button' }))?.props.label).toBe('Cancel')
      if (surface === 'terminal') expect(await ui.find({ key: 'action-cancel-goal', type: 'Box' })).toBeDefined()
      await ui.input({ key: 'goal-input', text: 'Discard this draft', kind: 'change' })
      await ui.press({ key: 'cancel-goal' })
      const cancelled = state.snapshot!
      expect(cancelled.goal).toEqual(before.goal)
      expect(await ui.find({ key: 'goal-input', type: 'Input' })).toBeUndefined()
      expect(await ui.find({ key: 'edit-goal', type: 'Button' })).toBeDefined()
      await ui.press({ key: 'edit-goal' })
      expect((await ui.find({ key: 'goal-input', type: 'Input' }))?.props.value).toBe('Ship the pane')
      await ui.input({ key: 'goal-input', text: 'Ship the replacement' })
      const submitted = state.snapshot!
      expect(submitted.goal?.text).toBe('Ship the replacement')
      expect(submitted.goal?.source).toBe('person')
      expect(await ui.find({ key: 'goal-input', type: 'Input' })).toBeUndefined()
      await ui.unmount()
    })
  }
}
