// Earlier sessions of this project, read from its .claude folder. Pure: the hooks module
// lists and reads the files, this turns their text into resume candidates.
//
//   .claude/atlas/<session>.json           Atlas save files (written by this mod)
//   .claude/trailhead/<session>.{a,b}.json Trailhead checkpoints (alternating slots)

import type { AtlasRecall, AtlasSnapshot } from '../types'
import { summary } from './model'

export const ATLAS_DIR = '.claude/atlas'
export const TRAILHEAD_DIR = '.claude/trailhead'
export const SAVE_FORMAT = 'conversation-atlas'

export type AtlasFullRecall = {
  id: string
  sessionId: string
  snapshot: unknown
}

export type StoredSession = { key: string; savedAt: number }

type Raw = Record<string, unknown>

const isRecord = (v: unknown): v is Raw => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function safeName(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
}

export function saveFile(s: AtlasSnapshot, savedAt: number): string {
  const { fresh: _fresh, pendingContext: _pending, recall: _recall, ...kept } = s
  return JSON.stringify({ format: SAVE_FORMAT, v: 1, savedAt, sessionId: s.sessionId, root: s.root, summary: summary(s), snapshot: kept })
}

function parse(text: string): Raw | null {
  try {
    const v = JSON.parse(text) as unknown
    return isRecord(v) ? v : null
  } catch {
    return null
  }
}

export function fromAtlasFile(text: string, root: string): AtlasRecall | null {
  const full = fromAtlasFullFile(text, root)
  if (!full || !isRecord(full.snapshot)) return null
  const v = parse(text)
  if (!v) return null
  const snap = full.snapshot as Partial<AtlasSnapshot>
  const settled = (snap.decisions ?? []).filter(d => d.status === 'settled').map(d => d.text)
  return {
    id: full.id,
    source: 'atlas',
    sessionId: full.sessionId,
    at: typeof v.savedAt === 'number' ? v.savedAt : 0,
    goal: snap.goal?.text ?? null,
    nextStep: snap.nextStep ?? null,
    detour: snap.detour?.reason ?? null,
    topic: isRecord(v.summary) ? str(v.summary.topic) : null,
    decisions: settled.slice(-8),
  }
}

export function fromAtlasFullFile(text: string, root: string): AtlasFullRecall | null {
  const v = parse(text)
  if (!v || v.format !== SAVE_FORMAT || !isRecord(v.snapshot)) return null
  const sessionId = str(v.sessionId)
  if (!sessionId || (str(v.root) && str(v.root)?.toLowerCase() !== root.toLowerCase())) return null
  return { id: `atlas:${sessionId}`, sessionId, snapshot: v.snapshot }
}

// One Trailhead checkpoint envelope: { format, checkpointSequence, savedAt, projectRoot, sessionId, snapshot }.
export function fromTrailheadFile(text: string, root: string): (AtlasRecall & { seq: number }) | null {
  const v = parse(text)
  if (!v || !isRecord(v.snapshot) || typeof v.checkpointSequence !== 'number') return null
  const sessionId = str(v.sessionId)
  const projectRoot = str(v.projectRoot)
  if (!sessionId || (projectRoot && projectRoot.replace(/\\/g, '/').toLowerCase() !== root.toLowerCase())) return null
  const snap = v.snapshot
  const goals = Array.isArray(snap.goals) ? snap.goals.filter(isRecord) : []
  const goal = goals.find(g => g.id === snap.activeGoalId) ?? null
  const detours = Array.isArray(snap.detours) ? snap.detours.filter(isRecord) : []
  const detour = detours.find(d => d.id === snap.activeDetourId) ?? null
  const decisions = Array.isArray(snap.decisions) ? snap.decisions.filter(isRecord) : []
  const kept = decisions.filter(d => d.scope !== 'detour').map(d => str(d.conclusion)).filter((x): x is string => Boolean(x))
  if (!goal && !detour) return null
  const savedAt = str(v.savedAt)
  return {
    id: `trailhead:${sessionId}`,
    source: 'trailhead',
    sessionId,
    seq: v.checkpointSequence,
    at: savedAt ? Date.parse(savedAt) || 0 : 0,
    goal: goal ? str(goal.objective) : null,
    nextStep: goal ? str(goal.intendedNextStep) : null,
    detour: detour ? str(detour.reason) : null,
    topic: null,
    decisions: kept.slice(-8),
  }
}

// Newest first; a Trailhead session keeps only its highest checkpoint.
export function mergeRecall(list: (AtlasRecall & { seq?: number })[]): AtlasRecall[] {
  const best = new Map<string, AtlasRecall & { seq?: number }>()
  for (const r of list) {
    const cur = best.get(r.id)
    if (!cur || (r.seq ?? 0) > (cur.seq ?? 0) || r.at > cur.at) best.set(r.id, r)
  }
  return [...best.values()]
    .sort((a, b) => b.at - a.at)
    .map(({ seq: _seq, ...r }) => r)
}

export function sessionsToDelete(entries: StoredSession[], currentKey: string, keep: number): string[] {
  const ordered = entries.slice().sort((a, b) => a.savedAt - b.savedAt || a.key.localeCompare(b.key))
  const deleted: string[] = []
  let remaining = ordered.length
  for (const entry of ordered) {
    if (remaining <= keep) break
    if (entry.key === currentKey) continue
    deleted.push(entry.key)
    remaining -= 1
  }
  return deleted
}
