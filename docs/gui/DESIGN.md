# Desktop layout decisions

- The pane starts with a flush row of native tab buttons over an SVG baseline. The selected tab uses the primary style and a short accent underline; the bottom Legend action uses the same active treatment, while + Mark stays a regular action button.
- Rows use a fixed, centered icon slot, a flexible title cell that truncates first, and a trailing metadata group that keeps its width. File paths use middle truncation. Prose wraps only in detail and help blocks. Settings are native pressable labels with their current state included in the label.
- Section headings pair their tone and count with a small `?` button. Explanations stay inline under the heading.
- Details indent beneath their row. Long Open and Evidence items expand inline with their detail lines, Add to message, and Close actions.
- Trail Settings are always visible as a wrapping toolbar under the Trail heading: Story/Log, order, and report-back/hand-off visibility. The shared screen settings rows supply each label and action; the desktop draws native controls and does not open a settings panel.
- A popup left open by the terminal view appears as a small inline notice at the top of the desktop body with a Close it action. The desktop has no popup panels or absolute-positioned boxes.
- Legend is a plain content panel with the existing glyph and count meanings; its Observer control shows the active mode. The pane keeps its scroll bounds and live scan Client. Overflow uses an SVG track and a pressable thumb alongside the scroll buttons.
