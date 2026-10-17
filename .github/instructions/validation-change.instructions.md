---
applyTo: "tools/typescript/package.json"
---

# Validation and workflow changes

- Use docs/agent-context.json for declared commands and limitations; inspect the actual script and target before running it.
- Separate offline checks, mocks, live non-production execution and production observations. Record exact revision, command, result and blockers.
- Classify application, test, authentication, dependency and artifact failures before changing source. Never weaken assertions to obtain a pass.
- Update context metadata when paths or commands change, run python scripts/agent_context.py sync, then python scripts/agent_context.py check.
