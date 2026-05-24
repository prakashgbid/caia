/**
 * @caia/devops-architect — public surface.
 *
 * Architect #17 of 17 in CAIA's EA fan-out — **the LAST architect**.
 * When this lands every contract is in place and the EA Dispatcher
 * can fan-out across all 17 in parallel for any ticket.
 *
 * Senior DevOps engineer focused on CI/CD pipelines + deployment
 * strategies (blue-green / canary / ring / rolling / recreate) +
 * rollback safety + Terraform-based IaC + dev→staging→prod promotion
 * with manual prod gate. Produces per-ticket DEPLOY STRATEGY specs.
 *
 * DISTINCT from neighbouring packages:
 *   - The `caia/packages/deploy-steward` bin/launchd EXECUTES deploys
 *     (it's a launchd-triggered shell tool, not a TS package per V2
 *     audit).
 *   - The QA Engineer agent validates production AFTER deploy.
 *   - This architect SPECIFIES the deploy contract; the other two
 *     IMPLEMENT and ENFORCE it.
 *
 * Depends on Backend Architect + Database Architect + Security
 * Architect upstream. Holds precedence rank 2 — only Security
 * outranks DevOps (spec §5.2).
 *
 * Mirrors the canonical `@caia/frontend-architect` template (architect
 * #1, PR #537) and `@caia/security-architect` template (architect #10).
 *
 * Registration: import this package's `registerWith()` helper to
 * install the architect on a registry. The package does NOT
 * self-register on import.
 */

import type { ArchitectRegistry } from './types.js';

import { DevopsArchitect } from './architect.js';

// Main exports — the Dispatcher imports these.
export {
  DevopsArchitect,
  DEVOPS_ARCHITECT_NAME,
  DEVOPS_ARCHITECT_TOOLS
} from './architect.js';
export type { DevopsArchitectConfig } from './architect.js';

export {
  DevopsArchitectContract,
  DEVOPS_OWNED_SECTIONS,
  DEVOPS_OWNED_FIELD_KEYS,
  DEVOPS_FIELD_FIX_HINTS,
  DEVOPS_ARCHITECT_META,
  CICD_PROVIDERS,
  CLOUD_PROVIDERS,
  IAC_TOOLS,
  REPO_PROVIDERS,
  DEPLOY_STRATEGIES,
  STRATEGY_INFRA_REQUIREMENTS,
  devopsArchitectAppliesPredicate
} from './contract.js';

export { buildDevopsSystemPrompt } from './system-prompt.js';

export {
  createDefaultSpawner,
  buildSpawnPrompt,
  modelTagFor
} from './spawner.js';
export type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from './spawner.js';

export { runDevopsArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

export { DEVOPS_INVARIANTS } from './invariants.js';
export type { ArchitectInvariant, InvariantSeverity } from './invariants.js';

export type {
  SpecialistArchitect,
  ArchitectInput,
  ArchitectOutput,
  ArchitectUpstreamContext,
  ArchitectBudget,
  ArchitectSpend,
  ArchitectToolCall,
  ReviewerFeedback,
  Ticket,
  BusinessPlan,
  RenderableDesign,
  TenantContext,
  ToolDefinition,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  ArchitectMeta,
  FanoutPolicy
} from './types.js';

/**
 * Register a fresh DevopsArchitect on the given registry.
 */
export function registerWith(registry: ArchitectRegistry): DevopsArchitect {
  const architect = new DevopsArchitect();
  registry.register(architect);
  return architect;
}
