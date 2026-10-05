# Releasing

One version, one place: `version` in `.claude-plugin/plugin.json`. Do not set it in
`marketplace.json`. Users only receive an update when that string changes, so bump it on every
release.

## Rules

- **First push to `main` is v0.1.0 and must be a complete push.** It happens only after the owner
  gives final validation of the installed build. Nothing is pushed to `main` for any other reason
  first.
- `main` only fast-forwards from `dev` after the owner confirms the installed build works.
- Every release gets a tag `vX.Y.Z` and a `CHANGELOG.md` entry.
- Semver while below 1.0: `0.MINOR.0` for features or behaviour changes, `0.x.PATCH` for fixes.

## Checklist

1. On `dev`: `claude plugin test .`, `claude plugin validate --strict .`, `scripts/check-seam.ps1`.
2. Bump `version` in `.claude-plugin/plugin.json`; add the `CHANGELOG.md` entry; update the README
   badge.
3. Install from `dev` (`scripts/install-atlas.ps1`), `/reload-plugins`, owner tries it.
4. Owner gives final validation.
5. Fast-forward `main` from `dev`, then `git tag vX.Y.Z` and push `main` and the tag together.

## How users install

```bash
claude plugin marketplace add NeelAPatel/Claude-Mod-ConversationAtlas
claude plugin install conversation-atlas@neel-cc-mods
```

Update: `claude plugin update conversation-atlas@neel-cc-mods`. Auto-update is off until the user
turns it on under Marketplaces in `/plugin`.

## Test the marketplace locally

```bash
claude plugin marketplace add ./
claude plugin install conversation-atlas@neel-cc-mods
claude plugin marketplace remove neel-cc-mods   # clean up
```
