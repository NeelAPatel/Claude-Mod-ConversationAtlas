// Shows suggestions, observed decisions and open questions that need a user action. Pure; no `$`.

import { openQuestions } from '../model'
import type { AtlasSnapshot } from '../../types'
import { itemRow, popupModels, suggestionRow } from './shared'
import type { ScreenBuilder, ScreenModel, ScreenRow, ScreenSection } from './types'

const explain: Record<string, string> = {
  'NEEDS YOUR CALL': 'Suggestions from Claude or your wording. Nothing changes until you press.',
  'OBSERVED DECISIONS': 'Things that sounded decided. Settle means true from now on; Drop means it was not a decision.',
  'DETOUR FINDINGS': 'Keep is an outcome you take back; Exclude is explored, do not rely on it.',
  'OPEN QUESTIONS': 'Unanswered questions from Claude or you. Mark them resolved when answered.',
}

function section(key: string, heading: string, rows: ScreenRow[], extra: Partial<ScreenSection> = {}): ScreenSection {
  return { key, heading, explain: explain[heading] ?? heading, rows, ...extra }
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
          .map(item => suggestionRow(snapshot, item, view)),
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
  return { tab: 'open', sections, popups: popupModels(snapshot, view, now) }
}
