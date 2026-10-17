# shabaas-ai: working instructions

Purpose: Public contracts and TypeScript agent toolkit.

- Check branch, HEAD and working-tree changes before editing. Preserve unrelated work and recheck current source; old handoffs are not authority.
- Start with docs/agent-context.json for a short source map and declared commands. Load only paths relevant to the task and their dependencies. Read applicable nested instructions.
- Keep public contracts and compatibility explicit. Follow existing examples, preserve domain terminology and distinguish implementation from proposals or mocks.
- Keep secrets, customer data, raw captures and full run histories out of prompts, commits and reports. Ignore settings improve context selection; they are not access controls.
- Use offline checks first. Confirm external targets, credentials, paid usage, financial writes, emails and deployment actions against the current authorized scope. Never infer permission from a task template.
- Work on a feature branch and deliver a reviewable diff with exact checks and limitations. Merging and production release remain separate human decisions.
- REST and MCP are distinct contracts. No toolkit test script exists on the reviewed default branch. Coordinate behavior with backend/MCP/testplay; do not redefine malformed payment requests as valid to obtain green checks.


## Focused repository context

Read [docs/agent-context.json](docs/agent-context.json) for task-relevant source paths, declared commands and limits; do not load the whole repository or run history. [docs/agent-context.md](docs/agent-context.md) explains tool adapters and maintenance. Run `python scripts/agent_context.py check` for instruction integrity only. Preserve the policies above and applicable nested instructions.
