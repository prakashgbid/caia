/**
 * `SecurityArchitectContract` — the canonical owned-fields declaration
 * for architect #10 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.10 (Security Architect owns `security.*`)
 *   - task brief (authenticationStrategy, authorizationRules,
 *     secretsHandling, owaspMitigations, securityHeaders, inputValidation,
 *     rateLimitingRules, auditLogRequirements, tenantIsolationGuarantees)
 *
 * The spec §2.10 enumerated `authnFlow`/`authzModel`/`cspPolicy`/etc.;
 * the task brief reframes those as outcome-oriented names
 * (`authenticationStrategy`, `authorizationRules`, `securityHeaders` —
 * CSP is one row inside `securityHeaders`). The task brief is the
 * source of truth; field names below mirror the brief verbatim. Each
 * owned field carries its V1 default in `SECURITY_FIELD_FIX_HINTS`.
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. Every key lives under the `security.*`
 * namespace and does not collide with any sibling architect.
 *
 * Upstream dependencies (`dependsOn`): Backend Architect
 * (`backend.apiEndpoints`, `backend.endpointEnumeration`,
 * `backend.authRequirements`, `backend.rateLimits`) and Database
 * Architect (`database.rlsPolicies`, `database.tenantIsolationStrategy`,
 * `database.jsonbShapes`, `database.dataLifecycle`). Security is a
 * **wave-2** architect.
 *
 * Precedence rank **1 (highest)** per spec §5.2 — Security's outputs
 * win every semantic conflict short of a Reviewer-acknowledged operator
 * override.
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
 * intentionally minimal (`path`, `description`, `required`); the
 * fix-hint dictionary lives next to the contract so the system-prompt
 * builder and the future EA Reviewer can surface it without changing
 * kit shape.
 */
export const SECURITY_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'security.authenticationStrategy':
    'Default to Cloudflare Access for tenant-scoped routes + OAuth 2.0 + JWT (RS256, 15min access TTL + 30day refresh sliding) for end-user sessions + service-token for orchestrator-internal + public for marketing. MFA required for operator + BYOK + admin. Reject API-key-as-bearer for end-user auth.',
  'security.authorizationRules':
    'RBAC for coarse role grants (owner|admin|member|viewer); ABAC for fine-grained per-resource checks (row.tenant_id == ctx.tenantId). Output {model:"rbac+abac",roles,permissions,resourceOwnership,denyByDefault:true}. Always deny-by-default; explicit grant required.',
  'security.secretsHandling':
    'Forward-reference @caia/secrets-adapter. Output {provider:"vault",namespace:"tenant/{{tenantId}}",rotationPolicy:{kind:"scheduled",intervalDays:90},perSecret,injection:"env-at-runtime",neverLog:["password","token","secret","authorization",...]}. Never persist secrets in tickets, designVersion, audit logs, error envelopes, or LLM context.',
  'security.owaspMitigations':
    'Required: a verdict + concrete mitigation for EACH of the OWASP Top-10 2021 categories (a01..a10). Each entry: {verdict:"mitigated"|"accepted-risk"|"not-applicable",mitigations:[...],evidenceRefs:[...]}. accepted-risk requires acceptedBy + acceptedOn.',
  'security.securityHeaders':
    'Locked defaults: CSP strict-dynamic + nonce; HSTS max-age 31536000 includeSubDomains preload; X-Frame-Options DENY; X-Content-Type-Options nosniff; Referrer-Policy strict-origin-when-cross-origin; Permissions-Policy minimal; COOP same-origin; COEP require-corp; CORP same-origin. Iframe embeds require explicit allowlist + operator approval.',
  'security.inputValidation':
    'Every endpoint with body/query/path-param MUST declare a Zod schema ref plus sanitization (trim, stripHtml, canonicalize, maxBodyBytes, allowedContentTypes). globalDefaults must set rejectUnknownKeys=true and maxBodyBytes. Cross-reference Backend\'s requestSchemas.',
  'security.rateLimitingRules':
    'Per-endpoint limits scoped by tenant|ip|user. perAuthTier escalates public ≤ authenticated ≤ service. onLimit defaults to 429-retry-after with optional penaltySec. Marketing endpoints strictly capped.',
  'security.auditLogRequirements':
    'Every auth event, authz decision (especially denies), secret access, role change, tenant-isolation breach attempt, admin action MUST log. Output {sink,retentionDays:365,perEventType:{...},redactionRules:[...]}. Required event types include auth.login.failure, authz.deny, secrets.access, tenant.isolation.breach.attempt.',
  'security.tenantIsolationGuarantees':
    'Per-tenant Postgres schema isolation + scoped credentials. Cross-reference Database `tenantIsolationStrategy` + `rlsPolicies`. enforcement MUST include `scoped-db-credentials` AND `rls-defence-in-depth`. crossTenantAccess: forbidden-without-operator-elevation.'
};

/**
 * The owned section specs in stable order.
 */
export const SECURITY_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'security.authenticationStrategy',
    description:
      'Per-endpoint authentication: Cloudflare Access default for tenant routes, OAuth + JWT for end-user sessions, service-token for orchestrator-internal, public for marketing. Includes session TTL, refresh strategy, MFA posture, OAuth provider list.',
    required: true
  },
  {
    path: 'security.authorizationRules',
    description:
      'RBAC + ABAC policy: coarse role grants (owner/admin/member/viewer) plus fine-grained per-resource attribute checks (row ownership, tenant scope). Deny-by-default; every grant is explicit. Cross-references Database\'s row-ownership columns.',
    required: true
  },
  {
    path: 'security.secretsHandling',
    description:
      'Forward-reference to `@caia/secrets-adapter` patterns: Vault namespace per tenant, AppRole short-lived tokens, per-secret rotation policy, never-log allowlist. The Security Architect declares posture; the secrets adapter implements it.',
    required: true
  },
  {
    path: 'security.owaspMitigations',
    description:
      'OWASP Top-10 2021 enumeration with verdict + concrete mitigations per item (A01–A10). Each verdict is `mitigated`|`accepted-risk`|`not-applicable`; accepted-risk requires operator name + date. Evidence refs link to other architects\' fields.',
    required: true
  },
  {
    path: 'security.securityHeaders',
    description:
      'HTTP response header policy: CSP (strict-dynamic + nonce), HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP/COEP/CORP. Locked defaults; any override is operator-approved.',
    required: true
  },
  {
    path: 'security.inputValidation',
    description:
      'Per-endpoint input validation contract: Zod schema reference + sanitization rules (trim, strip-HTML, canonicalize, max body bytes, allowed content types, reject-unknown-keys). Cross-references Backend\'s `requestSchemas`.',
    required: true
  },
  {
    path: 'security.rateLimitingRules',
    description:
      'Per-endpoint rate limits scoped by tenant|ip|user with on-limit behaviour (429 + retry-after, optional penalty window). Cross-references Backend\'s `rateLimits`; Security\'s output is the binding default the API-Gateway Architect wires into Cloudflare WAF.',
    required: true
  },
  {
    path: 'security.auditLogRequirements',
    description:
      'Per-event-type audit-log spec: authentication events, authorization decisions (especially denies), secret access, role changes, tenant-isolation breach attempts, admin actions. Includes sink, retention, redaction rules, alert thresholds.',
    required: true
  },
  {
    path: 'security.tenantIsolationGuarantees',
    description:
      'Per-tenant Postgres schema isolation guarantees: schema-search-path, scoped DB credentials, RLS as defence-in-depth, tenant-id on every row, breach detection. Cross-references Database\'s `tenantIsolationStrategy` and `rlsPolicies`.',
    required: true
  }
];

/**
 * Flat list of owned field paths.
 */
export const SECURITY_OWNED_FIELD_KEYS: readonly string[] = SECURITY_OWNED_SECTIONS.map(
  s => s.path
);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §2.10 — Security runs on every ticket that exposes an endpoint
 * or touches data: Page, Story, Form, List, Foundation. Widget tickets
 * typically inherit from the parent Page's security posture; only run
 * when explicitly flagged with `api`, `auth`, `security`, `persists`,
 * or `backend` quality tag.
 */
export function securityArchitectAppliesPredicate(ticket: Ticket): boolean {
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
      tags.includes('auth') ||
      tags.includes('security') ||
      tags.includes('persists') ||
      tags.includes('backend')
    );
  }
  return false;
}

// ─── Architect meta ─────────────────────────────────────────────────────────

/**
 * Security is a wave-2 architect — `dependsOn: ['backend', 'database']`.
 * Precedence rank **1 (highest)** per spec §5.2 — Security veto wins
 * every semantic conflict short of operator override.
 */
export const SECURITY_ARCHITECT_META: ArchitectMeta = {
  dependsOn: ['backend', 'database'],
  precedenceLevel: 1,
  fanoutPolicy: 'always',
  appliesPredicate: securityArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const SecurityArchitectContract: ArchitectSectionContract = {
  contractId: 'security-architect.v1',
  architectName: 'security',
  version: '0.1.0',
  sections: SECURITY_OWNED_SECTIONS,
  architectMeta: SECURITY_ARCHITECT_META
};

// ─── OWASP top-10 coverage helper ───────────────────────────────────────────

/**
 * The canonical OWASP Top-10 2021 keys the Security Architect's
 * `owaspMitigations` field MUST cover. Order matches the OWASP
 * publication order (A01..A10).
 */
export const OWASP_TOP_10_KEYS: readonly string[] = [
  'a01_brokenAccessControl',
  'a02_cryptographicFailures',
  'a03_injection',
  'a04_insecureDesign',
  'a05_securityMisconfiguration',
  'a06_vulnerableComponents',
  'a07_authFailures',
  'a08_softwareDataIntegrity',
  'a09_loggingMonitoringFailures',
  'a10_ssrf'
];

/**
 * Human-readable OWASP Top-10 2021 category names.
 */
export const OWASP_TOP_10_NAMES: Readonly<Record<string, string>> = {
  a01_brokenAccessControl: 'A01:2021 — Broken Access Control',
  a02_cryptographicFailures: 'A02:2021 — Cryptographic Failures',
  a03_injection: 'A03:2021 — Injection',
  a04_insecureDesign: 'A04:2021 — Insecure Design',
  a05_securityMisconfiguration: 'A05:2021 — Security Misconfiguration',
  a06_vulnerableComponents: 'A06:2021 — Vulnerable and Outdated Components',
  a07_authFailures: 'A07:2021 — Identification and Authentication Failures',
  a08_softwareDataIntegrity: 'A08:2021 — Software and Data Integrity Failures',
  a09_loggingMonitoringFailures: 'A09:2021 — Security Logging and Monitoring Failures',
  a10_ssrf: 'A10:2021 — Server-Side Request Forgery (SSRF)'
};
