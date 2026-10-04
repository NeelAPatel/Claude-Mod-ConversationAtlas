# Desktop layout decisions

- The pane starts with a wrapping row of native tab buttons. The selected tab uses the primary style; the bottom Legend and + Mark actions are native buttons without measured widths.
- Rows use a fixed icon slot, a flexible title cell, and a trailing metadata group. Prose wraps only in detail and help blocks. Settings are native pressable labels with their current state included in the label.
- Section headings pair their tone and count with a native Info button. Explanations stay inline under the heading.
- Details indent beneath their row. Trail events, decisions, open questions, and Trail Settings use borderless, absolute panels with bounded content windows and native close, pager, and scroll buttons.
- Legend is a plain content panel with the existing glyph and count meanings. The pane keeps its scroll bounds and live scan Client while dropping duplicated title and bottom rules.
