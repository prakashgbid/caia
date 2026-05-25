# Plan: @caia/devops-runtime — Stage 15 of the canonical pipeline

**Plan type:** implementation
**Caller agent:** `@caia/devops-runtime` (this package)
**Submitted by:** Stolution
**Affected components:** `@caia/devops-runtime`, `@caia/state-machine`, `@caia/devops-architect`, `@chiefaia/capability-broker`, `@chiefaia/deploy-steward`

## Goal

Build the deploy-runtime package: EXECUTES the deploy strategy specified by `@caia/devops-architect` (PR #562) in the `ticket.architecture.devops` slice. Stage 15 in the canonical pipeline — the step immediately after `@caia/per-story-tester` (Stage 14, PR #569). Distinct from the architect, which only SETS strategy; this RUNS it.

## State-machine integration

The canonical Solution-lifecycle FSM (`@caia/state-machine` PR #567) defines the following transitions around deployment:

- `merged` → `deployed` (this package; deploy + post-deploy verification both green)
- `merged` → `deployed-failed` (this package; deploy itself failed, or post-deploy verification went red within freshness window)
- `deployed-failed` → `merged` (re-attempt) | `deployed` (recovery via forward-fix) | `abandoned`
- `deployed` → `deployed-rolled-back` (post-deploy attestation regressed after first being green; runtime executes rollback contract)

The brief's `per-story-tested → deploying → deployed | deploy-failed` is the conceptual trigger. `per-story-tested` is the entry condition (Stage 14 must be green); the canonical FSM places the actual deploy edge at `merged → deployed` because PR-merge happens between test-green and deploy. `deploying` is modelled as an internal runtime state inside this package (not exposed on the canonical FSM, which already has the right edges).

No new states are added to `@caia/state-machine`; this preserves the FSM invariant (every edge enumerated in `entities/solution-transitions.ts`).

## API

```ts
import { deploy, DeployConfig, DeploymentResult } from '@caia/devops-runtime';

const result = await deploy(ticketId, 'production', config);
// → { ticketId, solutionId, targetEnv, strategy, status: 'deployed' | 'deployed-failed' | 'deployed-rolled-back',
//     attempts, durationMs, healthcheckLatencyMs?, rollbackReason?, transition, stewardAttestation? }
```

The function:
1. Loads the ticket and reads `architecture.devops` (the DevOps Architect output): `cicdPipeline`, `deployStrategy`, `rollbackContract`, `infrastructureAsCode`, `environmentPromotion`, `deploymentObservability`, `secretsManagementInPipeline`.
2. Asserts the entry-state precondition (`per-story-tested` for non-merged paths, `merged` for the canonical FSM edge) — refuses to run if precondition fails.
3. Acquires a short-lived `deploy.production` (or `cloudflare.pages.deploy.preview` for non-prod) capability token via `@chiefaia/capability-broker`.
4. Dispatches to the strategy impl by `architecture.devops.deployStrategy.strategy` ∈ {blue-green, canary, rolling, ring-deployment, recreate}.
5. Each strategy impl invokes the BYOC adapter (cloudflare-pages | k3s-helm | terraform-apply | etc.) — adapter is injected; default is `noopAdapter` for tests.
6. On strategy success, hands off to `@chiefaia/deploy-steward` for post-deploy verification (writes a row to `~/.caia/deploy-steward/runs.jsonl` matching the existing ledger schema; polls for `green: true` within the freshness window).
7. Drives `@caia/state-machine` `SolutionLifecycleMachine.advance` to `deployed` (success) or `deployed-failed` (failure).
8. On failure: synchronously executes the rollback contract (`devops.rollbackContract.method` ∈ {time-machine-snapshot, git-revert-and-redeploy}). On post-deploy regression after a previously-green attestation: drives `deployed → deployed-rolled-back` and executes rollback.
9. Returns the typed `DeploymentResult`.

## Files

- `src/types.ts` — `DeploymentResult`, `DeployConfig`, `DeployStrategy`, `RolloutPhase`, `RollbackResult`, `ByocAdapter`, `StewardClient`, `RuntimeState`.
- `src/state.ts` — Internal runtime state-machine: `idle → loading-spec → preconditions-checking → acquiring-capability → deploying → verifying → succeeded | failed → rolling-back → rolled-back | rollback-failed`. Exposes guard + transition helpers. Distinct from (and adapts to) the canonical `@caia/state-machine` solution lifecycle.
- `src/runner.ts` — Reads `ticket.architecture.devops`, validates the strategy is implementable against `infrastructureAsCode.capabilities` (re-uses the contract from `@caia/devops-architect`'s `STRATEGY_INFRA_REQUIREMENTS`), dispatches to the strategy module. Pure orchestrator — no I/O beyond the BYOC adapter call.
- `src/blue-green.ts` — Blue-green strategy: provision green, run smoke, switch traffic atomically, retain blue for rollback window.
- `src/canary.ts` — Canary strategy: deploy canary, shift `trafficShiftSchedule` over `dwellMin`, on healthcheck pass go 100%, on abortCondition go 0% and roll back.
- `src/rolling.ts` — Rolling strategy: per-batch update with `maxSurge`/`maxUnavailable`, healthcheck after each batch, abort on first red.
- `src/rollback.ts` — Executes `rollbackContract.method`: `time-machine-snapshot` (calls injected snapshot adapter), `git-revert-and-redeploy` (calls the same BYOC adapter with the prior sha).
- `src/steward.ts` — `@chiefaia/deploy-steward` integration. Writes a ledger row in the existing schema (`{ts, id, section, kind, node_id, deploy_passed, deploy_rc, deploy_reason, deploy_duration_ms, deploy_stdout, deploy_stderr, inuse_passed, inuse_rc, inuse_reason, inuse_duration_ms, inuse_stdout, inuse_stderr, green}`), polls for the `inuse_passed` + `green` fields within the freshness window. File-based default; injectable for tests.
- `src/api.ts` — `deploy(ticketId, targetEnv, config)` orchestrator: runner → strategy → steward → state-transition.
- `src/index.ts` — public surface re-exports.
- `scripts/submit-plan.mjs` — submits this PLAN.md to `@caia/ea-architect.submitPlan`.
- `tests/` — vitest unit tests (per-strategy happy/failure, state-machine transitions, rollback execution, runner dispatch, api contract, steward write-and-poll) plus one integration test against a stubbed K3s adapter wired through `stolution-remote`. Target ≥40 tests.

## Reuse

- `@caia/state-machine` — `SolutionLifecycleMachine`, `InMemorySolutionStore`, `canSolutionTransition`, `SolutionState`, `InvalidSolutionTransitionError`. The canonical FSM owns the `deployed | deployed-failed | deployed-rolled-back` edges; we only call `advance(...)`.
- `@caia/devops-architect` — `DEPLOY_STRATEGIES`, `STRATEGY_INFRA_REQUIREMENTS`, `DevopsArchitectContract`, `DEVOPS_OWNED_SECTIONS`. Re-used at runtime to validate the spec before deploying.
- `@chiefaia/capability-broker` — `CapabilityBroker`, `CapabilityExecutor`, `'deploy.production'` capability. Every deploy run acquires a short-lived token, executes through the broker, and lands on the ledger.
- `@chiefaia/deploy-steward` — file-based ledger at `~/.caia/deploy-steward/runs.jsonl` + `status.json`. We append a row per deploy run and poll the matching row for the steward's `inuse_*` + `green` fields.

## Non-goals

- No CI/CD pipeline orchestration — the deploy command is invoked from the existing `smart-cicd-agent` app; this package is the in-process executor that app calls.
- No infra provisioning — strategies invoke the BYOC adapter; the adapter is a thin wrapper around `terraform apply`, `kubectl apply -k`, `wrangler pages deploy`, etc. Adapter implementations live in their own packages.
- No metric emission beyond the steward's `deploy.started/succeeded/failed/rollback.triggered/healthcheck.failed` events — `@caia/devops-architect` owns the event taxonomy and this package emits it verbatim.
- No human-in-the-loop gate logic — `environmentPromotion.gateOwner` is honoured by the orchestrator (smart-cicd-agent), not this runtime.

## Risk register check

- **No vendor lockin**: BYOC adapter is the only surface that knows about the cloud provider. Aligns with P-no-vendor-lockin.
- **Idempotent deploys**: each deploy is keyed by `{ticketId, gitSha, environment}`; re-running with the same key returns the prior result (look up the steward ledger first).
- **Capability-token discipline**: every deploy acquires a fresh short-lived token via `@chiefaia/capability-broker`; never reuse tokens; never log them.
- **Rollback safety**: rollback runs in the SAME process as deploy, with the same capability token (still in TTL) — no operator-on-hook gap.
- **Deterministic clock + IDs**: `deploy()` accepts an optional `clock` and `runId` factory; defaults to `() => new Date()` and `crypto.randomUUID()`.
- **Steward integration is file-based + injectable**: tests inject an in-memory steward; production points at `~/.caia/deploy-steward/runs.jsonl`. No filesystem coupling in unit tests.

## Quality gates

- `pnpm -F @caia/devops-runtime build` clean
- `pnpm -F @caia/devops-runtime typecheck` clean (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess)
- `pnpm -F @caia/devops-runtime test` green — ≥40 tests, coverage ≥80% lines
- True-Zero on caia preserved.

## Approval request

Approve to proceed with implementation as specified.
