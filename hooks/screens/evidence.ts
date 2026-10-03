import { base, rel } from '../activity'
import type { AtlasSnapshot } from '../../types'
import { action, ago, itemRow, popupModels, sourceName, whenLine } from './shared'
import type { ScreenBuilder, ScreenModel, ScreenRow, ScreenSection } from './types'

const explain: Record<string, string> = {
  CHECKPOINTS: 'Moments to come back to: commits, tests passing after edits, milestones and your marks.',
  'SETTLED (LEDGER)': 'Decisions you settled. Treated as true until you reopen them.',
  RESOLVED: 'Questions already answered.',
  DETOURS: 'Past detours: returned or made into the goal.',
  'EARLIER SESSIONS': 'Earlier sessions in this project. Resume brings back their goal, next step and decisions.',
  FILES: 'Every file touched this session, most edited first.',
}

function section(key: string, heading: string, rows: ScreenRow[], extra: Partial<ScreenSection> = {}): ScreenSection {
  return { key, heading, explain: explain[heading] ?? heading, rows, ...extra }
}

function checkpointRow(snapshot: AtlasSnapshot, checkpoint: AtlasSnapshot['checkpoints'][number], now: number): ScreenRow {
  const kind = checkpoint.kind === 'marked' ? 'mark' : checkpoint.kind === 'tests' ? 'tests ✓' : checkpoint.kind === 'claude' ? 'milestone' : checkpoint.kind
  const text = `${checkpoint.name}${checkpoint.topic ? ` (topic: ${checkpoint.topic})` : ''}${checkpoint.files.length ? `; files: ${checkpoint.files.map(base).join(', ')}` : ''}`
  return { id: checkpoint.id, key: `csel-${checkpoint.id}`, kind: 'checkpoint', glyph: 'checkpoint', text: checkpoint.name, meta: kind, right: ago(now - checkpoint.at), tone: 'checkpoint', fresh: snapshot.fresh.includes(checkpoint.id), expandable: true,
    detail: [`kind: ${kind}`, whenLine(now, checkpoint.at, checkpoint.turn), ...(checkpoint.goal ? [`goal: ${checkpoint.goal}`] : []), ...(checkpoint.topic ? [`topic: ${checkpoint.topic}`] : []), ...(checkpoint.files.length ? [`files: ${checkpoint.files.map(base).join(', ')}`] : []), ...(checkpoint.detail ? [`detail: ${checkpoint.detail}`] : []), `summary: ${text}`], interactive: true }
}

function fileRow(snapshot: AtlasSnapshot, file: AtlasSnapshot['files'][number], now: number): ScreenRow {
  return { id: file.path, key: `ef-${file.path}`, kind: 'file', glyph: file.lastOp === 'write' ? 'editedFile' : 'readFile', text: rel(file.path, snapshot.root), meta: `${file.writes} writes · ${file.reads} reads`, right: ago(now - file.at), tone: file.lastOp === 'write' ? 'write' : 'read', expandable: true, detail: [`path: ${rel(file.path, snapshot.root)}`, `last operation: ${file.lastOp}`, `counts: ${file.reads} read · ${file.writes} written`, whenLine(now, file.at, file.turn)], interactive: true }
}

export const buildEvidence: ScreenBuilder = (snapshot, view, now): ScreenModel => {
  const settled = snapshot.decisions.filter(item => item.status === 'settled')
  const resolved = snapshot.questions.filter(item => item.status === 'resolved').slice(-5)
  const files = [...snapshot.files].sort((a, b) => b.writes - a.writes || b.at - a.at).slice(0, 12)
  const sections: ScreenSection[] = [
    section('checkpoints', 'CHECKPOINTS', snapshot.checkpoints.slice().reverse().slice(0, 12).map(item => checkpointRow(snapshot, item, now)), { tone: 'checkpoint', count: `${snapshot.checkpoints.length}`, empty: snapshot.checkpoints.length ? undefined : 'Commits, passing tests after edits, milestones and your marks.' }),
    section('settled', 'SETTLED (LEDGER)', settled.map(item => itemRow(snapshot, item, now, view, false)), { tone: 'decision', count: `${settled.length}`, empty: settled.length ? undefined : 'Decisions you settle become settled knowledge.' }),
  ]
  if (resolved.length) sections.push(section('resolved', 'RESOLVED', resolved.map(item => itemRow(snapshot, item, now, view, true)), { tone: 'question' }))
  if (snapshot.detourHistory.length) sections.push(section('detours', 'DETOURS', snapshot.detourHistory.slice(-5).map(detour => ({ id: detour.id, key: `dh-${detour.id}`, kind: 'detour' as const, glyph: detour.status === 'promoted' ? 'goal' as const : 'returned' as const, text: detour.reason, meta: `${detour.outcomes.length} kept · ${detour.exclusions.length} excluded`, tone: 'detour' as const, right: ago(now - detour.at), interactive: false })), { tone: 'detour', count: `${snapshot.detourHistory.length}` }))
  if (snapshot.recall.length) sections.push(section('recall', 'EARLIER SESSIONS', snapshot.recall.slice(0, 6).map(recall => ({ id: recall.id, key: `rc-${recall.id}`, kind: 'recall' as const, glyph: snapshot.adopted.includes(recall.id) ? 'ok' as const : 'resume' as const, text: recall.goal ?? 'no goal recorded', meta: `${recall.source === 'trailhead' ? 'Trailhead' : 'Atlas'} · ${recall.sessionId.slice(0, 8)} · ${ago(now - recall.at)}`, dim: snapshot.adopted.includes(recall.id), actions: snapshot.adopted.includes(recall.id) ? [] : [action(`adopt-${recall.id}`, 'Resume this', { type: 'adopt', id: recall.id }, true)], interactive: false })), { tone: 'goal', count: `${snapshot.recall.length}` }))
  sections.push(section('files', 'FILES', files.map(file => fileRow(snapshot, file, now)), { count: `${snapshot.files.length}` }))
  return { tab: 'evidence', sections, popups: popupModels(snapshot, view, now) }
}

