import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = 'F:/work/atlas'

function setup(on: On) {
  mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on, { setup: { observer: 'claude', at: 1_800_000_000_000 } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'fix-legend-tui-session' }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__conversation-atlas__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { ok: true } }))
}

for (const bodyColumns of [46, 80]) {
  test(`terminal ${bodyColumns}: Legend explains rows and pane width`, async ($, on) => {
    setup(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({
      plugin: 'conversation-atlas',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'atlas',
      props: {
        title: 'Atlas',
        isFocused: true,
        bodyColumns,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 60 },
        view: {},
      },
    })
    await ui.press({ key: 'bar-legend' })
    await ui.press({ key: 'legend-howto' })
    const drawn = JSON.stringify(await ui.drawn())
    for (const line of [
      '1. Each row is one thing Atlas saw: an icon, a title, counts and age.',
      '2. Press a row to open its details; press it again to close.',
      '3. [Bracketed] buttons do something when pressed.',
      '4. Nothing is confirmed until you press Confirm; observed items stay auto.',
      '✦ suggested / goal detected',
      `pane: ${bodyColumns} columns`,
    ]) expect(drawn).toContain(line)
    await ui.unmount()
  })
}
