# Desktop layout decisions

- The pane starts with a flush row of native tab buttons over an SVG baseline. The selected tab uses the primary style and a short accent underline; the bottom Legend action uses the same active treatment, while + Mark stays a regular action button.
- Rows use a fixed, centered icon slot, a flexible title cell that truncates first, and a trailing metadata group that keeps its width. File paths use middle truncation. Prose wraps only in detail and help blocks. Settings are native pressable labels with their current state included in the label.
- Section headings pair their tone and count with a small `?` button. Explanations stay inline under the heading.
- Details indent beneath their row. Trail events, decisions, open questions, and Trail Settings use bordered, absolute panels with bounded content windows and native close, pager, and scroll buttons.
- Legend is a plain content panel with the existing glyph and count meanings; its Observer control shows the active mode. The pane keeps its scroll bounds and live scan Client. Overflow uses an SVG track and a visible pressable thumb alongside the scroll buttons.
