# Atlas golden snapshots

These files are text snapshots of the fixed reducer-built sample state. They cover the Map, Trail, Open, Evidence, Legend, Trail event popup, and setup/consent screen on terminal and desktop at body widths 46 and 80. Each line is a drawn text row; the trailing annotation records exposed color, bold, italic, and dim styling so glyph and style changes are visible in review.

Normal `claude plugin test .` runs compare-only tests and prints a unified diff on a mismatch. The plugin-test sandbox does not expose filesystem or environment APIs to test bodies, so the explicit opt-in updater temporarily enables capture, runs the same tests, writes the text files and manifest, and restores the test source:

```powershell
.\tests\golden\update-goldens.ps1
```

The tests compare against `manifest.ts` because the sandbox cannot read the `.txt` files directly. The updater regenerates both from the same `ui.drawn()` capture, keeping the reviewable `.txt` files and the executable expectation in sync.

Every visual change needs a brief naming the exact goldens it may change. Review the golden diff before installing or merging.
