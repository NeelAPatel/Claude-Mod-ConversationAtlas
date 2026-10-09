Closes #

- Layer: <!-- engine / ui-base / tui / gui / docs / process -->
- Golden impact: <!-- none / terminal / desktop / both / all; name the goldens -->
- Shared files touched: <!-- none, or list -->
- Verdict: <!-- sim-verified / unit-test-verified / type-check-only / unproven (owner-eye) -->

## Why
<!-- The problem and the approach in one to three short sentences. -->

## What changed
<!-- One to three short bullets. -->

## Scope
<!-- What this covers and what it deliberately leaves out. -->

## Blast radius
<!-- Who or what this touches and why that is safe or risky. -->

## Proof check
<!-- Table: Claim | Label | Evidence. Labels: sim-verified, unit-test-verified, type-check-only, unproven (owner-eye). See docs/process/NAMING.md. -->

## Checks
- [ ] One change, branched from `dev`
- [ ] `node scripts/check.mjs` prints `RESULT PASS`
- [ ] Golden diff included and explained (if drawn output changed)
- [ ] Observation never writes intent / no cost before consent still hold

## Owner eye test (only if the verdict is `unproven (owner-eye)` or the look changed)
- [ ] terminal, 46 columns
- [ ] terminal, 80 columns
- [ ] desktop, narrow
- [ ] desktop, wide
