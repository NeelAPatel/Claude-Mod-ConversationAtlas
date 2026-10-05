import { expect, test } from 'claude-code/testing'
import { emptySnapshot, observe, setGoal } from '../hooks/model'
import { buildMap } from '../hooks/screens/map'

const ROOT = 'F:/work/atlas'
const NOW = 1_800_000_000_000
const VIEW = {
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
  expanded: 'goal',
  expandedScroll: 0,
  fullConfirm: null,
  mode: 'claude' as const,
}

function detectedGoalLabel(detected: string, previousGoal: string | null): string | undefined {
  let snapshot = setGoal(emptySnapshot(`detected-${detected}`, ROOT, NOW), 'Current aim', 'person', NOW + 1)
  if (previousGoal) snapshot = setGoal(snapshot, previousGoal, 'person', NOW + 2)
  snapshot = setGoal(snapshot, 'Current aim', 'person', NOW + 3)
  snapshot = observe(snapshot, { goal: detected }, NOW + 4)
  const rows = buildMap(snapshot, VIEW, NOW + 5).sections[0]?.rows
  const detectedAction = rows?.[0]?.actions?.find(action => action.key === 'use-detected-goal')
  return detectedAction?.label
}

test('a detected goal from history says Switch back regardless of case and surrounding spaces', () => {
  expect(detectedGoalLabel('  CURRENT AIM  ', 'Current aim')).toBe('Switch back')
})

test('a detected goal absent from history keeps the adoption wording', () => {
  expect(detectedGoalLabel('A new aim', null)).toBe('Use this as my goal')
})
