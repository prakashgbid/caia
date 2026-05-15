# m1-deployment-bundle (placeholder)

This directory is reserved for the full M1-host deployment bundle of `claude-spawner-agent`
(install.sh, uninstall.sh, version.txt, signed-launchd helpers, etc.).

## Why a placeholder?

B2 migrated from a stolution (Linux) worker because the parallel B-chain on M3 had not
yet reached this phase. The full M1-side deployment bundle lives on M3 at
`~/Documents/projects/reports/claude-spawner-agent/m1-deployment-bundle/` and could not
be relocated byte-for-byte from a stolution worker without a stolution-readable mirror
of the bundle. Filing this README to mark the slot for the operator follow-up.

## OPERATOR_ACTION_REQUIRED

After this PR merges, the operator must:

1. On M3, copy the existing `m1-deployment-bundle/` contents into
   `services/claude-spawner-agent/m1-deployment-bundle/` and commit a follow-up PR.
2. Until that PR lands, M1 hosts install `claude-spawner-agent` via the manual steps
   documented in the parent `README.md` (clone → venv → pip → render plist → launchctl
   load). The manual path is fully functional; the deployment bundle is a convenience
   wrapper, not a runtime dependency.

## What is intentionally NOT in this bundle

- `ANTHROPIC_API_KEY` — the spawner strips it from subprocess env on every call. The
  zero-dollar rule (`feedback_no_api_key_billing.md`) is non-negotiable.
- Any subscription-cost dependency (paid SaaS, paid API, paid hosting).

## Tracking

Filed against integration-remediation plan §B Phase B2, AR-3 invariant. This placeholder
is gated by the operator follow-up listed in the PR description's `OPERATOR_ACTION_REQUIRED`
section.
