// Surface module for the parts of the atlas that move: running activity spins, and a
// segment marked with a tone shimmers (a bright band sweeping through its letters) while
// it is fresh or running. Runs on the drawing thread; the hooks module only hands it rows.

import type { ClientModule } from 'claude-code'

export type LiveSeg = { t: string; c?: string; b?: boolean; d?: boolean; sh?: string; spin?: boolean }
export type LiveRow = { segs: LiveSeg[]; right?: LiveSeg[] }
export type LiveScan = { active: boolean; startedAt: number; result: string | null; resultAt: number; now: number }
export type LiveProps = { rows: LiveRow[]; tones: Record<string, string[]>; scan?: LiveScan }

type Local = { phase: number; ref: { stop?: () => void }; scanKey: string; elapsedMs: number }

const TICK_MS = 100
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function band(i: number, phase: number, len: number, palette: string[]): string {
  const at = ((phase * 1.4) % (len + 10)) - 5
  const d = Math.abs(i - at)
  return palette[d < 1 ? 3 : d < 2 ? 2 : d < 3 ? 1 : 0] ?? palette[0] ?? '#bb9af7'
}

function scanBar(width: number, phase: number): string {
  const len = Math.max(8, width)
  const at = phase % len
  return Array.from({ length: len }, (_, i) => i === at ? '█' : '─').join('')
}

const Live: ClientModule<LiveProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  let state = surface.state
  if (state === undefined) {
    state = { phase: 0, ref: {}, scanKey: '', elapsedMs: 0 }
    surface.setState(state)
  }
  const scan = props.scan
  const scanKey = scan ? `${scan.active ? 'active' : 'result'}:${scan.startedAt}:${scan.resultAt}:${scan.result ?? ''}` : ''
  if (state.scanKey !== scanKey) {
    const elapsedMs = scan
      ? scan.active
        ? Math.max(0, scan.now - scan.startedAt)
        : Math.max(0, scan.now - scan.resultAt)
      : 0
    state = { ...state, scanKey, elapsedMs }
    surface.setState(state)
  }
  const moving = props.rows.some(r => r.segs.some(s => s.sh || s.spin)) || Boolean(scan?.active)
  if (moving && !state.ref.stop) {
    state.ref.stop = surface.every(TICK_MS, () => {
      const cur = surface.state
      if (cur) surface.setState({ ...cur, phase: cur.phase + 1, elapsedMs: cur.elapsedMs + TICK_MS })
    })
  } else if (!moving && state.ref.stop) {
    state.ref.stop()
    state.ref.stop = undefined
  }
  const phase = state.phase
  const draw = (s: LiveSeg) => {
    if (s.spin) return <Text color={s.c} bold>{`${FRAMES[phase % FRAMES.length]} `}</Text>
    const palette = s.sh ? props.tones[s.sh] : undefined
    if (!palette) {
      return (
        <Text color={s.c} bold={s.b} dimColor={s.d}>
          {s.t}
        </Text>
      )
    }
    const chars = [...s.t]
    return (
      <Text bold={s.b}>
        {chars.map((ch, i) => (
          <Text color={band(i, phase, chars.length, palette)}>{ch}</Text>
        ))}
      </Text>
    )
  }
  const drawRow = (r: LiveRow) => (
    <Box flexDirection="row" height={1} overflow="hidden">
      <Box flexDirection="row" flexShrink={1} overflow="hidden">
        {r.segs.map(draw)}
      </Box>
      <Box flexGrow={1} />
      {r.right?.length ? (
        <Box flexDirection="row" flexShrink={0}>
          {r.right.map(draw)}
        </Box>
      ) : null}
    </Box>
  )
  if (scan?.active) {
    return (
      <Box flexDirection="column">
        <Text color="#7aa2f7">{scanBar(surface.columns, phase)}</Text>
        <Box flexDirection="row" height={1} overflow="hidden">
          <Box flexDirection="row" flexShrink={1} overflow="hidden">{props.rows[0]?.segs.map(draw)}</Box>
          <Box flexGrow={1} />
          <Text dimColor>{`${Math.floor(state.elapsedMs / 1000)}s`}</Text>
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {props.rows.map(drawRow)}
    </Box>
  )
}

export default Live
