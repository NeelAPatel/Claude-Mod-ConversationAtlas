# Security policy

Atlas makes no network calls and sends no telemetry. It reads session activity inside Claude Code
and writes save files under `<project>/.claude/atlas/` and Claude Code's plugin store.

## Reporting a vulnerability

Please **don't** open a public issue for a security problem. Use GitHub's private reporting:
**Security → Report a vulnerability** on this repository. Include what you saw, the Claude Code
version, and steps to reproduce. You can expect a first reply within a week.

In scope: anything that makes Atlas send data off the machine, write outside its folders, act on
intent without a user action, or inject unconfirmed content into Claude's prompt.
