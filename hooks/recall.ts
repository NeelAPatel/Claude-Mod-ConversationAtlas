// Earlier sessions of this project, read from its .claude folder. Pure: the hooks module
// lists and reads the files, this turns their text into resume candidates.
//
//   .claude/atlas/<session>.json           Atlas save files (written by this mod)

import type { AtlasRecall, AtlasSnapshot } from '../types'
import { snapshotError, summary } from './model'

export const ATLAS_DIR = '.claude/atlas'
export const SAVE_FORMAT = 'conversation-atlas'

export type AtlasFullRecall = {
  id: string
  sessionId: string
  snapshot: unknown
}

export type StoredSession = { key: string; savedAt: number }

export type RecallEntry = { name: string; mtimeMs?: number }

export function pickRecallEntries<T extends RecallEntry>(entries: T[], limit: number): T[] {
  return entries.slice().sort((a, b) => {
    const aKnown = typeof a.mtimeMs === 'number' && Number.isFinite(a.mtimeMs)
    const bKnown = typeof b.mtimeMs === 'number' && Number.isFinite(b.mtimeMs)
    if (aKnown && bKnown && a.mtimeMs !== b.mtimeMs) return b.mtimeMs! - a.mtimeMs!
    if (aKnown !== bKnown) return aKnown ? -1 : 1
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  }).slice(0, Math.max(0, limit))
}

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
  const envelope = atlasEnvelope(text, root)
  if (!envelope) return null
  const { v, sessionId } = envelope
  const snap = isRecord(v.snapshot) ? v.snapshot : {}
  const decisions = Array.isArray(snap.decisions) ? snap.decisions.filter(isRecord) : []
  const settled = decisions.filter(d => d.status === 'settled').map(d => str(d.text)).filter((x): x is string => Boolean(x))
  const goal = isRecord(snap.goal) ? str(snap.goal.text) : null
  const detour = isRecord(snap.detour) ? str(snap.detour.reason) : null
  return {
    id: `atlas:${sessionId}`,
    source: 'atlas',
    sessionId,
    at: typeof v.savedAt === 'number' ? v.savedAt : 0,
    goal,
    nextStep: str(snap.nextStep),
    detour,
    topic: isRecord(v.summary) ? str(v.summary.topic) : null,
    decisions: settled.slice(-8),
  }
}

function atlasEnvelope(text: string, root: string): { v: Raw; sessionId: string } | null {
  const v = parse(text)
  if (!v || v.format !== SAVE_FORMAT) return null
  const sessionId = str(v.sessionId)
  if (!sessionId || (str(v.root) && str(v.root)?.toLowerCase() !== root.toLowerCase())) return null
  return { v, sessionId }
}

export function atlasFullFileError(text: string, root: string): string | null {
  const v = parse(text)
  if (!v) return 'invalid JSON'
  if (v.format !== SAVE_FORMAT) return 'not an Atlas save file'
  const sessionId = str(v.sessionId)
  if (!sessionId) return 'missing session id'
  if (str(v.root) && str(v.root)?.toLowerCase() !== root.toLowerCase()) return 'save belongs to another project'
  if (!isRecord(v.snapshot)) return 'missing snapshot object'
  return snapshotError(v.snapshot)
}

export function fromAtlasFullFile(text: string, root: string): AtlasFullRecall | null {
  if (atlasFullFileError(text, root)) return null
  const envelope = atlasEnvelope(text, root)
  if (!envelope || !isRecord(envelope.v.snapshot)) return null
  return { id: `atlas:${envelope.sessionId}`, sessionId: envelope.sessionId, snapshot: envelope.v.snapshot }
}

// Keep the newest candidate for each session, ordered by save time.
export function mergeRecall(list: AtlasRecall[]): AtlasRecall[] {
  const best = new Map<string, AtlasRecall>()
  for (const r of list) {
    const cur = best.get(r.id)
    if (!cur || r.at > cur.at) best.set(r.id, r)
  }
  return [...best.values()]
    .sort((a, b) => b.at - a.at)
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
