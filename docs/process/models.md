# Model roles

| Role | Model | Effort | When |
| --- | --- | --- | --- |
| Mechanical, docs, renames, tiny fix plus test | `gpt-6-luna` | medium | Bounded edits with clear acceptance. |
| Scoped logic fix with tests | `gpt-6-luna` | high | One or two files with local behavior. |
| Cross-file renderer, geometry, or design-sensitive | `gpt-6.1-sol` | medium-high | Review tradeoffs across surfaces. |
| Hardest work or after a cheaper run failed | `gpt-6.1-sol` / `gpt-6-astra` | high-xhigh | State why the harder model is needed. |
| Claude searches and log scans | Haiku | low | Find facts and exact locations. |
| Claude synthesis | Sonnet | low-medium | Summarize evidence and options. |
| Claude hard judgment | Opus | case-specific | Reserve for decisions needing its depth. |

Batch jobs that read the same files into one run. Never fork a large thread; write a self-contained brief. Record `tokens used` per job.
