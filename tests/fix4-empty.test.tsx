import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { emptySnapshot } from '../hooks/model'
import { buildEvidence } from '../hooks/screens/evidence'
import { buildMap } from '../hooks/screens/map'
import { buildOpen } from '../hooks/screens/open'
import type { AtlasTab } from '../types'
import { SAMPLE_NOW, SAMPLE_ROOT, SAMPLE_SESSION, sampleSnapshot } from './fixtures/sample'

const ROOT = 'F:/work/atlas'
const NOW = 1_800_000_000_000
const PROPS = {
  title: 'Atlas',
  isFocused: true,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 100 },
  view: {},
} as const

function setup(on: On, populated = false) {
  mock.clock(on, { now: populated ? SAMPLE_NOW : NOW })
  mock.store(on, populated
    ? { setup: { observer: 'claude', at: SAMPLE_NOW }, [`session:${SAMPLE_SESSION}`]: sampleSnapshot() }
    : { setup: { observer: 'claude', at: NOW } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: populated ? SAMPLE_SESSION : 'fix4-empty-session' }))
  on('session.root', () => ({ value: populated ? SAMPLE_ROOT : ROOT }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__conversation-atlas__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { ok: true } }))
}

for (const surface of ['terminal', 'desktop'] as const) {
  for (const bodyColumns of [46, 80]) {
    test(`${surface} ${bodyColumns}: draw all empty sections`, async ($, on) => {
      setup(on)
      await $.session.start({ cwd: ROOT, surface, isInteractive: true })
      const ui = await $.ui.mount({
        plugin: 'conversation-atlas',
        surface,
        component: 'Pane',
        requestId: 'atlas',
        props: { ...PROPS, bodyColumns },
      })
      const sections: { tab: AtlasTab; values: string[] }[] = [
        {
          tab: 'map',
          values: [
            'GOAL', 'type your goal, Enter to confirm', 'CURRENT PATH', 'POSSIBLE DETOUR', 'No possible detour.', 'ACTIVITY', 'WORKING SET',
            'No files touched yet.', 'LATEST', 'No decisions or questions yet.',
            'RESUME NEXT', 'Nothing to pick up yet.',
          ],
        },
        {
          tab: 'open',
          values: [
            'NEEDS YOUR CALL', 'Nothing waiting for your call.', 'OBSERVED DECISIONS',
            'No decisions heard yet.', 'OPEN QUESTIONS', 'No open questions.',
          ],
        },
        {
          tab: 'evidence',
          values: [
            'CHECKPOINTS', 'SETTLED (LEDGER)', 'RESOLVED', 'No answered questions yet.',
            'DETOURS', 'No past detours.', 'EARLIER SESSIONS', 'No earlier sessions found.',
            'FILES', 'No files touched yet.',
          ],
        },
      ]
      for (const section of sections) {
        if (section.tab !== 'map') await ui.press({ key: `tab-${section.tab}` })
        const drawn = JSON.stringify(await ui.drawn())
        for (const value of section.values) expect(drawn).toContain(value)
        expect(drawn).not.toContain('Nothing waiting for you. Observations')
        expect(drawn).not.toContain('"key":"empty"')
      }
      await ui.unmount()
    })
  }
}

test('populated sample draws none of the new empty lines', async ($, on) => {
  setup(on, true)
  await $.session.start({ cwd: SAMPLE_ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'conversation-atlas',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'atlas',
    props: { ...PROPS, bodyColumns: 80 },
  })
  // The sample has no detour history or earlier sessions, so those two empties legitimately show.
  const emptyLines = [
    'No files touched yet.',
    'No decisions or questions yet.',
    'Nothing to pick up yet.',
    'Nothing waiting for your call.',
    'No decisions heard yet.',
    'No findings from this detour yet.',
    'No open questions.',
    'No answered questions yet.',
  ]
  for (const tab of ['map', 'open', 'evidence'] as const) {
    if (tab !== 'map') await ui.press({ key: `tab-${tab}` })
    const drawn = JSON.stringify(await ui.drawn())
    for (const line of emptyLines) expect(drawn).not.toContain(line)
  }
  await ui.unmount()
})

test('empty screen models list sections in order', () => {
  const snapshot = emptySnapshot('fix4-model', ROOT, NOW)
  const view = {
    setup: false,
    tab: 'map' as const,
    refs: {},
    nextRef: 1,
    editingGoal: false,
    legend: false,
    popup: null,
    popupScroll: 0,
    legendScroll: 0,
    scroll: 0,
    trailNewest: true,
    trailView: 'story' as const,
    expanded: null,
    expandedScroll: 0,
    fullConfirm: null,
    mode: 'claude' as const,
  }
  const map = buildMap(snapshot, view, NOW)
  expect(map.sections.map(section => section.heading)).toEqual([
    'GOAL', 'CURRENT PATH', 'POSSIBLE DETOUR', 'ACTIVITY', 'WORKING SET', 'LATEST', 'RESUME NEXT',
  ])
  expect(map.sections.find(section => section.key === 'files')?.count).toBe('0 files')
  expect(map.sections.find(section => section.key === 'next')?.count).toBeUndefined()
  const open = buildOpen(snapshot, { ...view, tab: 'open' }, NOW)
  expect(open.sections.map(section => section.heading)).toEqual([
    'NEEDS YOUR CALL', 'OBSERVED DECISIONS', 'OPEN QUESTIONS',
  ])
  expect(open.sections.map(section => section.count)).toEqual(['0', '0', '0'])
  expect(buildOpen({ ...snapshot, detour: {
    id: 'detour',
    reason: 'Review a side path',
    at: NOW,
    turn: 0,
    topicId: null,
    departure: { goal: null, topic: null, nextStep: null, checkpointId: null, decisions: [] },
    outcomes: [],
    exclusions: [],
    status: 'active',
    endedAt: null,
  } }, { ...view, tab: 'open' }, NOW).sections[1]).toMatchObject({
    heading: 'DETOUR FINDINGS',
    empty: 'No findings from this detour yet.',
    count: '0',
  })
  const evidence = buildEvidence(snapshot, { ...view, tab: 'evidence' }, NOW)
  expect(evidence.sections.map(section => section.heading)).toEqual([
    'CHECKPOINTS', 'SETTLED (LEDGER)', 'RESOLVED', 'DETOURS', 'EARLIER SESSIONS', 'FILES',
  ])
  expect(evidence.sections.filter(section => ['detours', 'recall', 'files'].includes(section.key))
    .map(section => section.count)).toEqual(['0', '0', '0'])
})
