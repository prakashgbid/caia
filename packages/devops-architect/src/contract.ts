/**
 * `DevopsArchitectContract` — the canonical owned-fields declaration for
 * architect #17 of CAIA's 17-architect EA fan-out. **This contract
 * completes the roster.**
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.17 (DevOps/Deployment Architect owns `devops.*`)
 *   - task brief (cicdPipeline, deployStrategy, rollbackContract,
 *     infrastructureAsCode, environmentPromotion, deploymentObservability,
 *     secretsManagementInPipeline)
 *
 * The reconciled superset below merges spec §2.17's stack-lock fields
 * (ciPipeline / deployStrategy / rollbackContract / infrastructureAsCode /
 * environmentPromotion / buildArtifactSpec / secretsInjectionStrategy /
 * healthcheckPolicy) with the task brief's outcome-oriented names
 * (cicdPipeline / deploymentObservability / secretsManagementInPipeline).
 * The task brief is the source of truth; field names below mirror the
 * brief verbatim.
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. Every key lives under the `devops.*` namespace
 * and does not collide with any sibling architect.
 *
 * Upstream dependencies (`dependsOn`): Backend Architect (`backend.framework`,
 * `backend.serviceBoundaries`, `backend.apiEndpoints`), Database Architect
 * (`database.engine`, `database.migrations`, `database.tenantIsolationStrategy`),
 * and Security Architect (`security.secretsHandling`,
 * `security.auditLogRequirements`, `security.tenantIsolationGuarantees`).
 * DevOps is a **wave-3** architect.
 *
 * Precedence rank **2 (second-highest, only Security outranks)** per
 * spec §5.2 — the operator is on the hook for a bad deploy contract.
 */

import type {
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  Ticket
} from './types.js';

// ─── Onboarding choice domains ──────────────────────────────────────────────

/**
 * Locked enumeration of CI/CD providers the architect understands. The
 * customer picks during onboarding; the architect emits a `cicdPipeline`
 * block tailored to that provider's syntax.
 */
export const CICD_PROVIDERS: readonly string[] = [
  'github-actions',
  'gitlab-ci',
  'circleci',
  'buildkite',
  'azure-pipelines'
];

/**
 * Locked enumeration of cloud providers.
 */
export const CLOUD_PROVIDERS: readonly string[] = [
  'cloudflare',
  'aws',
  'gcp',
  'azure',
  'fly-io',
  'render'
];

/**
 * Locked enumeration of IaC tools.
 */
export const IAC_TOOLS: readonly string[] = [
  'terraform',
  'pulumi',
  'kubernetes-manifests',
  'cdk',
  'cloudformation'
];

/**
 * Locked enumeration of repo providers.
 */
export const REPO_PROVIDERS: readonly string[] = ['github', 'gitlab', 'bitbucket'];

/**
 * Locked enumeration of deploy strategies the architect supports.
 * Realism predicates (see `invariants.ts`) cross-check the chosen
 * strategy against the available infrastructure.
 */
export const DEPLOY_STRATEGIES: readonly string[] = [
  'blue-green',
  'canary',
  'ring-deployment',
  'rolling',
  'recreate'
];

/**
 * Deploy-strategy → required infrastructure capability map. Used by the
 * `devops.deployStrategy-requires-realistic-infra` invariant and the
 * golden test. Each entry lists the capabilities that MUST be present
 * in `devops.infrastructureAsCode.capabilities` (or `evidenceRefs` to
 * an upstream architect's field) for the strategy to be implementable.
 *
 *   - **blue-green** — needs two identical production environments
 *     (2× infra) so you can cut traffic atomically.
 *   - **canary** — needs a load-balancer / service-mesh / edge router
 *     that can split traffic by percentage (traffic-split).
 *   - **ring-deployment** — needs a multi-region topology so rings can
 *     be concentric blast-radius bands.
 *   - **rolling** — needs more than one instance (multi-instance) so
 *     you can roll one at a time.
 *   - **recreate** — needs nothing special; this is the simplest, also
 *     the most operator-on-hook strategy.
 */
export const STRATEGY_INFRA_REQUIREMENTS: Readonly<Record<string, readonly string[]>> = {
  'blue-green': ['two-identical-environments'],
  'canary': ['traffic-split'],
  'ring-deployment': ['multi-region'],
  'rolling': ['multi-instance'],
  'recreate': []
};

// ─── Owned field set ────────────────────────────────────────────────────────

/**
 * Per-field operator fix-hints. The kit's `ArchitectSectionSpec` is
 * intentionally minimal (`path`, `description`, `required`); the
 * fix-hint dictionary lives next to the contract so the system-prompt
 * builder and the future EA Reviewer can surface it without changing
 * kit shape.
 */
export const DEVOPS_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'devops.cicdPipeline':
    'Default to GitHub Actions with stages: lint → typecheck → test → build → deploy. Each stage has quality gates: lint blocks on @typescript-eslint errors; typecheck blocks on tsc errors; test blocks on coverage < threshold (per Testing Architect); build emits deterministic artifacts (pinned lockfiles); deploy blocks on Performance + Security architect outputs (Lighthouse + axe + CSP). Customer-onboarding can override the provider — accept gitlab-ci, circleci, buildkite, azure-pipelines.',
  'devops.deployStrategy':
    'Default to canary for production with 10% traffic for 30 min, then 100% on healthcheck pass. Accept blue-green, ring-deployment, rolling, recreate. STRATEGY MUST MATCH INFRA: blue-green requires 2× infra; canary requires traffic-split; ring-deployment requires multi-region; rolling requires multi-instance. Mismatches go in risks[].',
  'devops.rollbackContract':
    'Default: auto-revert when /_health returns non-200 for 5 min after deploy. Methods: prefer Time Machine snapshot key for stateful rollbacks; fall back to `git revert` + redeploy for code-only. RTO ≤ 5 min; RPO depends on Database lifecycle. Output {trigger, autoRevertWindowMin, method, timeMachineSnapshotKey?, dataMigrationRollback}.',
  'devops.infrastructureAsCode':
    'Default to Terraform for Cloudflare/Vault/R2 modules. Accept Pulumi, Kubernetes manifests, CDK, CloudFormation. Output {tool, modules:[name, source, version, purpose], capabilities:[...]}. capabilities MUST include the infra primitives the chosen deploy strategy requires (two-identical-environments / traffic-split / multi-region / multi-instance).',
  'devops.environmentPromotion':
    'Default: dev → staging → prod. dev auto-promotes on merge to a feature branch; staging auto-promotes on merge to main; prod requires manual operator gate at staging→prod. Output {environments:[name, purpose, autoPromote, gateKind, gateOwner?], promotionFlow:[from, to, condition], blockers:[...]}.',
  'devops.deploymentObservability':
    'Per-deploy telemetry: emit a deploy.started + deploy.succeeded/failed event with attributes {tenantId, ticketId, gitSha, environment, strategy, durationMs, healthcheckLatencyMs, rollbackReason?}. Log to the central secure sink (Security Architect owns `auditLogRequirements.sink`). Required deploy event types: deploy.started, deploy.succeeded, deploy.failed, deploy.rollback.triggered, deploy.healthcheck.failed. Per-event retention 365 days.',
  'devops.secretsManagementInPipeline':
    'Forward-reference Security Architect\'s `secretsHandling`. The pipeline NEVER stores secrets in repo files, CI variables (except short-lived tokens), or build artifacts. Use Vault per-tenant namespace via short-lived AppRole tokens (≤1h). Secrets injected as env-at-runtime, never baked into the build artifact. Output {provider:"vault-via-security-architect", injectionPoint, tokenLifetimeMin, neverInArtifact:["password","token","secret","authorization","api-key"], rotationOnRoleChange}.'
};

/**
 * The owned section specs in stable order.
 */
export const DEVOPS_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'devops.cicdPipeline',
    description:
      'Per-ticket CI/CD pipeline spec: provider, stages (lint/typecheck/test/build/deploy), per-stage quality gates referencing Performance + Security + Testing architect outputs, triggers (push|pr|tag), per-stage retry policy. Customer onboarding picks the provider.',
    required: true
  },
  {
    path: 'devops.deployStrategy',
    description:
      'Per-ticket deploy strategy: blue-green | canary | ring-deployment | rolling | recreate. Includes traffic-shift schedule, healthcheck gate, dwell time, abort conditions. MUST match infrastructure capabilities — strategy/infra realism is a reviewer invariant.',
    required: true
  },
  {
    path: 'devops.rollbackContract',
    description:
      'Per-ticket rollback contract: auto-revert trigger (healthcheck failure window), preferred method (Time Machine snapshot key OR `git revert` + redeploy), RTO target, data migration rollback strategy (which migrations are reversible vs require forward-fix).',
    required: true
  },
  {
    path: 'devops.infrastructureAsCode',
    description:
      'Per-ticket IaC posture: tool (Terraform / Pulumi / Kubernetes / CDK / CloudFormation per onboarding), referenced modules, infrastructure capabilities the deployment depends on (two-identical-environments / traffic-split / multi-region / multi-instance).',
    required: true
  },
  {
    path: 'devops.environmentPromotion',
    description:
      'dev → staging → prod promotion flow: per-environment auto-promote/manual-gate posture, gate owner (operator name for manual gates), blocker rules (e.g. fail-on-test, fail-on-lighthouse, fail-on-security-deny).',
    required: true
  },
  {
    path: 'devops.deploymentObservability',
    description:
      'Per-deploy telemetry: event taxonomy (deploy.started/succeeded/failed/rollback.triggered/healthcheck.failed), attributes (tenantId, ticketId, gitSha, environment, strategy, durationMs, healthcheckLatencyMs, rollbackReason?), retention, alert thresholds. Sink references Security Architect\'s `auditLogRequirements.sink`.',
    required: true
  },
  {
    path: 'devops.secretsManagementInPipeline',
    description:
      'Forward-reference Security Architect\'s `secretsHandling`. CI/CD pipeline never persists secrets in repo files, build artifacts, or long-lived CI variables. Short-lived Vault AppRole tokens; env-at-runtime injection. neverInArtifact list mirrors Security\'s `secretsHandling.neverLog`.',
    required: true
  }
];

/**
 * Flat list of owned field paths.
 */
export const DEVOPS_OWNED_FIELD_KEYS: readonly string[] = DEVOPS_OWNED_SECTIONS.map(
  s => s.path
);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §2.17 — DevOps runs on every ticket type that has a deployable
 * artifact: Page, Story, Form, List, Foundation. Widget tickets
 * typically inherit from the parent Page's deploy posture; only run
 * when explicitly flagged with `deploy`, `infra`, or `persists`.
 */
export function devopsArchitectAppliesPredicate(ticket: Ticket): boolean {
  if (
    ticket.type === 'Page' ||
    ticket.type === 'Story' ||
    ticket.type === 'Form' ||
    ticket.type === 'List' ||
    ticket.type === 'Foundation'
  ) {
    return true;
  }
  if (ticket.type === 'Widget') {
    const tags = ticket.quality_tags ?? [];
    return (
      tags.includes('deploy') ||
      tags.includes('infra') ||
      tags.includes('devops') ||
      tags.includes('persists')
    );
  }
  return false;
}

// ─── Architect meta ─────────────────────────────────────────────────────────

/**
 * DevOps is a wave-3 architect — `dependsOn: ['backend', 'database', 'security']`.
 * The task brief promoted Security upstream of DevOps (the spec §2.17
 * coverage matrix had only Backend + Database); we follow the brief
 * because the deploy strategy must encode Security's secretsHandling +
 * auditLogRequirements + tenantIsolationGuarantees.
 *
 * Precedence rank **2** per spec §5.2 — only Security outranks DevOps.
 */
export const DEVOPS_ARCHITECT_META: ArchitectMeta = {
  dependsOn: ['backend', 'database', 'security'],
  precedenceLevel: 2,
  fanoutPolicy: 'always',
  appliesPredicate: devopsArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const DevopsArchitectContract: ArchitectSectionContract = {
  contractId: 'devops-architect.v1',
  architectName: 'devops',
  version: '0.1.0',
  sections: DEVOPS_OWNED_SECTIONS,
  architectMeta: DEVOPS_ARCHITECT_META
};
