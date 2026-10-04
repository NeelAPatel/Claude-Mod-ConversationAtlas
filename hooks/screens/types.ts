// Defines the pure screen models and typed actions shared by every Atlas screen. No `$`.

import type { AtlasMode, AtlasPopup, AtlasSelection, AtlasSnapshot, AtlasTab, AtlasTrailView, AtlasView } from '../../types'

export type Action =
  | { type: 'tab'; tab: AtlasTab }
  | { type: 'legend' }
  | { type: 'popup'; popup: AtlasPopup }
  | { type: 'popup-scroll'; by: number }
  | { type: 'expanded-scroll'; by: number }
  | { type: 'scroll'; by: number }
  | { type: 'scroll-to'; at: number }
  | { type: 'trail-sort' }
  | { type: 'trail-view'; view: AtlasTrailView }
  | { type: 'trail-view-set'; view: AtlasTrailView }
  | { type: 'trail-settings-page'; page: number }
  | { type: 'trail-filter'; filter: 'b' | 'h' }
  | { type: 'expand'; id: string }
  | { type: 'confirm'; id: string }
  | { type: 'dismiss'; id: string }
  | { type: 'settle'; id: string }
  | { type: 'exclude'; id: string }
  | { type: 'drop'; id: string }
  | { type: 'restore'; id: string }
  | { type: 'resolve'; id: string }
  | { type: 'reopen'; id: string }
  | { type: 'attach'; ref: AtlasSelection }
  | { type: 'return' }
  | { type: 'promote' }
  | { type: 'mark' }
  | { type: 'goal'; text: string }
  | { type: 'pin'; text: string }
  | { type: 'edit-goal' }
  | { type: 'adopt'; id: string }
  | { type: 'adopt-full'; id: string }
  | { type: 'scan' }
  | { type: 'open-setup' }
  | { type: 'set-observer'; mode: AtlasMode }
  | { type: 'toggle-observer' }

export type GlyphKey =
  | 'goal'
  | 'suggestion'
  | 'currentTopic'
  | 'detour'
  | 'returned'
  | 'observedDecision'
  | 'settledDecision'
  | 'checkpoint'
  | 'openQuestion'
  | 'resolved'
  | 'ok'
  | 'fail'
  | 'editedFile'
  | 'readFile'
  | 'fresh'
  | 'expanded'
  | 'prompt'
  | 'next'
  | 'resume'
  | 'handoff'
  | 'reportBack'

export type ToneKey = 'goal' | 'path' | 'trail' | 'detour' | 'decision' | 'question' | 'checkpoint' | 'read' | 'write' | 'ok' | 'fail'

export type ScreenAction = {
  key: string
  label: string
  action: Action
  primary?: boolean
  role?: 'dismiss'
}

export type ScreenRow = {
  id: string
  key: string
  kind: 'text' | 'goal' | 'suggestion' | 'topic' | 'item' | 'file' | 'activity' | 'detour' | 'next' | 'event' | 'checkpoint' | 'recall'
  glyph?: GlyphKey
  sourceMark?: string
  sourceMarkColor?: string
  text: string
  checkbox?: boolean
  setting?: boolean
  meta?: string
  metaParts?: { text: string; compact?: string; tone?: ToneKey; dim?: boolean }[]
  right?: string
  source?: string
  tone?: ToneKey
  dim?: boolean
  bold?: boolean
  italic?: boolean
  fresh?: boolean
  depth?: number
  expandable?: boolean
  detail?: string[]
  fullText?: string
  actions?: ScreenAction[]
  suggestedGoals?: ScreenRow[]
  interactive?: boolean
  overflowPopup?: boolean
  empty?: boolean
  // Path/activity rows can retain their semantic live behavior without any
  // renderer-specific element or width assumption in the screen model.
  live?: 'path' | 'activity'
}

export type ScreenSection = {
  key: string
  heading: string
  explain: string
  help: string[]
  count?: string
  right?: string
  tone?: ToneKey
  dim?: boolean
  rows: ScreenRow[]
  empty?: string
  actions?: ScreenAction[]
  input?: { key: string; label: string; placeholder: string; submitLabel: string }
}

export type ScreenPopup = {
  kind: 'legend' | 'item' | 'trail-view'
  id?: string
  title: string
  titleCount?: string
  page?: { current: number; total: number; name: string }
  closeGlyph?: boolean
  rows: ScreenRow[]
  footer?: string
  footerActions?: ScreenAction[]
}

export type ScreenModel = {
  tab: AtlasTab
  sections: ScreenSection[]
}

export type ScreenView = AtlasView & { mode: AtlasMode; hidden?: string[]; settingsPage?: number }

export type ScreenBuilder = (snapshot: AtlasSnapshot, view: ScreenView, now: number) => ScreenModel
