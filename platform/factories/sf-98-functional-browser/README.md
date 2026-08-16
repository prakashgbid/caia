# SF-98 Functional Browser Factory

**REBADGE of live-verify-runner (STOL-863).** No new browser infra — the
existing runner already ships Playwright + axe-core (a11y) + Lighthouse (CWV)
and is already deployed on the stolution box.

## Contract
- **Input:** `TestEnvironment` (base_url + auth + viewport) + `ExecutionPolicy` (suites)
- **Output:** `FunctionalResults { pass, tests[], a11y[], cwv{}, artifacts_url }`
- **Event on completion:** `caia.factory.functional.result`
- **Event on failure:** routed to SF-104 defect triage

## Reuse
- Calls `POST {LIVE_VERIFY_RUNNER_URL}/run` with target + policy JSON
- Runner writes artifacts (traces, screenshots, HAR) to MinIO
- Runner emits its own Prometheus metrics — SF-98 does not re-instrument

## Env
- `LIVE_VERIFY_RUNNER_URL` (default `http://live-verify-runner:8080`)
- `LVR_TIMEOUT_S` (default 600)
