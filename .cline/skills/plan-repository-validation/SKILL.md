---
name: plan-repository-validation
description: "Select focused checks and diagnose failures for repository changes or CI problems. Use for validation planning and evidence review, not automatic live execution."
---

1. Read AGENTS.md and docs/agent-context.json. Inspect the actual declared commands and required runtime; no manifest entry authorizes execution.
2. Choose the smallest meaningful offline checks for the changed behavior. Classify browser/device/network/payment checks separately and use existing approvals.
3. Classify failures as source, test, dependency, credentials, environment or evidence before editing. Preserve failed assertions and unknown payment outcomes.
4. Record exact commit, command, selected tests, outcome and remaining blockers using docs/agent-task-template.md; do not label listing, compilation or mocks as live coverage.
