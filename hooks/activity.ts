// Turns a tool call into an activity row and the files it touched. Pure; no `$`.

import type { AtlasActivityKind } from '../types'

export type Classified = {
  kind: AtlasActivityKind
  label: string
  files: { path: string; op: 'read' | 'write' }[]
  isTest: boolean
}

type Input = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function posix(path: string): string {
  return path.replace(/\\/g, '/')
}

export function base(path: string): string {
  const p = posix(path).replace(/\/+$/, '')
  return p.slice(p.lastIndexOf('/') + 1) || p
}

// Path shown relative to the project root when inside it.
export function rel(path: string, root: string): string {
  const p = posix(path)
  const r = posix(root).replace(/\/+$/, '')
  if (r && p.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return p.slice(r.length + 1)
  return p
}

const TEST_CMD = /(^|[\s;&|(])((npm|pnpm|yarn|bun)( run)? test|npx (vitest|jest|mocha|playwright)|vitest|jest|pytest|py\.test|cargo test|go test|dotnet test|mvn test|gradle test|node --test|deno test|claude plugin test|rspec|phpunit|ctest|make (test|check))\b/
const GIT_CMD = /(^|[\s;&|(])(git|gh)\s+(\w+)/

export function isTestCommand(command: string): boolean {
  return TEST_CMD.test(command)
}

function shortCommand(command: string): string {
  const first = command.split('\n')[0] ?? command
  return first.replace(/^cd\s+\S+\s*&&\s*/, '').trim()
}

export function classify(tool: string, input: Input): Classified | null {
  const none: Classified['files'] = []
  switch (tool) {
    case 'Read': {
      const path = posix(str(input.file_path))
      return { kind: 'read', label: `Read ${base(path)}`, files: path ? [{ path, op: 'read' }] : none, isTest: false }
    }
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit': {
      const path = posix(str(input.file_path) || str(input.notebook_path))
      const verb = tool === 'Write' ? 'Write' : 'Edit'
      return { kind: 'edit', label: `${verb} ${base(path)}`, files: path ? [{ path, op: 'write' }] : none, isTest: false }
    }
    case 'Grep':
      return { kind: 'search', label: `Search "${str(input.pattern).slice(0, 40)}"`, files: none, isTest: false }
    case 'Glob':
      return { kind: 'search', label: `Find ${str(input.pattern).slice(0, 40)}`, files: none, isTest: false }
    case 'Bash':
    case 'PowerShell': {
      const command = str(input.command)
      const short = shortCommand(command)
      if (isTestCommand(command)) return { kind: 'test', label: `Tests: ${short}`, files: none, isTest: true }
      const git = GIT_CMD.exec(command)
      if (git) return { kind: 'git', label: `${git[2]} ${git[3]}${str(input.description) ? ` · ${str(input.description)}` : ''}`, files: none, isTest: false }
      return { kind: 'bash', label: str(input.description) || short, files: none, isTest: false }
    }
    case 'WebFetch':
      return { kind: 'web', label: `Fetch ${str(input.url).replace(/^https?:\/\//, '').slice(0, 50)}`, files: none, isTest: false }
    case 'WebSearch':
      return { kind: 'web', label: `Search web "${str(input.query).slice(0, 40)}"`, files: none, isTest: false }
    case 'Agent':
    case 'Task':
      return { kind: 'agent', label: `Agent: ${str(input.description) || str(input.subagent_type) || 'subagent'}`, files: none, isTest: false }
    case 'AskUserQuestion':
      return { kind: 'ask', label: 'Asking you', files: none, isTest: false }
    case 'ExitPlanMode':
      return { kind: 'plan', label: 'Plan proposed', files: none, isTest: false }
    case 'TodoWrite':
    case 'ToolSearch':
      return null
    default: {
      if (tool.startsWith('mcp__conversation-atlas__')) return null
      const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
      if (mcp) return { kind: 'other', label: `${mcp[1]?.replace(/^claude_ai_/, '')}: ${mcp[2]}`, files: none, isTest: false }
      return { kind: 'other', label: tool, files: none, isTest: false }
    }
  }
}

// The question texts of an AskUserQuestion call: each becomes an open question on the map.
export function askedQuestions(input: Input): string[] {
  const qs = Array.isArray(input.questions) ? input.questions : []
  return qs.map(q => (q && typeof q === 'object' ? str((q as Input).question) : '')).filter(Boolean)
}

// The first heading or line of a proposed plan, used as the decision's text.
export function planTitle(plan: string): string {
  const line = plan.split('\n').map(l => l.replace(/^#+\s*/, '').trim()).find(Boolean)
  return line ? `Plan approved: ${line}` : 'Plan approved'
}
