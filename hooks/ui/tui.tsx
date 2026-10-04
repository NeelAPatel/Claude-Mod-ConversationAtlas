import type { RenderElement } from 'claude-code'
import {
  collapseBarLabelsWith,
  measuredBarItemWidth,
  type BarItem,
  type BarKind,
  type GlyphSet,
  type UiContext,
} from './shared'
import type { ActionGroupOptions, ActionItem, SurfaceKit } from './kit'

export const tuiGlyphs: GlyphSet = {
  goal: '◎', suggestion: '○', currentTopic: '●', detour: '↳', returned: '↩',
  observedDecision: '◇', settledDecision: '◆', checkpoint: '⚑', openQuestion: '?', resolved: '✓',
  ok: '✓', fail: '✗', editedFile: '✎', readFile: '·', fresh: '✦', expanded: '▾', prompt: '›',
  next: '▸', resume: '◎', handoff: '→', reportBack: '←',
}

export function tuiMeasuredBarItem(item: BarItem, label: string, kind: BarKind, hotkeys = true): number {
  const activeTab = kind === 'tabs' && item.active
  return measuredBarItemWidth({
    label,
    hotkey: hotkeys && !activeTab ? item.hotkey : undefined,
    icon: kind === 'bar' ? item.icon : undefined,
    activeMarker: activeTab ? '▸' : undefined,
    prefixGap: kind === 'bar' && item.icon ? 1 : 0,
  })
}

export function tuiCollapseBarLabels(items: BarItem[], width: number, gap = 1, kind: BarKind = 'bar') {
  return collapseBarLabelsWith(items, width, ['full', 'short'], tuiMeasuredBarItem, gap, kind)
}

export function Tabs(ctx: UiContext, items: BarItem[], gap = 1): RenderElement {
  const { Box, Button, Text } = ctx.el
  const choice = tuiCollapseBarLabels(items, ctx.width, gap, 'tabs')
  return (
    <Box key="tab-bar" flexDirection="column" gap={0} overflow="hidden" flexShrink={0}>
      {choice.grid.rows.map((row, rowIndex) => (
        <Box key={`tab-row-${rowIndex}`} flexDirection="row" gap={gap} flexShrink={0} overflow="hidden">
          {row.items.map(index => {
            const item = items[index]
            const label = choice.labels[index] ?? ''
            return (
              <Box key={`tab-cell-${item?.key ?? index}`} width={choice.grid.columnWidths[index % choice.grid.columns]} flexShrink={0} overflow="hidden">
                {item?.active
                  ? <Text key={item.key} bold color={item.activeColor} wrap="truncate-end">{`▸${label}`}</Text>
                  : <Button
                      key={item?.key ?? String(index)}
                      plain
                      hotkey={choice.tier === 'compact' ? undefined : item?.hotkey}
                      label={label}
                      onPress={() => item?.onPress()}
                    />}
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

export function Bar(ctx: UiContext, items: BarItem[], gap = 1): RenderElement {
  const { Box, Button, Text } = ctx.el
  const choice = tuiCollapseBarLabels(items, ctx.width, gap, 'bar')
  return (
    <Box key="bottom-bar" flexDirection="column" gap={0} overflow="hidden" flexShrink={0}>
      {choice.grid.rows.map((row, rowIndex) => (
        <Box key={`bar-row-${rowIndex}`} flexDirection="row" gap={gap} flexShrink={0} overflow="hidden">
          {row.items.map(index => {
            const item = items[index]
            const label = choice.labels[index] ?? ''
            return (
              <Box key={`bar-cell-${item?.key ?? index}`} width={choice.grid.columnWidths[index % choice.grid.columns]} flexShrink={0} overflow="hidden">
                <Box flexDirection="row" gap={1} flexShrink={0} overflow="hidden">
                  {item?.icon ? <Text dimColor={!item.active} wrap="truncate-end">{item.icon}</Text> : null}
                  <Button
                    key={item?.key === 'mark' ? 'mark' : `bar-${item?.key ?? index}`}
                    plain
                    hotkey={choice.tier === 'compact' ? undefined : item?.hotkey}
                    dimColor={!item?.active}
                    label={label}
                    onPress={() => item?.onPress()}
                  />
                </Box>
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

export function ActionGroup(
  ctx: UiContext,
  items: ActionItem[],
  options: ActionGroupOptions = {},
): RenderElement {
  const { Box, Text, Button } = ctx.el
  const marginLeft = options.marginLeft ?? 2
  const gap = options.gap ?? 1
  const flexWrap = options.flexWrap ?? 'wrap'
  return (
    <Box flexDirection="row" gap={gap} marginLeft={marginLeft} flexWrap={flexWrap}>
      {items.map(item => item.primary
        ? <Button
            key={item.key}
            label={item.label}
            variant="primary"
            {...(item.role ? { role: item.role } : {})}
            onPress={() => item.onPress()}
          />
        : <Box key={`action-${item.key}`} flexDirection="row">
            <Text color="#7dcfff">[</Text>
            <Button key={item.key} plain label={item.label} hover={{ color: '#7dcfff' }}
              {...(item.role ? { role: item.role } : {})} onPress={() => item.onPress()} />
            <Text color="#7dcfff">]</Text>
          </Box>)}
    </Box>
  )
}

export function rule(ctx: UiContext): RenderElement {
  const { Text } = ctx.el
  return <Text dimColor>{'─'.repeat(Math.max(1, ctx.width))}</Text>
}

export function titleRule(ctx: UiContext, width: number, color: string): RenderElement {
  const { Box, Text } = ctx.el
  const name = width >= 34 ? ' Conversation Atlas ' : ' Atlas '
  const left = Math.max(1, Math.floor((width - name.length) / 2))
  return (
    <Box flexDirection="row" flexShrink={0} height={1}>
      <Text dimColor>{'─'.repeat(left)}</Text>
      <Text bold color={color}>{name}</Text>
      <Text dimColor>{'─'.repeat(Math.max(1, width - name.length - left))}</Text>
    </Box>
  )
}

export const tuiKit: SurfaceKit = {
  glyphs: tuiGlyphs,
  collapseBarLabels: tuiCollapseBarLabels,
  measuredBarItem: tuiMeasuredBarItem,
  Tabs,
  Bar,
  ActionGroup,
  rule,
  titleRule,
}
