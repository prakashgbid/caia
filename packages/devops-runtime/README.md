# @caia/devops-runtime

**Stage 15** of the CAIA canonical pipeline. EXECUTES the deploy strategy specified by `@caia/devops-architect` (architect #17, PR #562).

Distinct from `@caia/devops-architect`:

| | `@caia/devops-architect` (#562) | `@caia/devops-runtime` (this pkg) |
|---|---|---|
| Role | SETS strategy | RUNS strategy |
| Owns | `ticket.architecture.devops.*` (cicdPipeline, deployStrategy, rollbackContract, IaC, env promotion, observability, secrets) | `deploy(ticketId, targetEnv) → DeploymentResult` |
| Output | Per-ticket DEPLOY STRATEGY spec | Deployment events + state-machine transition |
| State-machine edge | — | `merged → deployed \| deployed-failed`, `deployed → deployed-rolled-back` |

## Usage

```ts
import { deploy } from '@caia/devops-runtime';

const result = await deploy('TKT-123', 'production', {
  ticketStore,                 // loads ticket + architecture.devops
  byocAdapter,                 // your cloud adapter (cloudflare-pages | k3s-helm | terraform | …)
  capabilityBroker,            // @chiefaia/capability-broker instance
  solutionMachine,             // @caia/state-machine SolutionLifecycleMachine
  steward,                     // @chiefaia/deploy-steward client (file-based default)
});

if (result.status === 'deployed') {
  // strategy + steward both green
} else if (result.status === 'deployed-failed') {
  // strategy or steward red; rollback executed; result.rollback has details
}
```

See `PLAN.md` for the full architecture brief.

## Reuse

- `@caia/state-machine` — canonical Solution lifecycle FSM
- `@caia/devops-architect` — strategy enum + infrastructure-realism contract
- `@chiefaia/capability-broker` — short-lived `deploy.production` capability tokens
- `@chiefaia/deploy-steward` — post-deploy verification ledger
