/**
 * @caia/security-architect — public surface.
 *
 * Architect #10 of CAIA's 17-architect EA fan-out. Senior security
 * engineer focused on OWASP top-10 mitigations, authentication
 * (Cloudflare Access / OAuth / JWT), authorization (RBAC + ABAC),
 * secrets handling (forward-reference to `@caia/secrets-adapter`),
 * and multi-tenant isolation (per-tenant Postgres schema isolation +
 * scoped credentials).
 *
 * Depends on Backend Architect + Database Architect upstream. Holds
 * precedence rank 1 — its outputs win every semantic conflict short of
 * a Reviewer-acknowledged operator override (spec §5.2).
 *
 * Mirrors the canonical `@caia/frontend-architect` template (architect
 * #1, PR #537) and `@caia/database-architect` template (architect #3).
 *
 * Registration: import this package's `registerWith()` helper to
 * install the architect on a registry. The package does NOT
 * self-register on import.
 */

import type { ArchitectRegistry } from './types.js';

import { SecurityArchitect } from './architect.js';

// Main exports — the Dispatcher imports these.
export {
  SecurityArchitect,
  SECURITY_ARCHITECT_NAME,
  SECURITY_ARCHITECT_TOOLS
} from './architect.js';
export type { SecurityArchitectConfig } from './architect.js';

export {
  SecurityArchitectContract,
  SECURITY_OWNED_SECTIONS,
  SECURITY_OWNED_FIELD_KEYS,
  SECURITY_FIELD_FIX_HINTS,
  SECURITY_ARCHITECT_META,
  OWASP_TOP_10_KEYS,
  OWASP_TOP_10_NAMES,
  securityArchitectAppliesPredicate
} from './contract.js';

export { buildSecuritySystemPrompt } from './system-prompt.js';

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

export { runSecurityArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

export { SECURITY_INVARIANTS } from './invariants.js';
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
 * Register a fresh SecurityArchitect on the given registry.
 */
export function registerWith(registry: ArchitectRegistry): SecurityArchitect {
  const architect = new SecurityArchitect();
  registry.register(architect);
  return architect;
}
