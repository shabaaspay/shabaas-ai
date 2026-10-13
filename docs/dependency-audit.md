# Automatic dependency audit

This repository's feature branch introduces the **Dependency audit** check. The workflow runs automatically on every pull request (no path filter), pushes to `main` and `feature/**`, merge queues, and weekly; manual dispatch is also available. The weekly schedule becomes active only after human review merges this workflow into the default branch.

| Manifest | Auditor |
| --- | --- |
| tools/typescript/package.json | npm |

npm audits the committed lock tree, including development dependencies and workspaces, and fails on HIGH/CRITICAL. Yarn uses the committed dependency tree with the same severity threshold; Classic's severity-bitmask exit code is interpreted explicitly. Python and Ruby fail on any known advisory because comparable severity is not consistently provided by their native reports. That is stricter than the npm threshold. All tools fail closed on unavailable/malformed reports or missing required lockfiles. npm also checks manifest/lock consistency. New tracked dependency manifests require explicit coverage and cannot silently bypass auditing.

This gate does not start the application, execute package lifecycle scripts, invoke payment tests, access production, deploy, send messages or use application secrets. Registry/advisory queries transmit package names and versions. Requirements without exact pins audit the resolution obtained on the runner, not a verified deployed environment. Runtime OS/image packages and native Android/iOS libraries are outside this dependency-manifest gate; existing container scanning remains in place where available.

The self-contained runner and failure-policy tests are stored in `.github/scripts/`; `ci-templates` holds the common version. Copies keep PRs reviewable and avoid reliance on unmerged cross-repository reusable-workflow permissions. Auditors are pinned (pip-audit 2.10.1, bundler-audit 0.9.3, and the Yarn generation matching the lockfile); advisory databases are refreshed during each run. npm is provided by Node 22. Reports and a job summary are retained even when the gate fails, with artifact retention limited to seven days. Scanner and artifact-upload errors must be reviewed separately from vulnerability findings.

## Required enforcement review before closing

1. Review and merge this feature PR through the human review process; no automatic merge is configured. Open PRs are not closed by this rollout.
2. In the `main` branch ruleset/protection, require pull requests, human review, and the **Dependency audit** status check; select the actual emitted check context from the successful workflow run. Enable strict/up-to-date checks or merge queue and limit bypass privileges as appropriate.
3. Confirm the default-branch and scheduled runs after merge. A failed audit is a blocker, not a pass or an exemption. Remediate advisories or missing reproducible dependency locks via separate reviewed changes.

The connected GitHub integration returned HTTP 403 for branch-protection inspection, so merge-blocking enforcement has **not** been verified or changed. Automatic CI execution is implemented; branch-rule enforcement and post-merge scheduling remain pending human review. Do not mark the rollout closed until those controls and current scan evidence are verified.

