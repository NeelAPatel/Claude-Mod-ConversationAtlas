import { expect, test } from 'claude-code/testing'

import { frameFromTree } from '../scripts/sim/frame'
import { parseSteps, runSimulation } from '../scripts/sim/steps'

test('sim steps render and window the real TUI pane', { timeoutMs: 20_000 }, async ($, on) => {
  const steps = parseSteps(['snapshot', 'scroll end', 'scroll -1', 'key t'])
  const result = await runSimulation($, on, {
    surface: 'tui',
    width: 46,
    height: 8,
    state: 'sample',
    styles: false,
    steps,
    emit: false,
  })

  expect(result.frames.length).toBe(4)
  const end = result.frames[1]!
  const backOne = result.frames[2]!
  expect(end.totalLines).toBe(backOne.totalLines)
  expect(end.scrollOffset).toBe(end.maxOffset)
  expect(backOne.scrollOffset).toBe(end.scrollOffset - 1)
  expect(result.frames[3]!.action?.buttonKey).toBe('tab-trail')
  expect(result.frames[3]!.selectedTab).toBe('trail')

  // `.length` counts UTF-16 code units rather than terminal cells; allow two units for glyph-width differences.
  for (const frame of result.frames) {
    for (const line of frame.lines) expect(line.text.length).toBeLessThanOrEqual(46 + 2)
  }

  const synthetic = frameFromTree({
    type: 'Box',
    props: { flexDirection: 'column' },
    children: [
      { type: 'Button', props: { key: 'sample-action', label: 'Action', hotkey: 'a' } },
      { type: 'Text', props: { text: 'second' } },
    ],
  }, { surface: 'tui', width: 20, height: 1, offset: 1, styles: true, stepNumber: 1, stepText: 'snapshot' })
  expect(synthetic.totalLines).toBe(2)
  expect(synthetic.scrollOffset).toBe(1)
  expect(synthetic.lines.length).toBe(1)
  expect(synthetic.lines[0]!.text).toBe('second')
})

test('sim reports a missing Button key with valid keys and a fix example', { timeoutMs: 20_000 }, async ($, on) => {
  let message = ''
  try {
    await runSimulation($, on, {
      surface: 'tui',
      width: 46,
      height: 10,
      state: 'sample',
      styles: false,
      steps: parseSteps(['press unknown-button-key']),
      emit: false,
    })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message).toContain('Unknown button key "unknown-button-key"')
  expect(message).toContain('Valid button keys:')
  expect(message).toContain('Example fix: press tab-trail.')
})
