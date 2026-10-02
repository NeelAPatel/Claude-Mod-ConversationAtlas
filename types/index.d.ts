// Conversation Atlas state contract.
//
// Two layers live side by side and never blur:
//   INTENT        what the person confirmed: goal, detour, next step, checkpoints they marked.
//   OBSERVATION   what the atlas saw: topics, possible detours, decisions, questions, files, activity.
// Observations can become intent only through an explicit confirmation (a pane button or /atlas).

export type AtlasSource = 'person' | 'claude' | 'engine' | 'cue'

export type AtlasGoal = {
  id: string
  text: string
  at: number
  turn: number
  source: AtlasSource
}

// Trailhead's departure snapshot, kept: what to come back to when a detour ends.
export type AtlasDeparture = {
  goal: string | null
  topic: string | null
  nextStep: string | null
  checkpointId: string | null
  decisions: string[]
}

export type AtlasDetour = {
  id: string
  reason: string
  at: number
  turn: number
  topicId: string | null
  departure: AtlasDeparture
  outcomes: string[]
  // Trailhead's /trail exclude: material from the detour that must not become an assumption.
  exclusions: string[]
  status: 'active' | 'returned' | 'promoted'
  endedAt: number | null
}

export type AtlasTopic = {
  id: string
  title: string
  parentId: string | null
  kind: 'main' | 'possible-detour' | 'detour'
  firstTurn: number
  lastTurn: number
  at: number
  status: 'active' | 'left' | 'returned'
  source: AtlasSource
}

export type AtlasSuggestionKind = 'goal' | 'detour' | 'return' | 'next' | 'resume'

export type AtlasSuggestion = {
  id: string
  kind: AtlasSuggestionKind
  text: string
  why: string | null
  at: number
  turn: number
  source: AtlasSource
  topicId: string | null
}

export type AtlasItem = {
  id: string
  text: string
  at: number
  turn: number
  topicId: string | null
  source: AtlasSource
  // decisions: observed -> settled (confirmed) or excluded (set aside during a detour).
  // questions: open -> resolved.
  status: 'observed' | 'settled' | 'excluded' | 'open' | 'resolved'
}

export type AtlasCheckpoint = {
  id: string
  name: string
  at: number
  turn: number
  kind: 'marked' | 'commit' | 'tests' | 'claude'
  goal: string | null
  topic: string | null
  files: string[]
  detail: string | null
}

export type AtlasFile = {
  path: string
  reads: number
  writes: number
  lastOp: 'read' | 'write'
  at: number
  turn: number
}

export type AtlasActivityKind = 'read' | 'search' | 'edit' | 'bash' | 'test' | 'git' | 'web' | 'agent' | 'ask' | 'plan' | 'other'

export type AtlasActivity = {
  id: string
  kind: AtlasActivityKind
  label: string
  state: 'running' | 'done' | 'failed'
  at: number
  endedAt: number | null
  agent: string | null
}

export type AtlasEvent = {
  id: string
  at: number
  turn: number
  kind: 'prompt' | 'topic' | 'goal' | 'detour' | 'return' | 'promote' | 'decision' | 'question' | 'resolved' | 'checkpoint' | 'next' | 'resume' | 'dismiss'
  text: string
}

// An earlier session of this project that can be resumed: an Atlas save file or a
// Trailhead checkpoint, both read from the project's .claude folder.
export type AtlasRecall = {
  id: string
  source: 'atlas' | 'trailhead'
  sessionId: string
  at: number
  goal: string | null
  nextStep: string | null
  detour: string | null
  topic: string | null
  decisions: string[]
}

export type AtlasSnapshot = {
  v: 1
  sessionId: string
  root: string
  startedAt: number
  turn: number
  seq: number
  goal: AtlasGoal | null
  goalHistory: AtlasGoal[]
  detour: AtlasDetour | null
  detourHistory: AtlasDetour[]
  nextStep: string | null
  topics: AtlasTopic[]
  currentTopicId: string | null
  suggestions: AtlasSuggestion[]
  decisions: AtlasItem[]
  questions: AtlasItem[]
  checkpoints: AtlasCheckpoint[]
  files: AtlasFile[]
  activity: AtlasActivity[]
  events: AtlasEvent[]
  // Text the next prompt from the composer carries to Claude once (a return packet, a selection).
  pendingContext: string[]
  // Earlier sessions found on disk; adopting one is an explicit press.
  recall: AtlasRecall[]
  adopted: string[]
  // How this session's earlier conversation was mapped: not yet, replayed for free, or by Claude.
  scanned: 'none' | 'engine' | 'claude'
  // Freshly observed ids drawn highlighted until the flash expires.
  fresh: string[]
}

export type AtlasTab = 'map' | 'trail' | 'open' | 'evidence'

export type AtlasSelection = { kind: string; id: string; text: string }

// The app bar's menus; at most one is open, drawn above the bar.
export type AtlasDrawer = 'legend' | 'decisions' | 'questions' | 'checkpoints'

export type AtlasView = {
  tab: AtlasTab
  selected: AtlasSelection | null
  editingGoal: boolean
  drawer: AtlasDrawer | null
  // First body row shown; the pane scrolls its own body so the app bar stays put.
  scroll: number
}

declare module 'claude-code' {
  interface PluginState {
    'conversation-atlas': {
      snapshot: AtlasSnapshot
      view: AtlasView
    }
  }
}
