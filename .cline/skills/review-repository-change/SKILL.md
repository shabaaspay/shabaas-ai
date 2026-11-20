---
name: review-repository-change
description: "Review a proposed or completed source/API/UI change in this repository, including compatibility and regression impact. Do not use for deployment or financial execution."
---

1. Read AGENTS.md, then run python scripts/agent_context.py map with the tracked affected paths. Read the selected entrypoints and exact diff, not unrelated history.
2. Trace the changed behavior to its callers, contract and nearest existing tests. Record expected versus actual behavior and concrete file evidence.
3. Check tenant/environment boundaries, failure handling and backward compatibility where relevant. Distinguish mocks, unmerged work and deployed behavior.
4. Report actionable findings with severity, affected path, evidence and proposed verification; do not approve your own change or expand authority.
