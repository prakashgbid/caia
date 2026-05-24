/**
 * @caia/api-gateway-architect — public surface.
 *
 * Architect #11 of CAIA's 17-architect EA fan-out. Senior API platform
 * engineer focused on gateways, rate limiting, auth gates, versioning,
 * and edge-layer enforcement. Sits in front of Backend's endpoints.
 *
 * Depends on Backend Architect + Security Architect upstream
 * (wave-2). Precedence rank 8 per spec §5.2.
 */

import type { ArchitectRegistry } from './types.js';

import { ApiGatewayArchitect } from './architect.js';

export {
  ApiGatewayArchitect,
  API_GATEWAY_ARCHITECT_NAME,
  API_GATEWAY_ARCHITECT_TOOLS
} from './architect.js';
export type { ApiGatewayArchitectConfig } from './architect.js';

export {
  ApiGatewayArchitectContract,
  API_GATEWAY_OWNED_SECTIONS,
  API_GATEWAY_OWNED_FIELD_KEYS,
  API_GATEWAY_FIELD_FIX_HINTS,
  API_GATEWAY_ARCHITECT_META,
  REQUIRED_GATEWAY_CODES,
  ALLOWED_AUTH_TYPES,
  ALLOWED_VERSIONING_KINDS,
  REQUIRED_QUOTA_TIERS,
  apiGatewayArchitectAppliesPredicate
} from './contract.js';

export { buildApiGatewaySystemPrompt } from './system-prompt.js';

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

export { runApiGatewayArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

export { API_GATEWAY_INVARIANTS } from './invariants.js';
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

export function registerWith(registry: ArchitectRegistry): ApiGatewayArchitect {
  const architect = new ApiGatewayArchitect();
  registry.register(architect);
  return architect;
}
