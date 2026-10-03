import { activeDecisions, currentTopic, openQuestions, pathOf, resumeHint } from '../model'
import { base, rel } from '../activity'
import type { AtlasSnapshot } from '../../types'
import { action, ago, itemRow, popupModels, sourceName, suggestionRow, topicName, whenLine } from './shared'
import type { ScreenBuilder, ScreenModel, ScreenRow, ScreenSection, ScreenView } from './types'

const explain: Record<string, string> = {
  GOAL: 'What you are trying to do. Only you set it: confirm a suggestion, type one, or explicitly adopt Atlas’s detected aim.',
  'CURRENT PATH': 'Topics from the start of the work to now; the current topic is highlighted. Claude keeps it current.',
  DETOUR: 'A side trip you chose. Return hands Claude a recap of where you left off.',
  'POSSIBLE DETOUR': 'Looks like a side trip. Take it to get a return point, or say it is not one.',
  ACTIVITY: 'What Claude is doing: spinner = running, done, or failed.',
  'WORKING SET': 'Files touched lately: edited and read counts. Click one to point Claude at it.',
  LATEST: 'Newest decisions and questions. Confirm decisions in the Open tab.',
  'RESUME NEXT': 'Where to pick up. Pinned is yours; suggested is Claude’s guess.',
}

function section(key: string, heading: string, rows: ScreenRow[], extra: Partial<ScreenSection> = {}): ScreenSection {
  return { key, heading, explain: explain[heading] ?? heading, rows, ...extra }
}

function goal(snapshot: AtlasSnapshot, view: ScreenView, now: number): ScreenSection {
  const suggestion = [...snapshot.suggestions].reverse().find(item => item.kind === 'goal' || item.kind === 'resume')
  const detected = snapshot.detectedGoal && (!snapshot.goal || snapshot.detectedGoal.text !== snapshot.goal.text) ? snapshot.detectedGoal : null
  const needsObserver = view.mode === 'engine' && detected?.source === 'claude'
  const detail = snapshot.goal
    ? [
        `confirmed: ${snapshot.goal.text}`,
        `set by: ${sourceName(snapshot.goal.source)} · ${ago(now - snapshot.goal.at)} · turn ${snapshot.goal.turn}`,
        ...(detected ? [`Atlas currently reads your aim as: ${detected.text}`] : ['Atlas has no different detected aim.']),
      ]
    : [
        'status: not confirmed',
        ...(detected ? [`Atlas currently reads your aim as: ${detected.text}`] : ['Atlas has not detected an overall aim yet.']),
      ]
  const rows: ScreenRow[] = []
  if (!view.editingGoal) {
    rows.push({
      id: 'goal', key: 'goal-row', kind: 'goal', glyph: 'goal', text: snapshot.goal?.text ?? 'not confirmed yet', tone: 'goal',
      expandable: true, detail, interactive: true,
      actions: [
        ...(needsObserver ? [action('turn-on-goal-observer', 'Turn on', { type: 'open-setup' }, true)] : detected ? [action('use-detected-goal', 'Use this as my goal', { type: 'goal', text: detected.text }, true)] : []),
        action('close-goal', 'Close', { type: 'expand', id: 'goal' }),
      ],
    })
  }
  if (!snapshot.goal && suggestion) rows.push(suggestionRow(snapshot, suggestion, view))
  return section('goal', 'GOAL', rows, {
    tone: 'goal',
    actions: snapshot.goal && !snapshot.detour && !view.editingGoal ? [action('edit-goal', 'change', { type: 'edit-goal' })] : [],
    input: view.editingGoal || (!snapshot.goal && !suggestion) ? { key: 'goal-input', label: '◎ ', placeholder: snapshot.goal ? 'new goal, Enter to confirm' : 'type your goal, Enter to confirm', submitLabel: 'set' } : undefined,
  })
}

function path(snapshot: AtlasSnapshot, view: ScreenView): ScreenSection {
  const chain = pathOf(snapshot)
  const rows = chain.map((topic, index): ScreenRow => {
    const current = index === chain.length - 1
    const dim = view.mode === 'engine' && topic.source === 'claude'
    return {
      id: topic.id, key: `path-${topic.id}`, kind: 'topic', glyph: current ? 'currentTopic' : topic.kind !== 'main' ? 'detour' : undefined,
      text: topic.title, meta: topic.kind === 'main' ? undefined : topic.kind, source: sourceName(topic.source), tone: topic.kind === 'main' ? (current ? 'path' : undefined) : 'detour',
      dim, bold: current && !dim, fresh: snapshot.fresh.includes(topic.id), depth: index, live: 'path', interactive: false,
    }
  })
  const left = snapshot.topics.filter(topic => topic.status === 'left').length
  const needsObserver = view.mode === 'engine' && chain.some(topic => topic.source === 'claude')
  return section('path', 'CURRENT PATH', rows, { tone: needsObserver ? undefined : 'path', dim: needsObserver, count: left ? `${left} earlier` : undefined, empty: 'Topics appear as the conversation moves.' })
}

function detour(snapshot: AtlasSnapshot, view: ScreenView, now: number): ScreenSection | null {
  const active = snapshot.detour
  const possible = [...snapshot.suggestions].reverse().find(item => item.kind === 'detour')
  const returned = [...snapshot.suggestions].reverse().find(item => item.kind === 'return')
  if (!active && !possible) return null
  if (active) {
    const checkpoint = snapshot.checkpoints.find(item => item.id === active.departure.checkpointId)
    const found = [active.outcomes.length ? `${active.outcomes.length} kept` : '', active.exclusions.length ? `${active.exclusions.length} excluded` : ''].filter(Boolean).join(' · ')
    const rows: ScreenRow[] = [{ id: active.id, key: `detour-${active.id}`, kind: 'detour', glyph: 'detour', text: active.reason, meta: `returns to ${active.departure.topic ?? active.departure.goal ?? 'the main path'}${checkpoint ? ` · ${checkpoint.name}` : ''}`, tone: 'detour', right: ago(now - active.at),
      actions: [action('return', 'Return', { type: 'return' }, true), action('promote', 'Make it the goal', { type: 'promote' }), ...(returned ? [action(`stay-${returned.id}`, 'Stay', { type: 'dismiss', id: returned.id })] : [])],
      detail: [
        ...(found ? [found] : []),
        ...(returned ? [`${returned.why ?? 'Looks like you are heading back'}`] : []),
        `departure: ${active.departure.topic ?? active.departure.goal ?? 'not recorded'}`,
        ...(checkpoint ? [`checkpoint: ${checkpoint.name}`] : []),
      ], expandable: true, interactive: true }]
    return section('detour', 'DETOUR', rows, { tone: 'detour' })
  }
  const dim = possible?.source === 'claude' && view.mode === 'engine'
  return section('possible-detour', 'POSSIBLE DETOUR', possible ? [{ ...suggestionRow(snapshot, possible, view), dim, actions: dim ? [action('turn-on-detour-observer', 'Turn on', { type: 'open-setup' }, true)] : suggestionRow(snapshot, possible, view).actions }] : [], { tone: dim ? undefined : 'detour', dim, empty: possible ? undefined : 'No possible detour.' })
}

function activity(snapshot: AtlasSnapshot, now: number): ScreenSection {
  const rows = snapshot.activity.slice(-6).map((item): ScreenRow => ({
    id: item.id, key: `activity-${item.id}`, kind: 'activity', text: `${item.agent ? `${item.agent} · ` : ''}${item.label}`,
    right: item.state === 'running' ? undefined : ago(now - (item.endedAt ?? item.at)), tone: item.state === 'failed' ? 'fail' : item.kind === 'edit' ? 'write' : item.kind === 'read' || item.kind === 'search' ? 'read' : item.kind === 'test' ? 'ok' : item.kind === 'agent' ? 'checkpoint' : undefined,
    glyph: item.state === 'running' ? undefined : item.state === 'failed' ? 'fail' : 'ok', dim: item.state === 'done', bold: item.state === 'running', live: 'activity', interactive: false,
  }))
  const running = snapshot.activity.filter(item => item.state === 'running').length
  return section('activity', 'ACTIVITY', rows, { count: running ? `${running} running` : undefined, empty: 'Waiting for Claude to work.' })
}

function fileRow(snapshot: AtlasSnapshot, file: AtlasSnapshot['files'][number], now: number, full: boolean): ScreenRow {
  const name = full ? rel(file.path, snapshot.root) : base(file.path)
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  return { id: file.path, key: `sel-${full ? 'ef' : 'f'}-${file.path}`, kind: 'file', glyph: file.lastOp === 'write' ? 'editedFile' : 'readFile', text: name,
    meta: `${plural(file.writes, 'edit')} · ${plural(file.reads, 'read')}`, right: ago(now - file.at), tone: file.lastOp === 'write' ? 'write' : 'read',
    expandable: true, detail: ['kind: working-set file', `last operation: ${file.lastOp}`, `counts: ${file.reads} read · ${file.writes} written`, whenLine(now, file.at, file.turn), `path: ${rel(file.path, snapshot.root)}`], interactive: true }
}

function next(snapshot: AtlasSnapshot, view: ScreenView): ScreenSection | null {
  const hint = resumeHint(snapshot)
  if (!hint) return null
  const suggestion = [...snapshot.suggestions].reverse().find(item => item.kind === 'next')
  const needsObserver = Boolean(suggestion && suggestion.source === 'claude' && view.mode === 'engine')
  return section('next', 'RESUME NEXT', [{ id: 'next', key: 'next-row', kind: 'next', glyph: 'next', text: hint.text, source: hint.source, tone: needsObserver ? undefined : 'goal', dim: needsObserver, actions: needsObserver ? [action('turn-on-next-observer', 'Turn on', { type: 'open-setup' }, true)] : suggestion ? [action(`pin-${suggestion.id}`, 'Pin as next step', { type: 'confirm', id: suggestion.id }, true), action(`nop-${suggestion.id}`, 'Dismiss', { type: 'dismiss', id: suggestion.id })] : [], interactive: false }], { tone: needsObserver ? undefined : 'goal', dim: needsObserver, count: needsObserver ? 'Needs the Claude observer · /atlas observer claude' : hint.source })
}

export const buildMap: ScreenBuilder = (snapshot, view, now): ScreenModel => {
  const decisions = activeDecisions(snapshot).slice(-2)
  const questions = openQuestions(snapshot).slice(-2)
  const sections = [goal(snapshot, view, now), path(snapshot, view), detour(snapshot, view, now), activity(snapshot, now)]
  const recentFiles = [...snapshot.files].sort((a, b) => b.at - a.at).slice(0, 5)
  if (recentFiles.length) sections.push(section('files', 'WORKING SET', recentFiles.map(file => fileRow(snapshot, file, now, false)), { count: `${snapshot.files.length} files` }))
  if (decisions.length || questions.length) sections.push(section('latest', 'LATEST', [...decisions.map(item => itemRow(snapshot, item, now, view, false)), ...questions.map(item => itemRow(snapshot, item, now, view, false))], { right: 'confirm in Open' }))
  const resume = next(snapshot, view)
  if (resume) sections.push(resume)
  return { tab: 'map', sections: sections.filter((value): value is ScreenSection => Boolean(value)), popups: popupModels(snapshot, view, now) }
}
