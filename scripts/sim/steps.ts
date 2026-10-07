import { mock } from 'claude-code/testing'
import { SAMPLE_NOW, SAMPLE_ROOT, SAMPLE_SESSION, noGoalSnapshot, sampleSnapshot } from '../../tests/fixtures/sample'
import { buttonLabel, clampOffset, frameFromTree, type ButtonRef, type SimFrame } from './frame'

export type SimStep =
  | { kind: 'size'; width: number; height: number; source: string }
  | { kind: 'tab'; tab: 'map' | 'trail' | 'open' | 'evidence'; source: string }
  | { kind: 'press' | 'click'; key: string; source: string }
  | { kind: 'clickrow'; row: number; source: string }
  | { kind: 'key'; hotkey: string; source: string }
  | { kind: 'scroll'; amount: number | 'top' | 'end'; source: string }
  | { kind: 'legend' | 'snapshot'; source: string }

export type SimSurface = 'tui' | 'gui'
export type SimState = 'sample' | 'nogoal' | 'setup'
export type SimOptions = {
  surface: SimSurface
  width: number
  height: number
  state: SimState
  styles: boolean
  steps: Array<SimStep | string>
  emit?: boolean
}

export type SimResult = { frames: SimFrame[] }

const GRAMMAR = [
  'size <W>x<H> (example: size 60x20)',
  'tab map|trail|open|evidence (example: tab trail)',
  'press <key> or click <key> (example: press tab-trail)',
  'clickrow <n> (example: clickrow 3; rows are 1-based and visible)',
  'key <char> (example: key t)',
  'scroll <signed rows>|top|end (examples: scroll 5, scroll -2, scroll end)',
  'legend (example: legend)',
  'snapshot (example: snapshot)',
].join('\n  ')

function invalidStep(source: string, reason: string): Error {
  return new Error(`Invalid step "${source}": ${reason}\nValid steps:\n  ${GRAMMAR}\nExample fix: --step "tab trail".`)
}

export function parseStep(input: string): SimStep {
  const source = input.trim()
  const parts = source.split(/\s+/).filter(Boolean)
  const command = parts[0]?.toLowerCase() ?? ''
  const args = parts.slice(1)
  if (!command) throw invalidStep(input, 'step is empty')

  if (command === 'size') {
    if (args.length !== 1) throw invalidStep(input, 'size needs one WxH value')
    const match = /^(\d+)x(\d+)$/i.exec(args[0] ?? '')
    if (!match) throw invalidStep(input, 'size must look like 46x30')
    const width = Number(match[1])
    const height = Number(match[2])
    if (width < 1 || height < 1) throw invalidStep(input, 'width and height must both be positive integers')
    return { kind: 'size', width, height, source: `size ${width}x${height}` }
  }

  if (command === 'tab') {
    if (args.length !== 1 || !['map', 'trail', 'open', 'evidence'].includes(args[0]?.toLowerCase() ?? '')) {
      throw invalidStep(input, 'tab must be map, trail, open, or evidence')
    }
    const tab = args[0]!.toLowerCase() as 'map' | 'trail' | 'open' | 'evidence'
    return { kind: 'tab', tab, source: `tab ${tab}` }
  }

  if (command === 'press' || command === 'click') {
    if (args.length !== 1) throw invalidStep(input, `${command} needs one Button key`)
    return { kind: command, key: args[0]!, source: `${command} ${args[0]}` }
  }

  if (command === 'clickrow') {
    if (args.length !== 1 || !/^\d+$/.test(args[0] ?? '') || Number(args[0]) < 1) {
      throw invalidStep(input, 'clickrow needs a positive, 1-based visible row number')
    }
    const row = Number(args[0])
    return { kind: 'clickrow', row, source: `clickrow ${row}` }
  }

  if (command === 'key') {
    if (args.length !== 1 || !/^[a-z0-9]$/i.test(args[0] ?? '')) {
      throw invalidStep(input, 'key needs one digit or letter matching a Button hotkey')
    }
    const hotkey = args[0]!.toLowerCase()
    return { kind: 'key', hotkey, source: `key ${hotkey}` }
  }

  if (command === 'scroll') {
    if (args.length !== 1) throw invalidStep(input, 'scroll needs one signed row count, top, or end')
    const word = args[0]!.toLowerCase()
    if (word === 'top' || word === 'end') return { kind: 'scroll', amount: word, source: `scroll ${word}` }
    if (!/^[+-]?\d+$/.test(word)) throw invalidStep(input, 'scroll rows must be a signed integer')
    return { kind: 'scroll', amount: Number(word), source: `scroll ${Number(word)}` }
  }

  if (command === 'legend' || command === 'snapshot') {
    if (args.length) throw invalidStep(input, `${command} takes no arguments`)
    return { kind: command, source: command }
  }

  throw invalidStep(input, `unknown command "${parts[0]}"`)
}

export function parseSteps(inputs: string[]): SimStep[] {
  return inputs.map(parseStep)
}

function paneProps(width: number, height: number, offset: number): Record<string, unknown> {
  return {
    title: 'Atlas',
    isFocused: true,
    bodyColumns: width,
    placement: 'dock',
    scroll: { offset, bodyRows: height },
    view: {},
  }
}

function world(on: any, state: SimState) {
  const snapshot = state === 'nogoal' ? noGoalSnapshot() : sampleSnapshot()
  const store: Record<string, unknown> = { [`session:${SAMPLE_SESSION}`]: snapshot }
  if (state !== 'setup') store.setup = { observer: 'claude', at: SAMPLE_NOW }
  const clock = mock.clock(on, { now: SAMPLE_NOW })
  mock.store(on, store)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SAMPLE_SESSION }))
  on('session.root', () => ({ value: SAMPLE_ROOT }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: `mcp__conversation-atlas__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', (_$: any, e: any) => ({ result: e.tool === 'Bash' ? { stdout: '', stderr: '', interrupted: false } : { ok: true } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  return clock
}

function buttonsFrom(found: any[]): ButtonRef[] {
  return found.flatMap(item => {
    const props = item?.props ?? {}
    const key = typeof props.key === 'string' ? props.key : ''
    if (!key) return []
    return [{ key, ...(typeof props.hotkey === 'string' ? { hotkey: props.hotkey } : {}) }]
  })
}

function buttonList(buttons: ButtonRef[]): string {
  return buttons.length ? buttons.map(buttonLabel).join(' ') : '(none)'
}

function invalidKey(key: string, buttons: ButtonRef[]): Error {
  return new Error(`Unknown button key "${key}". Valid button keys: ${buttonList(buttons)}. Example fix: press tab-trail.`)
}

async function readButtons(ui: any): Promise<ButtonRef[]> {
  return buttonsFrom(await ui.findAll({ type: 'Button' }))
}

async function pressKey(ui: any, key: string, buttons?: ButtonRef[]): Promise<string> {
  const allButtons = buttons ?? await readButtons(ui)
  if (!allButtons.some(button => button.key === key)) throw invalidKey(key, allButtons)
  await ui.press({ key })
  return key
}

function asStep(step: SimStep | string): SimStep {
  return typeof step === 'string' ? parseStep(step) : step
}

/** Mounts the real Pane through the plugin-test kit, then applies parsed steps. */
export async function runSimulation($: any, on: any, options: SimOptions): Promise<SimResult> {
  const steps = options.steps.map(asStep)
  const clock = world(on, options.state)
  await $.session.start({ cwd: SAMPLE_ROOT, surface: 'terminal', isInteractive: true } as any)
  await clock.settle()

  let width = options.width
  let height = options.height
  let offset = 0
  const kitSurface = options.surface === 'tui' ? 'terminal' : 'desktop'
  const ui = await $.ui.mount({
    plugin: 'conversation-atlas',
    surface: kitSurface,
    component: 'Pane',
    requestId: 'atlas',
    props: paneProps(width, height, offset),
  } as any)
  const frames: SimFrame[] = []

  try {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]!
      let action: { buttonKey?: string; hotkey?: string } | undefined
      let tree = await ui.drawn()

      if (step.kind === 'size') {
        width = step.width
        height = step.height
        offset = clampOffset(offset, frameFromTree(tree, {
          surface: options.surface, width, height, offset, styles: options.styles, stepNumber: index + 1, stepText: step.source,
        }).totalLines, height)
        await ui.redraw(paneProps(width, height, offset))
      } else if (step.kind === 'scroll') {
        const total = frameFromTree(tree, {
          surface: options.surface, width, height, offset, styles: options.styles, stepNumber: index + 1, stepText: step.source,
        }).totalLines
        const max = Math.max(0, total - height)
        if (step.amount === 'top') offset = 0
        else if (step.amount === 'end') offset = max
        else offset = clampOffset(offset + step.amount, total, height)
        await ui.redraw(paneProps(width, height, offset))
      } else if (step.kind === 'clickrow') {
        const current = frameFromTree(tree, {
          surface: options.surface, width, height, offset, styles: options.styles, stepNumber: index + 1, stepText: step.source,
        })
        const line = current.lines[step.row - 1]
        if (!line) {
          const valid = current.lines.map((item, row) => `row ${row + 1}: ${buttonList(item.buttons)}`).join('; ')
          throw new Error(`Visible row ${step.row} does not exist (visible rows: ${current.lines.length}). Buttons by visible row: ${valid || '(none)'}. Example fix: clickrow 1.`)
        }
        if (!line.buttons.length) {
          const valid = current.lines.map((item, row) => `row ${row + 1}: ${buttonList(item.buttons)}`).join('; ')
          throw new Error(`Visible row ${step.row} has no Button. Buttons by visible row: ${valid}. Example fix: clickrow 2.`)
        }
        action = { buttonKey: line.buttons[0]!.key }
        await ui.press({ key: action.buttonKey })
      } else if (step.kind === 'key') {
        const allButtons = await readButtons(ui)
        const button = allButtons.find(item => item.hotkey?.toLowerCase() === step.hotkey)
        if (!button) {
          const active = frameFromTree(tree, {
            surface: options.surface, width, height, offset, styles: options.styles, stepNumber: index + 1, stepText: step.source,
          }).selectedTab
          const activeHotkey: Record<string, string> = { map: 'm', trail: 't', open: 'o', evidence: 'e' }
          if (options.surface === 'tui' && active && activeHotkey[active] === step.hotkey) {
            // The active TUI tab is drawn as Text and has no Button hotkey to press.
            action = { buttonKey: `tab-${active}`, hotkey: step.hotkey }
          } else {
            const hotkeys = allButtons.filter(item => item.hotkey).map(item => `${item.hotkey} -> ${item.key}`).join(', ')
            throw new Error(`No Button has hotkey "${step.hotkey}". Available button keys: ${buttonList(allButtons)}. Available hotkeys: ${hotkeys || '(none)'}. Example fix: key t.`)
          }
        } else {
          await ui.press({ key: button.key })
          action = { buttonKey: button.key, hotkey: step.hotkey }
        }
      } else if (step.kind === 'press' || step.kind === 'click') {
        action = { buttonKey: await pressKey(ui, step.key) }
      } else if (step.kind === 'tab') {
        const key = `tab-${step.tab}`
        const allButtons = await readButtons(ui)
        // TUI renders its selected tab as Text, so pressing the already-active tab is a no-op.
        const active = frameFromTree(tree, {
          surface: options.surface, width, height, offset, styles: options.styles, stepNumber: index + 1, stepText: step.source,
        }).selectedTab
        if (active !== step.tab) action = { buttonKey: await pressKey(ui, key, allButtons) }
      } else if (step.kind === 'legend') {
        action = { buttonKey: await pressKey(ui, 'bar-legend') }
      }

      tree = await ui.drawn()
      const frame = frameFromTree(tree, {
        surface: options.surface,
        width,
        height,
        offset,
        styles: options.styles,
        stepNumber: index + 1,
        stepText: step.source,
      })
      offset = frame.scrollOffset
      if (action) frame.action = action
      frames.push(frame)
      if (options.emit !== false) (globalThis as any).console?.log(`SIM_FRAME ${JSON.stringify(frame)}`)
    }
  } catch (error) {
    if (options.emit !== false) {
      const message = error instanceof Error ? error.message : String(error)
      ;(globalThis as any).console?.log(`SIM_ERROR ${JSON.stringify({ message })}`)
    }
    throw error
  } finally {
    await ui.unmount()
  }

  return { frames }
}
