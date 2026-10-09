# Scrolling

Scrolling moves the Simulator window over the rendered body and can redraw at a different body size.
The app bar remains in the frame while the body window changes.

## How to reach it

    pwsh scripts/control-atlas.ps1 --surface tui --width 80 --height 10 --step "snapshot" --step "press scroll-down" --step "scroll 5" --step "size 46x12"

The scroll-down frame stayed at window offset 0; scroll 5 moved it to offset 5; size redrew at 46x12.

## What to look for

- The frame header reports current offset and total lines.
- scroll N moves the window by a signed row count.
- size WxH redraws the same view with new body dimensions.

## Gotchas

- The pane's scroll-up and scroll-down Buttons do not move the Simulator window. Use scroll N.
- Engine wheel, real mouse, live resize paint, and word wrapping are unproven by this route.

## Button keys

scroll-up, scroll-down, sb-*
