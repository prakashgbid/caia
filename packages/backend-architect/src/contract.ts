/**
 * `BackendArchitectContract` — the canonical owned-fields declaration for
 * architect #2 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.2 (Backend Architect owns `backend.*`)
 *   - task brief (apiEndpoints, requestSchemas, responseSchemas,
 *     errorEnvelope, validationRules, authRequirements, rateLimits,
 *     serviceBoundaries)
 *
 * The reconciled superset below merges spec §2.2's stack-lock fields
 * (framework, endpointEnumeration, dataAccess, businessRules) with the
 * task brief's per-endpoint structural fields (apiEndpoints with full
 * Zod request/response schemas, error envelope, validation rules, auth
 * requirements, rate limits, and service boundaries). Every field is
 * marked `required: true` because downstream architects (Database,
 * Security, API-Gateway, Observability, DevOps) read these — missing
 * fields cascade.
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. The chosen keys all live under the `backend.*`
 * namespace and do not collide with any sibling architect's namespace.
 *
 * The Database Architect (merged PR #549) already consumes
 * `backend.apiEndpoints`, `backend.endpointEnumeration`, `backend.dataAccess`,
 * and `backend.businessRules` from this architect's upstream output —
 * keep these names stable.
 */

import type {
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  Ticket
} from './types.js';

// ─── Owned field set ────────────────────────────────────────────────────────

/**
 * Per-field operator fix-hints. The kit's `ArchitectSectionSpec` is
 * intentionally minimal (`path`, `description`, `required`); the fix-hint
 * dictionary lives next to the contract so the system-prompt builder and
 * the future EA Reviewer can surface it without changing kit shape.
 */
export const BACKEND_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'backend.framework':
    'Default to {"name":"next","version":"15.x","runtime":"edge+node","handlerStyle":"app-router-route-handlers+server-actions"}. Reject any decision that picks Express, Fastify, NestJS, or a non-Next.js stack.',
  'backend.serviceBoundaries':
    'Default to {"style":"monolith-with-modules","modules":[...]} keyed by domain. Reject any decision that proposes microservices for a CAIA-scale ticket without explicit operator override.',
  'backend.apiEndpoints':
    'Per-ticket-type rules: Form Story → one POST endpoint; List Story → one paginated GET; CRUD Story → POST/GET-list/GET-by-id/PATCH/DELETE. Each entry: {method, path, op, requestSchemaRef?, responseSchemaRef?, persistsTo?, readsFrom?, deletesFrom?, auth, rateLimit}.',
  'backend.endpointEnumeration':
    'Flat enumeration of every {route, table, op} touchpoint derived from `apiEndpoints`. Database Architect reads this verbatim to enumerate persistence touchpoints. Keep `route` formatted as `METHOD /path`.',
  'backend.requestSchemas':
    'Zod-style descriptors keyed by ref (e.g. `ContactCreate`). For each endpoint with a body or query, emit one entry. Use Zod v3 syntax (z.object, z.string, z.email, z.uuid, refinements, etc.).',
  'backend.responseSchemas':
    'Zod-style descriptors keyed by ref (e.g. `Contact`, `ContactList`). Every endpoint MUST declare a responseSchemaRef even for 204-No-Content (use `z.void()`). List endpoints emit `{ items, nextCursor }`.',
  'backend.errorEnvelope':
    'Canonical error envelope shape: {schema, examples, mapping}. Default: `{ error: { code: string, message: string, details?: object, requestId: string } }`. The mapping table maps thrown error classes → HTTP status + envelope code.',
  'backend.validationRules':
    'Per-endpoint validation invariants beyond Zod (cross-field rules, tenant-scoped uniqueness checks, business-logic preconditions). Output: [{endpoint, rule, source: "zod"|"business"|"database", failureMode}].',
  'backend.authRequirements':
    'Per-endpoint auth policy. Default Cloudflare Access for tenant-scoped routes, service-token for orchestrator-internal routes, public for marketing. Output: {default, perEndpoint: {endpoint: {scheme, issuer?, scopes?, claims?}}}.',
  'backend.rateLimits':
    'Per-endpoint rate limits keyed by auth tier. Output: {default: {windowMs, max, scope: "ip"|"tenant"|"user"}, perEndpoint: {endpoint: {windowMs, max, scope, burst?}}}. Marketing endpoints get stricter limits.',
  'backend.dataAccess':
    'ORM choice + per-table query plan derived from `apiEndpoints`. Output: {orm: "drizzle"|"prisma", tables: [...], queries: {table: ["by-id","by-tenant-paginated",...]}}. Database Architect reads this.',
  'backend.businessRules':
    'Free-form list of cross-cutting business invariants surfaced to downstream architects (Database for CHECK constraints, Testing for assertion seeds). E.g. "Contact email unique within tenant", "Order total must equal sum of line items".'
};

/**
 * The owned section specs in stable order.
 */
export const BACKEND_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'backend.framework',
    description:
      'Locked: Next.js 15 App Router Route Handlers + Server Actions on a hybrid edge+node runtime. Output the framework + version + runtime + handler style so downstream architects (Database, DevOps, API-Gateway, Security) can validate compatibility.',
    required: true
  },
  {
    path: 'backend.serviceBoundaries',
    description:
      'Service decomposition style + module boundaries. Default monolith-with-modules keyed by domain. Drives the API-Gateway Architect\'s routing config and the DevOps Architect\'s deployment unit choice.',
    required: true
  },
  {
    path: 'backend.apiEndpoints',
    description:
      'Per-ticket endpoint specs: method, path, op, request/response schema refs, persistence touchpoints, auth, rate limit. The canonical declaration of every HTTP/RPC surface this ticket exposes.',
    required: true
  },
  {
    path: 'backend.endpointEnumeration',
    description:
      'Flat enumeration of every {route, table, op} touchpoint derived from `apiEndpoints`. Database Architect reads this verbatim to enumerate persistence touchpoints; route format `METHOD /path`.',
    required: true
  },
  {
    path: 'backend.requestSchemas',
    description:
      'Zod-style descriptors for every endpoint\'s request body / query params, keyed by ref (e.g. `ContactCreate`). Endpoints without a body omit their entry.',
    required: true
  },
  {
    path: 'backend.responseSchemas',
    description:
      'Zod-style descriptors for every endpoint\'s response body, keyed by ref. Every endpoint MUST declare a ref even for 204-No-Content (`z.void()`).',
    required: true
  },
  {
    path: 'backend.errorEnvelope',
    description:
      'Canonical error envelope shape + examples + class-to-status mapping. The single source of truth every endpoint conforms to. The Observability Architect reads `errorEnvelope.mapping` to wire metric tags.',
    required: true
  },
  {
    path: 'backend.validationRules',
    description:
      'Per-endpoint validation invariants beyond Zod schema (cross-field rules, tenant-scoped uniqueness, business preconditions). Feeds Testing Architect\'s assertion seeds and Database Architect\'s CHECK constraints.',
    required: true
  },
  {
    path: 'backend.authRequirements',
    description:
      'Per-endpoint auth policy: scheme, issuer, scopes, claims. Default Cloudflare Access for tenant-scoped routes, service-token for orchestrator-internal, public for marketing. Security Architect cross-validates.',
    required: true
  },
  {
    path: 'backend.rateLimits',
    description:
      'Per-endpoint rate limits keyed by auth tier. The API-Gateway Architect reads this to wire WAF rules; the Observability Architect reads it to emit utilisation metrics.',
    required: true
  },
  {
    path: 'backend.dataAccess',
    description:
      'ORM choice + per-table query plan derived from `apiEndpoints`. The Database Architect reads this to choose indexes and migration ordering.',
    required: true
  },
  {
    path: 'backend.businessRules',
    description:
      'Free-form list of cross-cutting business invariants surfaced to downstream architects. Database lifts these into CHECK constraints; Testing lifts them into property-based test seeds.',
    required: true
  }
];

/**
 * Flat list of owned field paths. Used by `run()` to validate the
 * subagent's output and by the conformance test suite.
 */
export const BACKEND_OWNED_FIELD_KEYS: readonly string[] = BACKEND_OWNED_SECTIONS.map(
  s => s.path
);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §2.2 — Backend runs on every ticket type that exposes an API
 * surface or persistence touchpoint: Page (data-loading server
 * components), Story / Form / List (CRUD endpoints), Foundation
 * (cross-cutting service modules). Widget tickets typically do NOT have
 * their own endpoints (they re-use parent-Page handlers), so they're
 * excluded unless flagged with the `api` quality tag.
 */
export function backendArchitectAppliesPredicate(ticket: Ticket): boolean {
  if (
    ticket.type === 'Page' ||
    ticket.type === 'Story' ||
    ticket.type === 'Form' ||
    ticket.type === 'List' ||
    ticket.type === 'Foundation'
  ) {
    return true;
  }
  // Widget tickets only get their own endpoints when explicitly tagged.
  if (ticket.type === 'Widget') {
    const tags = ticket.quality_tags ?? [];
    return tags.includes('api') || tags.includes('backend') || tags.includes('persists');
  }
  return false;
}

// ─── Architect meta ─────────────────────────────────────────────────────────

/**
 * Backend is a wave-1 architect (`dependsOn: []`). Precedence rank 12
 * per spec §5.2 — below Database (11, schema correctness trumps
 * functional correctness in conflict resolution) and below the
 * security/devops/a11y/seo/perf/abTesting/featureFlagging/apiGateway/
 * observability/analytics critics.
 */
export const BACKEND_ARCHITECT_META: ArchitectMeta = {
  dependsOn: [],
  precedenceLevel: 12,
  fanoutPolicy: 'always',
  appliesPredicate: backendArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const BackendArchitectContract: ArchitectSectionContract = {
  contractId: 'backend-architect.v1',
  architectName: 'backend',
  version: '0.1.0',
  sections: BACKEND_OWNED_SECTIONS,
  architectMeta: BACKEND_ARCHITECT_META
};
