// Shows the current goal, observed path, detours, activity and resume cues. Pure; no `$`.

import { activeDecisions, focusedGoal, goalSuggestions, openQuestions, pathOf, resumeHint } from '../model'
import { base, rel } from '../activity'
import type { AtlasSnapshot } from '../../types'
import { action, ago, filterHiddenRows, itemRow, sourceName, suggestionRow, topicName, whenLine } from './shared'
import type { ScreenBuilder, ScreenModel, ScreenRow, ScreenSection, ScreenView } from './types'

const explain: Record<string, string> = {
  GOAL: 'What you are trying to do. Only you set it. auto means Atlas picked it; ✦ after the icon marks this turn’s focus.',
  'CURRENT PATH': 'Topics from the start of the work to now; detour branches show where the main path paused. Claude keeps it current.',
  DETOUR: 'A side trip you chose, with its departure and return target.',
  'POSSIBLE DETOUR': 'Looks like a side trip. Take it to get a return point, or say it is not one.',
  ACTIVITY: 'What Claude is doing: spinner = running, done, or failed.',
  'WORKING SET': 'Files touched lately: edited and read counts. Click one to point Claude at it.',
  LATEST: 'Newest decisions and questions. Confirm decisions in the Open tab.',
  'RESUME NEXT': 'Where to pick up. Pinned is yours; suggested is Claude’s guess.',
}
const help: Record<string, string[]> = {
  GOAL: [
    'Your confirmed destination for this session.',
    'Only you set it: confirm a suggestion, type one, or adopt a detected aim.',
    '◎ is confirmed; ○ is a suggestion waiting for your press.',
    'auto: picked by Atlas until you confirm or drop it.',
    '✦ after the goal icon marks the goal this turn is about; it moves after two consecutive observed turns on another topic.',
    'Switch to this confirms an alternative as your goal.',
    'Expand the goal row for its source and the action to use a detected aim.',
  ],
  'CURRENT PATH': [
    'Observed topics from the start of this work to now, including branches.',
    '↳ marks a detour branch; ↳ left here marks where the main path paused.',
    'return: n back shows how many path levels the branch will return.',
    'A dim italic branch is an unconfirmed suggestion until you press Take detour.',
    'The path is read-only; Claude keeps it current when observer mode is on.',
    'Claude-sourced rows dim in engine-only mode.',
  ],
  DETOUR: [
    'A side trip you explicitly chose from the main path.',
    'Expand From or Detour for its checkpoint, timing, return target and findings.',
    'Return sends one recap to Claude with your next message.',
    'Make it the goal to promote this work and keep its history.',
  ],
  'POSSIBLE DETOUR': [
    'Atlas thinks the current topic may be a side trip.',
    '↳ marks the suggestion; Take detour records a return point.',
    'Choose Not a detour to leave the main path unchanged.',
    'No observation becomes intent until you press an action.',
  ],
  ACTIVITY: [
    'Engine and agent work observed during this session.',
    '✓ means done; ✗ means failed; a live row is still running.',
    'Edited files use ✎; reads use ·; times at right are recent.',
    'This evidence never changes your goal or decisions.',
  ],
  'WORKING SET': [
    'Files touched lately, with edited and read counts.',
    '✎ means edited; · means read; the counts show e/r activity.',
    'Press a file to inspect its path, operation and timing.',
    'Chat ⇒ points Claude at a file only when you keep its chip.',
  ],
  LATEST: [
    'The newest observed decisions and questions.',
    '◇ is heard but unsettled; ? is an open question.',
    'Use the Open tab to confirm decisions or review questions.',
    'These rows are observations until you take an action.',
  ],
  'RESUME NEXT': [
    'Where Atlas thinks work should pick up.',
    '▸ is a suggested next step; pinned means you chose it.',
    'Press Pin as next step to make it yours.',
    'Dismiss removes the suggestion without changing the goal.',
  ],
}

function section(key: string, heading: string, rows: ScreenRow[], extra: Partial<ScreenSection> = {}): ScreenSection {
  return { key, heading, explain: explain[heading] ?? heading, help: help[heading] ?? [explain[heading] ?? heading], rows, ...extra }
}

function goal(snapshot: AtlasSnapshot, view: ScreenView, now: number): ScreenSection {
  const suggestion = [...snapshot.suggestions].reverse().find(item => item.kind === 'goal' || item.kind === 'resume')
  const alternatives = goalSuggestions(snapshot)
  const focus = focusedGoal(snapshot)
  const detected =
    snapshot.detectedGoal && (!snapshot.goal || snapshot.detectedGoal.text !== snapshot.goal.text) ? snapshot.detectedGoal : null
  const needsObserver = view.mode === 'engine' && detected?.source === 'claude'
  const detail = snapshot.goal
    ? [
        `confirmed: ${snapshot.goal.text}`,
        `set by: ${sourceName(snapshot.goal.source)} · ${ago(now - snapshot.goal.at)} · turn ${snapshot.goal.turn}`,
        ...(detected ? [`Atlas currently reads your aim as: ${detected.text}`] : ['Atlas has no different detected aim.']),
        ...(alternatives.length ? ['auto: picked by Atlas until you confirm or drop it'] : []),
        ...(snapshot.detour && alternatives.length ? ['Return from the detour (or make it the goal) before changing the goal.'] : []),
      ]
    : [
        'status: not confirmed',
        ...(detected ? [`Atlas currently reads your aim as: ${detected.text}`] : ['Atlas has not detected an overall aim yet.']),
      ]
  const rows: ScreenRow[] = []
  // No confirmed goal means no goal row: an unset goal must not read as one set to "not confirmed yet".
  if (snapshot.goal && !view.editingGoal) {
    const suggestedGoals: ScreenRow[] = alternatives.map((text, index) => ({
      id: `goal-alternative-${index}`,
      key: `goal-alternative-${index}`,
      kind: 'goal',
      glyph: 'suggestion',
      marker: focus === text ? '✦' : undefined,
      text,
      meta: 'auto',
      tone: 'goal',
      detail: ['auto: picked by Atlas until you confirm or drop it'],
      actions: [action(`switch-goal-${index}`, 'Switch to this', { type: 'goal', text }, true)],
    }))
    rows.push({
      id: 'goal',
      key: 'goal-row',
      kind: 'goal',
      glyph: 'goal',
      marker: focus === snapshot.goal.text ? '✦' : undefined,
      text: snapshot.goal.text,
      tone: 'goal',
      expandable: true,
      detail,
      suggestedGoals,
      right: view.expanded !== 'goal' && alternatives.length ? `· ${alternatives.length} suggestions` : undefined,
      interactive: true,
      actions: [
        ...(needsObserver
          ? [action('turn-on-goal-observer', 'Turn on', { type: 'open-setup' }, true)]
          : detected
            ? [action('use-detected-goal', 'Use this as my goal', { type: 'goal', text: detected.text }, true)]
            : []),
        action('close-goal', '✕', { type: 'expand', id: 'goal' }),
      ],
    })
  }
  if (!snapshot.goal && suggestion) rows.push(suggestionRow(snapshot, suggestion, view, now))
  return section('goal', 'GOAL', rows, {
    tone: 'goal',
    empty: 'No goal yet. Type one below, or use a suggestion.',
    actions: snapshot.goal && !snapshot.detour && !view.editingGoal ? [action('edit-goal', 'Edit', { type: 'edit-goal' })] : [],
    input:
      view.editingGoal || (!snapshot.goal && !suggestion)
        ? {
            key: 'goal-input',
            label: '◎ ',
            placeholder: snapshot.goal ? 'new goal, Enter to confirm' : 'type your goal, Enter to confirm',
            submitLabel: 'set',
          }
        : undefined,
  })
}

function path(snapshot: AtlasSnapshot, view: ScreenView): ScreenSection {
  const chain = pathOf(snapshot)
  const possible = [...snapshot.suggestions].reverse().find(item => item.kind === 'detour')
  const branchId = snapshot.detour?.topicId ?? possible?.topicId ?? null
  const branchIndex = branchId ? chain.findIndex(topic => topic.id === branchId) : -1
  const departureIndex = branchIndex > 0 ? branchIndex - 1 : -1
  const returnDepth = departureIndex >= 0 ? chain.length - 1 - departureIndex : 0
  const rows = chain.map((topic, index): ScreenRow => {
    const current = index === chain.length - 1
    const dim = view.mode === 'engine' && topic.source === 'claude'
    const branch = branchIndex >= 0 && index >= branchIndex
    const possibleBranch = branch && topic.kind === 'possible-detour' && !snapshot.detour
    const departure = index === departureIndex
    return {
      id: topic.id,
      key: `path-${topic.id}`,
      kind: 'topic',
      glyph: branch ? 'detour' : current ? 'currentTopic' : undefined,
      text: topic.title,
      meta: topic.kind === 'main' ? undefined : possibleBranch ? 'unconfirmed' : topic.kind,
      source: sourceName(topic.source),
      tone: branch ? 'detour' : current ? 'path' : undefined,
      dim: dim || possibleBranch,
      bold: current && !dim && !possibleBranch,
      italic: possibleBranch,
      fresh: snapshot.fresh.includes(topic.id),
      depth: index,
      right: departure
        ? '↳ left here'
        : branch && index === branchIndex && returnDepth > 0
          ? `return: ${returnDepth} back`
          : undefined,
      live: 'path',
      interactive: false,
    }
  })
  const left = snapshot.topics.filter(topic => topic.status === 'left').length
  const needsObserver = view.mode === 'engine' && chain.some(topic => topic.source === 'claude')
  return section('path', 'CURRENT PATH', rows, {
    tone: needsObserver ? undefined : 'path',
    dim: needsObserver,
    count: left ? `${left} earlier` : undefined,
    empty: 'Topics appear as the conversation moves.',
  })
}

function detour(snapshot: AtlasSnapshot, view: ScreenView, now: number): ScreenSection | null {
  const active = snapshot.detour
  const possible = [...snapshot.suggestions].reverse().find(item => item.kind === 'detour')
  const returned = [...snapshot.suggestions].reverse().find(item => item.kind === 'return')
  if (!active && !possible) return null
  if (active) {
    const checkpoint = snapshot.checkpoints.find(item => item.id === active.departure.checkpointId)
    const chain = pathOf(snapshot)
    const branchIndex = active.topicId ? chain.findIndex(topic => topic.id === active.topicId) : -1
    const departureIndex = branchIndex > 0 ? branchIndex - 1 : -1
    const returnDepth = departureIndex >= 0 ? chain.length - 1 - departureIndex : 0
    const departure = active.departure.topic ?? active.departure.goal ?? 'the main path'
    const topic = topicName(snapshot, active.topicId) ?? active.reason
    const returnTarget = active.departure.topic ?? active.departure.goal ?? 'the main path'
    const details = [
      `text: ${active.reason}`,
      `departure: ${departure}`,
      `checkpoint: ${checkpoint?.name ?? 'not recorded'}`,
      whenLine(now, active.at, active.turn),
      `why: ${active.reason}`,
      `return target: ${returnTarget}`,
      `outcomes: ${active.outcomes.length ? active.outcomes.join(' · ') : 'not recorded'}`,
      `exclusions: ${active.exclusions.length ? active.exclusions.join(' · ') : 'not recorded'}`,
    ]
    const actions = [
      action('return', 'Return', { type: 'return' }, true),
      action('promote', 'Make it the goal', { type: 'promote' }),
      ...(returned ? [action(`stay-${returned.id}`, 'Stay', { type: 'dismiss', id: returned.id })] : []),
    ]
    const rows: ScreenRow[] = [
      {
        id: `${active.id}-from`,
        key: `detour-from-${active.id}`,
        kind: 'detour',
        glyph: 'currentTopic',
        text: `From ${departure}`,
        meta: checkpoint ? `checkpoint: ${checkpoint.name}` : 'main path',
        tone: 'path',
        actions,
        detail: details,
        expandable: true,
        interactive: true,
      },
      {
        id: `${active.id}-topic`,
        key: `detour-topic-${active.id}`,
        kind: 'detour',
        glyph: 'detour',
        text: `Detour ${topic}`,
        meta: 'active',
        tone: 'detour',
        right: returnDepth > 0 ? `return: ${returnDepth} back` : `started ${ago(now - active.at)}`,
        actions,
        detail: details,
        expandable: true,
        interactive: true,
      },
    ]
    return section('detour', 'DETOUR', rows, { tone: 'detour' })
  }
  const dim = possible?.source === 'claude' && view.mode === 'engine'
  const rowDim = possible?.source === 'claude'
  return section(
    'possible-detour',
    'POSSIBLE DETOUR',
    possible
      ? [
          {
            ...suggestionRow(snapshot, possible, view),
            dim: rowDim,
            italic: true,
            actions: dim
              ? [action('turn-on-detour-observer', 'Turn on', { type: 'open-setup' }, true)]
              : suggestionRow(snapshot, possible, view).actions,
          },
        ]
      : [],
    { tone: dim ? undefined : 'detour', dim, empty: possible ? undefined : 'No possible detour.' },
  )
}

function activity(snapshot: AtlasSnapshot, now: number): ScreenSection {
  const rows = snapshot.activity.slice(-6).map((item): ScreenRow => ({
    id: item.id,
    key: `activity-${item.id}`,
    kind: 'activity',
    text: `${item.agent ? `${item.agent} · ` : ''}${item.label}`,
    right: item.state === 'running' ? undefined : ago(now - (item.endedAt ?? item.at)),
    tone:
      item.state === 'failed'
        ? 'fail'
        : item.kind === 'edit'
          ? 'write'
          : item.kind === 'read' || item.kind === 'search'
            ? 'read'
            : item.kind === 'test'
              ? 'ok'
              : item.kind === 'agent'
                ? 'checkpoint'
                : undefined,
    glyph: item.state === 'running' ? undefined : item.state === 'failed' ? 'fail' : 'ok',
    dim: item.state === 'done',
    bold: item.state === 'running',
    live: 'activity',
    interactive: false,
  }))
  const running = snapshot.activity.filter(item => item.state === 'running').length
  return section('activity', 'ACTIVITY', rows, {
    tone: 'path', count: running ? `${running} running` : undefined, empty: 'Waiting for Claude to work.',
  })
}

function fileRow(snapshot: AtlasSnapshot, file: AtlasSnapshot['files'][number], now: number, full: boolean): ScreenRow {
  const name = full ? rel(file.path, snapshot.root) : base(file.path)
  return {
    id: file.path,
    key: `sel-${full ? 'ef' : 'f'}-${file.path}`,
    kind: 'file',
    glyph: file.lastOp === 'write' ? 'editedFile' : 'readFile',
    text: name,
    metaParts: [
      { text: `${file.writes}e`, compact: `${file.writes}`, tone: 'write' },
      { text: `${file.reads}r`, compact: `${file.reads}`, tone: 'read' },
    ],
    right: ago(now - file.at),
    tone: file.lastOp === 'write' ? 'write' : 'read',
    expandable: true,
    detail: [
      'kind: working-set file',
      `last operation: ${file.lastOp}`,
      `counts: ${file.reads} read · ${file.writes} written`,
      whenLine(now, file.at, file.turn),
      `path: ${rel(file.path, snapshot.root)}`,
    ],
    interactive: true,
  }
}

function next(snapshot: AtlasSnapshot, view: ScreenView): ScreenSection | null {
  const hint = resumeHint(snapshot)
  if (!hint) return null
  const suggestion = hint.suggestionId
    ? snapshot.suggestions.find(item => item.id === hint.suggestionId)
    : undefined
  const needsObserver = Boolean(suggestion && suggestion.source === 'claude' && view.mode === 'engine')
  return section(
    'next',
    'RESUME NEXT',
    [
      {
        id: 'next',
        key: 'next-row',
        kind: 'next',
        glyph: 'next',
        text: hint.text,
        source: hint.source,
        tone: needsObserver ? undefined : 'goal',
        dim: needsObserver,
        actions: needsObserver
          ? [action('turn-on-next-observer', 'Turn on', { type: 'open-setup' }, true)]
          : suggestion
            ? [
                action(`pin-${suggestion.id}`, 'Pin as next step', { type: 'confirm', id: suggestion.id }, true),
                action(`nop-${suggestion.id}`, 'Dismiss', { type: 'dismiss', id: suggestion.id }),
              ]
            : [],
        interactive: false,
      },
    ],
    {
      tone: needsObserver ? undefined : 'goal',
      dim: needsObserver,
      count: needsObserver ? 'Needs the Claude observer · /atlas observer claude' : hint.source,
    },
  )
}

export const buildMap: ScreenBuilder = (snapshot, view, now): ScreenModel => {
  const decisions = activeDecisions(snapshot).slice(-2)
  const questions = openQuestions(snapshot).slice(-2)
  const sections = [goal(snapshot, view, now), path(snapshot, view), detour(snapshot, view, now), activity(snapshot, now)]
  const recentFiles = [...snapshot.files].sort((a, b) => b.at - a.at).slice(0, 5)
  if (recentFiles.length)
    sections.push(
      section(
        'files',
        'WORKING SET',
        recentFiles.map(file => fileRow(snapshot, file, now, false)),
        { tone: 'write', count: `${snapshot.files.length} files` },
      ),
    )
  if (decisions.length || questions.length)
    sections.push(
      section(
        'latest',
        'LATEST',
        [
          ...decisions.map(item => itemRow(snapshot, item, now, view, false)),
          ...questions.map(item => itemRow(snapshot, item, now, view, false)),
        ],
        { tone: 'checkpoint', right: 'confirm in Open' },
      ),
    )
  const resume = next(snapshot, view)
  if (resume) sections.push(resume)
  return filterHiddenRows({
    tab: 'map',
    sections: sections.filter((value): value is ScreenSection => Boolean(value)),
  }, view.hidden ?? [])
}
