// Shows suggestions, observed decisions and open questions that need a user action. Pure; no `$`.

import { openQuestions } from '../model'
import type { AtlasSnapshot } from '../../types'
import { filterHiddenRows, itemRow, suggestionRow } from './shared'
import type { ScreenBuilder, ScreenModel, ScreenRow, ScreenSection } from './types'

const explain: Record<string, string> = {
  'NEEDS YOUR CALL': 'Suggestions from Claude or your wording. Nothing changes until you press.',
  'OBSERVED DECISIONS': 'Things that sounded decided. Confirm means true from now on; Drop means it was not a decision. ! = major, · = minor decision; auto uses text cues, you means your weight toggle.',
  'DETOUR FINDINGS': 'Keep is an outcome you take back; Exclude is explored, do not rely on it.',
  'OPEN QUESTIONS': 'Unanswered questions from Claude or you. Confirm when answered; Drop if it no longer matters.',
}
const help: Record<string, string[]> = {
  'NEEDS YOUR CALL': [
    'Suggestions from Claude or your wording that need your choice.',
    '○ marks goal, next and other suggestions; ↳/↩ mark detour and return.',
    'Press the primary action to confirm; secondary actions dismiss or stay.',
    'Nothing changes until you press.',
  ],
  'OBSERVED DECISIONS': [
    '! after a decision icon means major; · means minor. Expand to Make major or Make minor; auto uses text cues, you means your choice.',
    'Conclusions Atlas heard but you have not settled.',
    '◇ means observed, not yet true from now on.',
    'Confirm keeps it as knowledge; Drop removes it from the active list.',
    'Expand a row for source, time, topic and Chat ⇒.',
  ],
  'DETOUR FINDINGS': [
    'Observed decisions found while a detour is active.',
    'Keep takes an outcome back to the main path.',
    'Exclude records that the detour explored but should not guide work.',
    'The detour still needs Return or Make it the goal.',
  ],
  'OPEN QUESTIONS': [
    'Questions waiting for an answer.',
    '? marks open; ✓ marks resolved.',
    'Confirm marks it answered; Drop removes it. Expand for the source.',
    'Reopen a resolved question if it becomes active again.',
  ],
  OPEN: [
    'Nothing is waiting for your decision right now.',
    'New suggestions, decisions and questions land in this tab.',
    'Use the heading notes and Legend to learn the glyphs.',
  ],
}

function section(key: string, heading: string, rows: ScreenRow[], extra: Partial<ScreenSection> = {}): ScreenSection {
  return { key, heading, explain: explain[heading] ?? heading, help: help[heading] ?? [explain[heading] ?? heading], rows, ...extra }
}

export const buildOpen: ScreenBuilder = (snapshot, view, now): ScreenModel => {
  const observed = snapshot.decisions.filter(item => item.status === 'observed')
  const questions = openQuestions(snapshot)
  const sections: ScreenSection[] = []
  if (snapshot.suggestions.length)
    sections.push(
      section(
        'suggestions',
        'NEEDS YOUR CALL',
        snapshot.suggestions
          .slice()
          .reverse()
          .map(item => suggestionRow(snapshot, item, view, now, true)),
        { tone: 'goal', count: `${snapshot.suggestions.length}` },
      ),
    )
  if (observed.length)
    sections.push(
      section(
        'observed',
        snapshot.detour && observed.some(item => item.at >= (snapshot.detour?.at ?? 0)) ? 'DETOUR FINDINGS' : 'OBSERVED DECISIONS',
        observed
          .slice()
          .reverse()
          .map(item => itemRow(snapshot, item, now, view, true)),
        { tone: 'decision', count: `${observed.length}` },
      ),
    )
  if (questions.length)
    sections.push(
      section(
        'questions',
        'OPEN QUESTIONS',
        questions
          .slice()
          .reverse()
          .map(item => itemRow(snapshot, item, now, view, true)),
        { tone: 'question', count: `${questions.length}` },
      ),
    )
  if (!sections.length)
    sections.push(
      section('empty', 'OPEN', [
        {
          id: 'empty',
          key: 'empty-open',
          kind: 'text',
          text: 'Nothing waiting for you. Observations that need a yes or no land here.',
          dim: true,
        },
      ]),
    )
  return filterHiddenRows({ tab: 'open', sections }, view.hidden ?? [])
}
