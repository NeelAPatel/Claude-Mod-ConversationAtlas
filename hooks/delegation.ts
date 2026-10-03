// Pure delegation detection and handoff-report parsing. The register hook owns
// the filesystem and state writes; this module only interprets tool inputs and
// report text.

export type HandoffStart = {
  label: string
  agent: string
  brief: string | null
  external: boolean
}

export type HandoffReport = {
  status: 'done' | 'blocked' | 'failed'
  summary: string
  branch: string
  tests: string
  files: string[]
}

type Input = Record<string, unknown>

const stringOf = (value: unknown): string => typeof value === 'string' ? value : ''

function labelOf(value: string): string {
  const line = value.replace(/\s+/g, ' ').trim()
  return line.length <= 120 ? line : `${line.slice(0, 119).trimEnd()}…`
}

function titleOf(command: string): string | null {
  const match = /(?:^|\s)--title(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/i.exec(command)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

function agentOf(command: string): string | null {
  const direct = /(?:^|&&|[;|])\s*(?:[A-Za-z_][\w-]*=\S+\s+)*(?:["']?)(codex|claude)(?:\.exe)?(?=\s|$)/gi
  for (const match of command.matchAll(direct)) {
    const name = match[1]?.toLowerCase()
    if (name === 'codex') return 'Codex'
    if (name === 'claude') {
      const rest = command.slice((match.index ?? 0) + match[0].length)
      if (/^\s+(?:-p|--print)(?:\s|$)/i.test(rest)) return 'Claude'
    }
  }
  const terminal = /\bwt(?:\.exe)?\b[\s\S]*?\bnew-tab\b([\s\S]*)/i.exec(command)?.[1] ?? ''
  if (/(?:^|\s)(?:["']?)(codex|claude)(?:\.exe)?(?=\s|$)/i.test(terminal)) {
    const match = /(?:^|\s)(?:["']?)(codex|claude)(?:\.exe)?(?=\s|$)/i.exec(terminal)
    if (match?.[1]?.toLowerCase() === 'codex') return 'Codex'
    if (match?.[1] && /\s+(?:-p|--print)(?:\s|$)/i.test(terminal.slice((match.index ?? 0) + match[0].length))) return 'Claude'
  }
  return null
}

function briefOf(command: string): string | null {
  const matches = [...command.matchAll(/(?:^|[\s"'])([A-Za-z]:[\\/][^\s"']+\.md|(?:\.\.?[\\/])?[^\s"']+\.md)\b/gi)]
  return matches.at(-1)?.[1] ?? null
}

export function handoffStart(tool: string, input: Input): HandoffStart | null {
  if (tool === 'Agent' || tool === 'Task') {
    const agent = stringOf(input.subagent_type) || stringOf(input.subagentType) || 'subagent'
    const label = labelOf(stringOf(input.description)) || agent
    return { label, agent, brief: null, external: false }
  }
  if (tool !== 'Bash' && tool !== 'PowerShell') return null
  const command = stringOf(input.command)
  const agent = agentOf(command)
  const terminalTab = /\bwt(?:\.exe)?\b[\s\S]*\bnew-tab\b/i.test(command) && Boolean(agent)
  const external = Boolean(agent || terminalTab)
  if (!external) return null
  const description = labelOf(stringOf(input.description))
  const firstCommandLine = labelOf(command.split(/\r?\n/, 1)[0] ?? '')
  const name = agent ? (titleOf(command) || agent) : (description || firstCommandLine || 'background')
  return { label: name, agent: agent ?? 'background', brief: briefOf(command), external: true }
}

export function expectedReportPath(root: string, brief: string | null): string | null {
  if (!brief) return null
  const name = brief.replace(/\\/g, '/').split('/').at(-1) ?? ''
  const slug = name.replace(/\.md$/i, '')
  if (!slug || !/^[A-Za-z0-9._-]+$/.test(slug)) return null
  return `${root.replace(/[\\/]$/, '').replace(/\\/g, '/')}/.claude/atlas/handoffs/${slug}.md`
}

function cleanValue(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim()
}

// A short, deterministic fingerprint is enough to distinguish a report left by
// an earlier hand-off from the report written by the current one.
export function reportFingerprint(text: unknown): string | null {
  if (typeof text !== 'string') return null
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `${text.length}:${hash >>> 0}`
}

export function reportChanged(previous: string | null | undefined, current: unknown): boolean {
  const next = reportFingerprint(current)
  return next !== null && next !== previous
}

// A missing optional field is not a malformed report. A missing/invalid status
// is the one condition that keeps a report open, so a partially written file
// can safely be observed on the next timer tick.
export function parseHandoffReport(text: unknown): HandoffReport | null {
  if (typeof text !== 'string' || !text.trim()) return null
  const lines = text.replace(/^---\s*\r?\n/, '').split(/\r?\n/)
  let status: HandoffReport['status'] | null = null
  let summary = ''
  let branch = ''
  let tests = ''
  const files: string[] = []
  let inFiles = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      inFiles = false
      continue
    }
    if (line === '---') continue
    if (/^files\s*:/i.test(line)) {
      inFiles = true
      const inline = line.replace(/^files\s*:\s*/i, '').trim()
      if (inline && inline !== '[]') files.push(cleanValue(inline.replace(/^[-*]\s*/, '')))
      continue
    }
    const field = /^(status|summary|branch|tests)\s*:\s*(.*)$/i.exec(line)
    if (field) {
      inFiles = false
      const value = cleanValue(field[2] ?? '')
      if (field[1]?.toLowerCase() === 'status' && (value === 'done' || value === 'blocked' || value === 'failed')) status = value
      if (field[1]?.toLowerCase() === 'summary') summary = value
      if (field[1]?.toLowerCase() === 'branch') branch = value
      if (field[1]?.toLowerCase() === 'tests') tests = value
      continue
    }
    if (inFiles && /^[A-Za-z][A-Za-z0-9_.-]*\s*:\s*/.test(line)) {
      inFiles = false
      continue
    }
    if (inFiles) files.push(cleanValue(line.replace(/^[-*]\s+/, '')))
  }
  if (!status) return null
  return {
    status,
    summary: summary || 'No summary provided',
    branch: branch || 'unknown',
    tests: tests || 'tests not recorded',
    files: [...new Set(files.filter(Boolean))],
  }
}
