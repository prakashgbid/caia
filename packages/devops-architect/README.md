# @caia/devops-architect

Architect **#17 of 17** in CAIA's EA fan-out. **This package completes the roster** — once it merges, every architect contract is in place and the EA Dispatcher can fan-out across all 17 in parallel for any ticket.

Senior DevOps engineer focused on CI/CD + deployment strategies + rollback safety. Produces per-ticket **DEPLOY STRATEGY** specs.

## Distinct from neighbouring packages

This architect SPECIFIES how a deploy should happen. It does NOT execute deploys.

- The **`caia/packages/deploy-steward`** bin/launchd EXECUTES deploys (it's not a TS package per the V2 audit — it's a launchd-triggered shell tool).
- The **QA Engineer agent** validates production after deploy.
- The **DevOps Architect (this package)** sets the STRATEGY: pipeline shape, deploy strategy, rollback contract, IaC patterns, env promotion gates.

## Position in the architect fan-out

- **Wave**: 3 (depends on Backend Architect + Database Architect + Security Architect).
- **Precedence rank**: **2** per spec §5.2 — only Security outranks DevOps, because the operator is on the hook for a bad deploy.
- **Runtime model**: Sonnet.

## What it owns

`devops.*` slice of the `tickets.architecture` JSONB column:

- `devops.cicdPipeline` — GitHub Actions / GitLab CI / etc. (per customer's choice from onboarding)
- `devops.deployStrategy` — blue-green / canary / ring deployment / rolling
- `devops.rollbackContract` — how to roll back a bad deploy
- `devops.infrastructureAsCode` — Terraform / Pulumi / Kubernetes manifests (per customer's choice)
- `devops.environmentPromotion` — dev → staging → prod gates
- `devops.deploymentObservability` — what gets logged per deploy
- `devops.secretsManagementInPipeline` — forward-references the Security Architect

## What it does NOT do

No component code, no API endpoints, no SQL DDL, no UI. DevOps specifies the deployment contract that the deploy-steward executor implements.

## Per-customer choices from onboarding

The architect reads onboarding choices from `tenantContext` and the input `businessPlan`:

- **CI/CD provider** — GitHub Actions (default), GitLab CI, CircleCI, Buildkite
- **Cloud provider** — Cloudflare (default), AWS, GCP, Azure, fly.io
- **IaC tool** — Terraform (default), Pulumi, Kubernetes manifests, CDK
- **Repo provider** — GitHub (default), GitLab, Bitbucket

When onboarding provides no choice the architect picks the locked default and notes the assumption in `risks[]`.

## Deploy strategy realism (golden test)

The golden test verifies the deploy strategy is realistic:

- **blue-green** requires `2× infra` (two identical production environments).
- **canary** requires `traffic-split` capability (a load-balancer or service-mesh that can route a fraction of traffic).
- **ring deployment** requires `multi-region` topology (rings are concentric blast-radius bands).
- **rolling** requires `multi-instance` minimum (you can't roll a singleton).

The architect MUST flag mismatches between the chosen strategy and the available infra. The golden assistant text picks a strategy that matches the canonical contact-form ticket's infrastructure shape.

## Quick start

```ts
import { DevopsArchitect, DevopsArchitectContract } from '@caia/devops-architect';

const architect = new DevopsArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: { backend, database, security } },
  budget: {
    maxInputTokens: 60_000, maxOutputTokens: 8_000,
    maxWallClockMs: 60_000, preferredModel: 'sonnet',
    hardCostCeilingUsd: 0.5,
  }
});
```

## Testing

```bash
pnpm test        # full Vitest suite (>=30 tests, including deploy-strategy-realism golden)
pnpm typecheck   # tsc --noEmit
pnpm build       # emit dist/
pnpm lint        # eslint src tests
```

The test suite includes interface compliance, contract structural checks, registration disjointness vs frontend + backend + database + security, output validation, run() idempotency, dependency declaration (`['backend','database','security']`), cross-architect invariants (rollback contract reality, deploy-strategy infra match, secrets via Security, environment promotion sanity), and an end-to-end golden test against a known prakash-tiwari contact-form Story ticket.

## 17 of 17 — milestone

This is the final architect. With DevOps shipped, the canonical 17-architect roster is complete and the EA Dispatcher can fan-out across the full set:

```
Wave 1: Frontend, Backend, SEO, Feature Flagging, Time Machine, UX Version Control, AI/ML
Wave 2: Database, Accessibility, Performance, Analytics, Observability, Security, API Gateway, Testing
Wave 3: A/B Testing, DevOps
```
