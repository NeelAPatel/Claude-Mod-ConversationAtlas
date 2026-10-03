import {
  addCheckpoint,
  confirmSuggestion,
  emptySnapshot,
  endActivity,
  mark,
  observe,
  recordDecision,
  reportHandoff,
  setItemStatus,
  setNextStep,
  setRecall,
  startActivity,
  startHandoff,
  startTurn,
  touchFile,
} from '../../hooks/model'
import type { AtlasSnapshot } from '../../types'

export const SAMPLE_ROOT = 'F:/work/atlas'
export const SAMPLE_NOW = 1_800_000_000_000
export const SAMPLE_SESSION = 'golden-sample-session'

/**
 * One deliberately busy, but deterministic, state for every visual snapshot.
 * The state is assembled through the model reducers so the fixture exercises
 * the same invariants as a live session rather than hand-writing internals.
 */
export function sampleSnapshot(): AtlasSnapshot {
  let s = emptySnapshot(SAMPLE_SESSION, SAMPLE_ROOT, SAMPLE_NOW - 120_000)

  s = startTurn(
    s,
    'Build a dependable Conversation Atlas pane for long sessions. Keep the map readable while the work grows.',
    SAMPLE_NOW - 110_000,
  )
  const goalSuggestion = s.suggestions.find(item => item.kind === 'goal')
  s = confirmSuggestion(s, goalSuggestion?.id ?? '', SAMPLE_NOW - 108_000)
  s = setNextStep(s, 'Review the fixed pane sample and approve the visual boundary.', SAMPLE_NOW - 106_000)

  s = observe(s, { topic: 'Atlas foundations' }, SAMPLE_NOW - 104_000)
  s = observe(s, { topic: 'Map rendering', shift: 'subtopic' }, SAMPLE_NOW - 102_000)
  s = observe(s, { topic: 'Desktop parity', shift: 'possible-detour', why: 'Compare native labels before returning.' }, SAMPLE_NOW - 100_000)
  s = observe(s, { topic: 'Color tokens', shift: 'subtopic' }, SAMPLE_NOW - 98_000)
  s = observe(s, { goal: 'Polish the desktop surface', next: 'Check whether the native controls stay legible.' }, SAMPLE_NOW - 96_000)

  s = observe(
    s,
    {
      decisions: ['Keep renderers pure', 'Use text goldens for visual review'],
      questions: ['Should the popup keep its compact width?', 'Which surface gets the first manual check?'],
    },
    SAMPLE_NOW - 94_000,
  )
  const firstDecision = s.decisions[0]
  if (firstDecision) s = setItemStatus(s, firstDecision.id, 'settled', SAMPLE_NOW - 92_000)
  const firstQuestion = s.questions[0]
  if (firstQuestion) s = observe(s, { resolved: [firstQuestion.text] }, SAMPLE_NOW - 90_000)

  s = touchFile(s, 'hooks/view.tsx', 'read', SAMPLE_NOW - 88_000)
  s = touchFile(s, 'hooks/view.tsx', 'write', SAMPLE_NOW - 86_000, 'Codex')
  s = touchFile(s, 'tests/atlas.test.tsx', 'read', SAMPLE_NOW - 84_000)
  s = touchFile(s, 'tests/golden.test.tsx', 'write', SAMPLE_NOW - 82_000, 'Codex')

  s = mark(s, 'Baseline captured', SAMPLE_NOW - 80_000)
  s = addCheckpoint(s, 'Green visual test run', 'tests', 'claude plugin test .', SAMPLE_NOW - 78_000)
  s = addCheckpoint(s, 'Review commit abc1234', 'commit', 'abc1234', SAMPLE_NOW - 76_000)
  s = addCheckpoint(s, 'Pane snapshot milestone', 'claude', 'The sample covers every evidence family.', SAMPLE_NOW - 74_000)

  s = startActivity(s, {
    id: 'activity-running',
    kind: 'agent',
    label: 'Reviewing the golden diff',
    at: SAMPLE_NOW - 72_000,
    agent: 'Codex',
  })
  s = startActivity(s, {
    id: 'activity-done',
    kind: 'test',
    label: 'claude plugin test .',
    at: SAMPLE_NOW - 70_000,
    agent: null,
  })
  s = endActivity(s, 'activity-done', 'done', SAMPLE_NOW - 68_000)
  s = startActivity(s, {
    id: 'activity-failed',
    kind: 'bash',
    label: 'Scratch glyph check',
    at: SAMPLE_NOW - 66_000,
    agent: null,
  })
  s = endActivity(s, 'activity-failed', 'failed', SAMPLE_NOW - 64_000)

  s = startHandoff(s, 'Golden review', 'Codex', 'atlas-goldens.md', `${SAMPLE_ROOT}/.claude/atlas/handoffs/atlas-goldens.md`, SAMPLE_NOW - 62_000)
  const reported = s.handoffs.at(-1)
  s = reportHandoff(s, 'Initial snapshot review is ready', SAMPLE_NOW - 60_000, 'Codex', reported?.id, '18 tests pass', ['tests/golden/terminal-46-map.txt'])
  s = startHandoff(s, 'Manual import check', 'Claude', null, null, SAMPLE_NOW - 58_000)

  s = setRecall(s, [
    {
      id: 'earlier-atlas-session',
      source: 'atlas',
      sessionId: 'earlier-session-2026',
      at: SAMPLE_NOW - 86_400_000,
      goal: 'Ship the first Atlas pane',
      nextStep: 'Verify recovery labels',
      detour: null,
      topic: 'Recovery',
      decisions: ['Keep recovery explicit'],
    },
  ])

  // The newest three trail rows are intentionally: milestone, commit, long prompt.
  // That makes the requested third Trail event popup deterministic.
  s = startTurn(
    s,
    'Review the visual regression boundary for the Atlas pane carefully. Preserve the existing action semantics while checking the fixed sample state.\n- compare terminal layout\n- compare desktop labels\n- keep style annotations\n- inspect popup geometry\n- verify setup screen\n- record the final diff\n- do not broaden the scope',
    SAMPLE_NOW - 4_000,
  )
  s = addCheckpoint(s, 'Post-prompt commit', 'commit', 'def5678', SAMPLE_NOW - 2_000)
  s = addCheckpoint(s, 'Post-prompt milestone', 'claude', 'Long prompt retained for the Trail popup.', SAMPLE_NOW - 1_000)
  return s
}
