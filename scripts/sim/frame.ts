type Style = {
  color?: string
  bold?: true
  italic?: true
  dim?: true
}

type Segment = { text: string; style: Style }
type LayoutLine = { segments: Segment[]; buttons: ButtonRef[] }
type DrawnNode = { type?: string; key?: string; props?: Record<string, unknown>; children?: unknown[] }

export type ButtonRef = { key: string; hotkey?: string }
export type FrameLine = { row: number; text: string; styles?: string; buttons: ButtonRef[] }
export type FrameOptions = {
  surface: 'tui' | 'gui'
  width: number
  height: number
  offset: number
  styles: boolean
  stepNumber: number
  stepText: string
}
export type SimFrame = {
  header: string
  surface: 'tui' | 'gui'
  width: number
  height: number
  scrollOffset: number
  maxOffset: number
  totalLines: number
  selectedTab?: string
  lines: FrameLine[]
  buttons: ButtonRef[]
  overflow: Array<{ row: number; cells: number; width: number; text: string }>
  action?: { buttonKey?: string; hotkey?: string }
}

function childrenOf(node: DrawnNode): unknown[] {
  if (Array.isArray(node.children)) return node.children
  return Array.isArray(node.props?.children) ? node.props.children as unknown[] : []
}

function styleOf(props: Record<string, unknown> | undefined, parent: Style): Style {
  const style: Style = { ...parent }
  if (typeof props?.color === 'string') style.color = props.color
  if (props?.bold === true) style.bold = true
  if (props?.italic === true) style.italic = true
  if (props?.dimColor === true) style.dim = true
  return style
}

function textLines(text: string, style: Style): LayoutLine[] {
  return text.split('\n').map(line => ({ segments: line ? [{ text: line, style }] : [], buttons: [] }))
}

function append(left: LayoutLine[], right: LayoutLine[], gap = ''): LayoutLine[] {
  if (!left.length) return right
  if (!right.length) return left
  const out = left.map(line => ({ segments: [...line.segments], buttons: [...line.buttons] }))
  const first = right[0] ?? { segments: [], buttons: [] }
  const segments = [...first.segments]
  if (gap) segments.unshift({ text: gap, style: {} })
  out[0] = {
    segments: [...(out[0]?.segments ?? []), ...segments],
    buttons: [...(out[0]?.buttons ?? []), ...first.buttons],
  }
  for (const line of right.slice(1)) out.push({ segments: [...line.segments], buttons: [...line.buttons] })
  return out
}

function layout(value: unknown, parent: Style = {}): LayoutLine[] {
  if (typeof value === 'string') return textLines(value, parent)
  if (!value || typeof value !== 'object') return []
  const node = value as DrawnNode
  const props = node.props ?? {}
  const type = node.type ?? ''
  const own = styleOf(props, parent)

  if (type === 'Client') return []
  if (type === 'Text') {
    const kids = childrenOf(node)
    if (!kids.length) return typeof props.text === 'string' ? textLines(props.text, own) : []
    return kids.reduce<LayoutLine[]>((out, child) => append(out, layout(child, own)), [])
  }
  if (type === 'Button') {
    const label = typeof props.label === 'string' ? props.label : ''
    const key = typeof props.key === 'string' ? props.key : ''
    const hotkey = typeof props.hotkey === 'string' ? props.hotkey : undefined
    const ref: ButtonRef | undefined = key ? { key, ...(hotkey ? { hotkey } : {}) } : undefined
    return textLines(label, own).map(line => ({ ...line, buttons: ref ? [ref] : [] }))
  }

  const kids = childrenOf(node).map(child => layout(child, own)).filter(lines => lines.length)
  if (!kids.length) return []
  const direction = props.flexDirection === 'row' ? 'row' : 'column'
  if (direction === 'column') return kids.flat()
  const gap = typeof props.gap === 'number' && props.gap > 0 ? ' '.repeat(props.gap) : ''
  return kids.reduce<LayoutLine[]>((out, child) => append(out, child, out.length ? gap : ''), [])
}

function compactStyle(style: Style): string {
  return [
    style.color ? `color:${style.color}` : '',
    style.bold ? 'bold' : '',
    style.italic ? 'italic' : '',
    style.dim ? 'dim' : '',
  ].filter(Boolean).join(',')
}

function selectedTabOf(tree: unknown): string | undefined {
  if (!tree || typeof tree !== 'object') return undefined
  const node = tree as DrawnNode
  const props = node.props ?? {}
  const key = typeof props.key === 'string' ? props.key : typeof node.key === 'string' ? node.key : ''
  if (node.type === 'Button' && key.startsWith('tab-') && props.variant === 'primary') return key.slice(4)
  if (node.type === 'Text') {
    const nestedText = layout(node).map(line => line.segments.map(segment => segment.text).join('')).join('')
    if (nestedText.trimStart().startsWith('▸')) {
      if (key.startsWith('tab-')) return key.slice(4)
      const label = nestedText.trimStart().slice(1).trimStart().toLowerCase()
      if (/^(map|m)(\b|$)/.test(label)) return 'map'
      if (/^(trail|t)(\b|$)/.test(label)) return 'trail'
      if (/^(open|o)(\b|$)/.test(label)) return 'open'
      if (/^(evidence|evid|e)(\b|$)/.test(label)) return 'evidence'
    }
  }
  for (const child of childrenOf(node)) {
    const selected = selectedTabOf(child)
    if (selected) return selected
  }
  return undefined
}

function styleAnnotation(line: LayoutLine): string | undefined {
  const styles: string[] = []
  let offset = 0
  for (const segment of line.segments) {
    const style = compactStyle(segment.style)
    if (style) styles.push(`${offset}:${style}`)
    offset += segment.text.length
  }
  return styles.length ? `{${styles.join('|')}}` : undefined
}

function uniqueButtons(lines: FrameLine[]): ButtonRef[] {
  const seen = new Set<string>()
  const buttons: ButtonRef[] = []
  for (const line of lines) {
    for (const button of line.buttons) {
      if (seen.has(button.key)) continue
      seen.add(button.key)
      buttons.push(button)
    }
  }
  return buttons
}

export function clampOffset(offset: number, totalLines: number, height: number): number {
  return Math.max(0, Math.min(Math.trunc(offset), Math.max(0, totalLines - height)))
}

export function frameFromTree(tree: unknown, options: FrameOptions): SimFrame {
  const all = layout(tree)
  const maxOffset = Math.max(0, all.length - options.height)
  const scrollOffset = clampOffset(options.offset, all.length, options.height)
  const window = all.slice(scrollOffset, scrollOffset + options.height)
  const lines: FrameLine[] = window.map((line, index) => {
    const text = line.segments.map(segment => segment.text).join('')
    const annotation = options.styles ? styleAnnotation(line) : undefined
    return {
      row: index + 1,
      text,
      ...(annotation ? { styles: annotation } : {}),
      buttons: line.buttons.map(button => ({ ...button })),
    }
  })
  const overflow = lines
    // The sim has no cell-width dependency: `.length` is reported as code units.
    .filter(line => line.text.length > options.width)
    .map(line => ({ row: line.row, cells: line.text.length, width: options.width, text: line.text }))
  const name = options.surface === 'tui' ? 'TUI' : 'GUI (text approximation, not what the owner sees)'
  const header = `=== ${name} ${options.width}x${options.height} scroll ${scrollOffset}/${all.length} | step ${options.stepNumber}: ${options.stepText} ===`
  return {
    header,
    surface: options.surface,
    width: options.width,
    height: options.height,
    scrollOffset,
    maxOffset,
    totalLines: all.length,
    ...(selectedTabOf(tree) ? { selectedTab: selectedTabOf(tree) } : {}),
    lines,
    buttons: uniqueButtons(lines),
    overflow,
  }
}

export function buttonLabel(button: ButtonRef): string {
  return `${button.key}${button.hotkey ? `[${button.hotkey}]` : ''}`
}
