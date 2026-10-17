# Repository context maintenance

Canonical project instructions remain in AGENTS.md (including existing governance). The small navigation/command manifest is docs/agent-context.json. Its reviewed_base is a historical inventory anchor, not a claim that future changes are tested. Recheck source before acting.

Start with `python scripts/agent_context.py map`. For a focused task use `python scripts/agent_context.py map --paths restapi/shabaaspay-public-api.yaml`. This prints bounded metadata, not source, secrets, logs or all history. Read only the selected modules and necessary dependencies. Empty path selection loads no conditional rules. Paths are repository-relative and must be tracked; untracked new work can be inspected directly after checking scope.

Edit conditional instructions only in the manifest, then run `python scripts/agent_context.py sync` and `python scripts/agent_context.py check`. Generated Cline adapters use `paths`; Copilot uses `applyTo`. Their bodies intentionally match one canonical source. `CLAUDE.md` imports root instructions, while the Copilot entrypoint is a short pointer. Native loading/precedence depends on client version; confirm applied-rule indicators when upgrading clients.

The dependency-free checker verifies tracked references, declared npm scripts, bounded scopes, generated adapter consistency and concise entry instructions. The Agent context integrity workflow runs on pull requests and feature/default-branch pushes. It does not run paid APIs, send email, scan hosts, install hooks or alter deployment workflows. It becomes a required merge gate only if a repository administrator enables it in rulesets; this PR does not change repository settings.

`.clineignore` is a legacy compatibility aid for clients honoring it. Current Cline documentation describes its phase-out: https://docs.cline.bot/customization/clineignore . For newer clients use the bounded map and explicit source selection; do not claim automatic exclusion enforcement. Ignore patterns and instruction text are not a security boundary. Use isolated execution and scoped credentials. Lockfiles, schemas, fixtures, migrations and policy remain available. Load individual run evidence only for diagnosis, never all historical runs by default.

Use docs/agent-task-template.md for substantial tasks and concise handoffs. 

Two opt-in Cline skills under .cline/skills cover focused change review and validation planning; discovery support depends on the installed client. Their procedures do not execute commands automatically.

Compare input tokens, total task cost, elapsed time, correction rounds and accepted deliverables on equivalent tasks before/after adoption. No savings or live client compatibility is claimed by structural CI.
