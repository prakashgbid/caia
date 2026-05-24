/**
 * `ApiGatewayArchitectContract` — the canonical owned-fields declaration
 * for architect #11 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.11 (API Gateway Architect owns `apiGateway.*`)
 *   - task brief (rateLimits, authGates, versioningStrategy,
 *     errorEnvelope, requestResponseTransforms, corsPolicy,
 *     webhookSecrets, apiQuotas)
 *
 * Upstream dependencies (`dependsOn`): Backend Architect
 * (`backend.apiEndpoints`, `backend.authRequirements`,
 * `backend.rateLimits`, `backend.errorEnvelope`) and Security Architect
 * (`security.authenticationStrategy`, `security.authorizationRules`,
 * `security.rateLimitingRules`). API Gateway is a **wave-2** architect.
 *
 * Precedence rank **8** per spec §5.2 — boundary integrity sits above
 * observability/analytics/database/backend/frontend but below the
 * safety/perf critics.
 */

import type {
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  Ticket
} from './types.js';

// ─── Owned field set ────────────────────────────────────────────────────────

export const API_GATEWAY_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'apiGateway.rateLimits':
    'Extend Backend\'s + Security\'s rate limits at the edge. Output {perRoute:{<METHOD /path>:{windowMs,max,burst?,scope,onLimit}}, perTenant:{<tier>:{windowMs,max,onLimit}}, defaults:{...}}. Scope is one of tenant|ip|user|apiKey. onLimit defaults to {status:429,retryAfterSec:60}. Marketing-public routes always IP-scoped + capped.',
  'apiGateway.authGates':
    'For each route in Backend\'s `apiEndpoints`, declare {authType:public|cloudflare-access|jwt-bearer|service-token|mtls|api-key, gateAt:edge|origin, required:true|false}. MUST cross-validate against Security\'s `authenticationStrategy.perEndpoint`. Marketing-public defaults to {authType:public, gateAt:edge, required:false}.',
  'apiGateway.versioningStrategy':
    'Default to {kind:url-prefix, prefix:/v1, sunsetPolicy:{advanceNoticeDays:180, headerName:Sunset, deprecationHeaderName:Deprecation}}. Header-versioning only permitted when the operator explicitly tags the ticket with `header-versioning`.',
  'apiGateway.errorEnvelope':
    'EXTEND (do not replace) Backend\'s `errorEnvelope`. Output {schema:{...extending Backend\'s shape...}, addedFields:{requestId, gatewayCode, retryable, upstream?}, mapping:{<gatewayCondition>:{httpStatus, gatewayCode, retryable}}}. Required gatewayCodes include GATEWAY_RATE_LIMITED, GATEWAY_AUTH_FAILED, GATEWAY_UPSTREAM_TIMEOUT, GATEWAY_UPSTREAM_UNAVAILABLE, GATEWAY_BAD_REQUEST.',
  'apiGateway.requestResponseTransforms':
    'Edge transforms applied before/after Backend handlers. ALWAYS inject `X-Request-Id` if absent; ALWAYS strip `Server` + `X-Powered-By` from responses.',
  'apiGateway.corsPolicy':
    'Default to {default:{allowedOrigins:[same-origin], allowedMethods:[GET,POST,PATCH,DELETE], allowedHeaders:[Content-Type,Authorization,X-Request-Id], exposedHeaders:[X-Request-Id, Sunset, Deprecation, Retry-After], allowCredentials:false, maxAgeSec:600}, perTenant:{<tenantId>:{allowedOrigins:[...]}}}. Reject `*` for allowedOrigins when allowCredentials is true.',
  'apiGateway.webhookSecrets':
    'Forward-reference to `@caia/secrets-adapter` for storage. HMAC-SHA256 over (timestamp.body), header `X-CAIA-Signature`, timestamp header `X-CAIA-Timestamp`, 300s tolerance, nonce-store replay protection, 90-day rotation.',
  'apiGateway.apiQuotas':
    'Per-tier monthly/daily quota enforcement keyed by subscription tier. Free tier always rejects on overage; pro/enterprise throttle then bill.'
};

export const API_GATEWAY_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'apiGateway.rateLimits',
    description:
      'Per-route + per-tenant rate limits enforced at the gateway edge. Extends (does not replace) Backend\'s `rateLimits` and Security\'s `rateLimitingRules` with gateway-layer specifics: window, max, burst, scope (tenant|ip|user|apiKey), on-limit response.',
    required: true
  },
  {
    path: 'apiGateway.authGates',
    description:
      'Per-route gateway-layer auth gate: which routes require auth, which auth type (public, Cloudflare Access, JWT bearer, service-token, mTLS, API-key), and whether the gate fires at the edge or at the origin. Cross-validates against Security\'s `authenticationStrategy.perEndpoint`.',
    required: true
  },
  {
    path: 'apiGateway.versioningStrategy',
    description:
      'API versioning posture: URL-prefix (`/v1/`, `/v2/`) by default, or header-versioning when the ticket is explicitly tagged. Includes sunset policy (advance-notice days, `Sunset` + `Deprecation` headers) for deprecated versions.',
    required: true
  },
  {
    path: 'apiGateway.errorEnvelope',
    description:
      'Gateway error envelope that EXTENDS Backend\'s `errorEnvelope` with gateway-specific fields: `requestId`, `gatewayCode`, `retryable`, optional `upstream` reference. Mapping table covers rate-limited, auth-failed, upstream-timeout, upstream-unavailable, bad-request.',
    required: true
  },
  {
    path: 'apiGateway.requestResponseTransforms',
    description:
      'Edge transforms applied before/after Backend handlers: request rewrites (path, headers, query canonicalization), response rewrites (header injection/stripping, body rewrite), and edge cache rules (path → scope/TTL/vary). Always inject X-Request-Id; always strip server-fingerprint headers.',
    required: true
  },
  {
    path: 'apiGateway.corsPolicy',
    description:
      'CORS policy: origin allowlist (per default + per-tenant override), allowed methods + headers, exposed headers, allow-credentials, max-age. Wildcard `*` for `allowedOrigins` is forbidden when `allowCredentials` is true.',
    required: true
  },
  {
    path: 'apiGateway.webhookSecrets',
    description:
      'Webhook signing posture: HMAC algorithm + header names + timestamp tolerance + replay protection + rotation policy. Forward-references `@caia/secrets-adapter` for storage.',
    required: true
  },
  {
    path: 'apiGateway.apiQuotas',
    description:
      'Per-tier subscription quota enforcement (monthly/daily request budgets per tier). Includes per-endpoint cost multipliers and quota-surfacing response headers (`X-Quota-Remaining`, `X-Quota-Reset`). Free tier rejects on overage; pro/enterprise throttle then bill.',
    required: true
  }
];

export const API_GATEWAY_OWNED_FIELD_KEYS: readonly string[] = API_GATEWAY_OWNED_SECTIONS.map(
  s => s.path
);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §2.11 — API Gateway runs on every ticket that exposes an API
 * endpoint.
 */
export function apiGatewayArchitectAppliesPredicate(ticket: Ticket): boolean {
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
      tags.includes('api') ||
      tags.includes('backend') ||
      tags.includes('persists') ||
      tags.includes('webhook')
    );
  }
  return false;
}

// ─── Architect meta ─────────────────────────────────────────────────────────

export const API_GATEWAY_ARCHITECT_META: ArchitectMeta = {
  dependsOn: ['backend', 'security'],
  precedenceLevel: 8,
  fanoutPolicy: 'always',
  appliesPredicate: apiGatewayArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const ApiGatewayArchitectContract: ArchitectSectionContract = {
  contractId: 'api-gateway-architect.v1',
  architectName: 'apiGateway',
  version: '0.1.0',
  sections: API_GATEWAY_OWNED_SECTIONS,
  architectMeta: API_GATEWAY_ARCHITECT_META
};

// ─── Reusable constants ─────────────────────────────────────────────────────

export const REQUIRED_GATEWAY_CODES: readonly string[] = [
  'GATEWAY_RATE_LIMITED',
  'GATEWAY_AUTH_FAILED',
  'GATEWAY_UPSTREAM_TIMEOUT',
  'GATEWAY_UPSTREAM_UNAVAILABLE',
  'GATEWAY_BAD_REQUEST'
];

export const ALLOWED_AUTH_TYPES: readonly string[] = [
  'public',
  'cloudflare-access',
  'jwt-bearer',
  'service-token',
  'mtls',
  'api-key'
];

export const ALLOWED_VERSIONING_KINDS: readonly string[] = [
  'url-prefix',
  'accept-header'
];

export const REQUIRED_QUOTA_TIERS: readonly string[] = ['free', 'pro', 'enterprise'];
