import { expect, test } from 'claude-code/testing'
import { emptySnapshot, startTurn, stripPromptMarkers } from '../hooks/model'

const ROOT = 'F:/work/atlas'
const NOW = 1_800_000_000_000

test('reply wrappers leave the detour suggestion from the real prompt unchanged', () => {
  const plain = startTurn(emptySnapshot('reply-plain', ROOT, NOW), 'btw, quick tangent about caching', NOW + 1)
  const wrapped = startTurn(
    emptySnapshot('reply-wrapped', ROOT, NOW),
    '<!-- reply 4 -->\n> quoted line\n\nbtw, quick tangent about caching',
    NOW + 1,
  )
  const plainSuggestion = plain.suggestions.find(item => item.kind === 'detour')
  const wrappedSuggestion = wrapped.suggestions.find(item => item.kind === 'detour')
  expect(wrappedSuggestion).toMatchObject({ kind: plainSuggestion?.kind, text: plainSuggestion?.text })
})

test('plain and reply-wrapped Atlas commands stay skipped after their prompt event', () => {
  const plain = startTurn(emptySnapshot('reply-command-plain', ROOT, NOW), '/atlas goal x', NOW + 1)
  const wrapped = startTurn(
    emptySnapshot('reply-command-wrapped', ROOT, NOW),
    '<!-- reply -->\n> quoted text\n\n/atlas goal x',
    NOW + 1,
  )
  expect(plain.suggestions).toHaveLength(0)
  expect(wrapped.suggestions).toHaveLength(0)
  expect(plain.events.at(-1)?.text).toBe('/atlas goal x')
  expect(wrapped.events.at(-1)?.text).toBe('/atlas goal x')
})

test('reply quote and separator are removed from the prompt event title', () => {
  const snapshot = startTurn(
    emptySnapshot('reply-title', ROOT, NOW),
    '<!-- reply 4 -->\n> quoted line\n\nmy answer',
    NOW + 1,
  )
  expect(snapshot.events.at(-1)?.text).toBe('my answer')
  expect(snapshot.events.at(-1)?.text.startsWith('<!')).toBe(false)
})

test('cues inside a reply quote do not create suggestions or decisions', () => {
  const snapshot = startTurn(
    emptySnapshot('reply-cues', ROOT, NOW),
    '<!-- reply -->\n> btw, quick tangent about caching\n> We decided to replace the schema.\n> Let\'s go with option A.\n\nPlease review this output.',
    NOW + 1,
  )
  expect(snapshot.suggestions.some(item => item.kind === 'detour' || item.kind === 'return')).toBe(false)
  expect(snapshot.decisions).toHaveLength(0)
  expect(snapshot.events.at(-1)?.text).toBe('Please review this output.')
})

test('a quote line without a reply marker stays in the prompt', () => {
  const text = '> quoted line\n\nmy answer'
  expect(stripPromptMarkers(text)).toBe(text)
  expect(startTurn(emptySnapshot('reply-no-marker', ROOT, NOW), text, NOW + 1).events.at(-1)?.text).toBe(text)
})

test('several reply wrappers are all removed from one prompt', () => {
  const text = '<!-- reply 1 -->\n> first quote\n\nA short answer.\n<!-- reply -->\n> second quote\n\nThen the real question.'
  expect(stripPromptMarkers(text)).toBe('A short answer.\nThen the real question.')
})

test('reply wrappers that leave no body only advance the turn', () => {
  const snapshot = startTurn(emptySnapshot('reply-empty', ROOT, NOW), '<!-- reply -->\n> quoted line\n\n', NOW + 1)
  expect(snapshot.turn).toBe(1)
  expect(snapshot.events).toHaveLength(0)
})

test('injected tagged blocks are dropped from the title and the cues', () => {
  const blocks = [
    '<system-reminder>\nwe decided to use a new database; btw, quick tangent\n</system-reminder>',
    '<local-command-caveat>Caveat: ignore</local-command-caveat>',
    '<cross-session-message from="uds:x" name="Master">btw, quick tangent</cross-session-message>',
  ].join('\n')
  const snapshot = startTurn(emptySnapshot('inject', ROOT, NOW), `${blocks}\nPlease review the caching layer`, NOW + 1)
  expect(snapshot.events.at(-1)?.text).toBe('Please review the caching layer')
  expect(snapshot.suggestions.some(item => item.kind === 'detour')).toBe(false)
  expect(snapshot.decisions).toHaveLength(0)
  expect(stripPromptMarkers(blocks)).toBe('')
})
