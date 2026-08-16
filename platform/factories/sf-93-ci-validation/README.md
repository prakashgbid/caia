# SF-93 CI Validation Factory

Thin-slice CAIA microfactory. Wraps existing self-hosted GitHub Actions CI
(STOL-874) — **no new CI infra**.

## Contract
- **Input:** `CommitResult { commit_sha, branch, repo }` (from SF-91)
- **Output:** `CIResult { conclusion, run_id, run_url, checks[], duration_s }`
- **Event on completion:** `caia.factory.ci.result` (published by executor)
- **Event on failure:** routed to SF-104 defect triage

## Reuse
- Trigger: `POST /repos/{repo}/actions/workflows/{wf}/dispatches` (workflow_dispatch)
- Poll: `GET /repos/{repo}/actions/runs?head_sha={sha}`
- Checks: `GET /repos/{repo}/commits/{sha}/check-runs`

Runs on the same self-hosted runners already provisioned on stolution box
(actions-runner-stol-3 through -15). **Zero recurring cost — see
[[ci-cost-elimination-direction]].**

## Env
- `GITHUB_TOKEN` — repo dispatch scope
- `GITHUB_REPO` (default `thivaan/stolution`)
- `CAIA_CI_WORKFLOW` (default `ci.yml`)
- `CAIA_CI_POLL_S` (default 10)
- `CAIA_CI_TIMEOUT_S` (default 1800)
