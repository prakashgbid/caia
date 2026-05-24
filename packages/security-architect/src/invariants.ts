/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (where keys are FLAT
 *     dotted strings like `'security.owaspMitigations'`), or
 *   - the composed `tickets.architecture` JSONB blob (where the
 *     Dispatcher will nest the same fields under the `security.*` path).
 *
 * Both views are accepted — we look up via `readField()` which checks
 * the flat key first, then falls back to the nested path.
 *
 * True ⇒ pass; false ⇒ a Reviewer advisory or fail (driven by `severity`).
 */

import { OWASP_TOP_10_KEYS } from './contract.js';

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  contributor: string;
  reads: readonly string[];
  severity: InvariantSeverity;
  description: string;
  detect(architecture: Readonly<Record<string, unknown>>): boolean;
}

function readField(arch: Readonly<Record<string, unknown>>, path: string): unknown {
  if (path in arch) return arch[path];
  const parts = path.split('.');
  let cursor: unknown = arch;
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function asObject(v: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Readonly<Record<string, unknown>>;
}

function asArray(v: unknown): readonly unknown[] | null {
  return Array.isArray(v) ? v : null;
}

const ALLOWED_VERDICTS = new Set(['mitigated', 'accepted-risk', 'not-applicable']);

export const SECURITY_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'security.owasp-top10-fully-covered',
    contributor: 'security',
    reads: ['security.owaspMitigations'],
    severity: 'fail',
    description:
      'Every Security output must declare a verdict + mitigation for ALL OWASP Top-10 2021 categories (a01..a10). Missing categories are silent vulnerabilities.',
    detect(arch): boolean {
      const owasp = asObject(readField(arch, 'security.owaspMitigations'));
      if (!owasp) return false;
      for (const key of OWASP_TOP_10_KEYS) {
        const entry = asObject(owasp[key]);
        if (!entry) return false;
        if (typeof entry.verdict !== 'string') return false;
        if (!ALLOWED_VERDICTS.has(entry.verdict)) return false;
      }
      return true;
    }
  },
  {
    id: 'security.owasp-accepted-risk-has-operator-signoff',
    contributor: 'security',
    reads: ['security.owaspMitigations'],
    severity: 'fail',
    description:
      'Any OWASP entry with verdict `accepted-risk` MUST declare `acceptedBy` (operator name) + `acceptedOn` (date). Otherwise the accept-risk is unauditable.',
    detect(arch): boolean {
      const owasp = asObject(readField(arch, 'security.owaspMitigations'));
      if (!owasp) return true;
      for (const key of OWASP_TOP_10_KEYS) {
        const entry = asObject(owasp[key]);
        if (!entry) continue;
        if (entry.verdict === 'accepted-risk') {
          if (typeof entry.acceptedBy !== 'string' || (entry.acceptedBy as string).length === 0) return false;
          if (typeof entry.acceptedOn !== 'string' || (entry.acceptedOn as string).length === 0) return false;
        }
      }
      return true;
    }
  },
  {
    id: 'security.csp-strict-dynamic-no-unsafe-inline',
    contributor: 'security',
    reads: ['security.securityHeaders'],
    severity: 'fail',
    description:
      'CSP MUST use strict-dynamic and MUST NOT contain `unsafe-inline` or `unsafe-eval` in any directive. Locked stack requirement.',
    detect(arch): boolean {
      const headers = asObject(readField(arch, 'security.securityHeaders'));
      if (!headers) return false;
      const csp = asObject(headers.csp);
      if (!csp) return false;
      const directive = typeof csp.directive === 'string' ? csp.directive : '';
      if (!directive.includes('strict-dynamic')) return false;
      for (const [, value] of Object.entries(csp)) {
        const arr = asArray(value);
        if (!arr) continue;
        for (const v of arr) {
          if (typeof v !== 'string') continue;
          if (v.includes('unsafe-inline')) return false;
          if (v.includes('unsafe-eval')) return false;
        }
      }
      return true;
    }
  },
  {
    id: 'security.hsts-preloaded-includesubdomains',
    contributor: 'security',
    reads: ['security.securityHeaders'],
    severity: 'fail',
    description:
      'HSTS MUST be max-age ≥ 31536000 with includeSubDomains=true and preload=true.',
    detect(arch): boolean {
      const headers = asObject(readField(arch, 'security.securityHeaders'));
      if (!headers) return false;
      const hsts = asObject(headers.hsts);
      if (!hsts) return false;
      if (typeof hsts.maxAgeSec !== 'number' || (hsts.maxAgeSec as number) < 31536000) return false;
      if (hsts.includeSubDomains !== true) return false;
      if (hsts.preload !== true) return false;
      return true;
    }
  },
  {
    id: 'security.xframe-options-deny',
    contributor: 'security',
    reads: ['security.securityHeaders'],
    severity: 'fail',
    description:
      'X-Frame-Options MUST be DENY. Iframe embeds require explicit allowlist + operator approval.',
    detect(arch): boolean {
      const headers = asObject(readField(arch, 'security.securityHeaders'));
      if (!headers) return false;
      return headers.xFrameOptions === 'DENY';
    }
  },
  {
    id: 'security.deny-by-default-authorization',
    contributor: 'security',
    reads: ['security.authorizationRules'],
    severity: 'fail',
    description:
      'Authorization policy MUST set `denyByDefault: true`. Allow-by-default is a hard violation.',
    detect(arch): boolean {
      const authz = asObject(readField(arch, 'security.authorizationRules'));
      if (!authz) return false;
      return authz.denyByDefault === true;
    }
  },
  {
    id: 'security.tenant-isolation-defence-in-depth',
    contributor: 'security',
    reads: ['security.tenantIsolationGuarantees'],
    severity: 'fail',
    description:
      'Tenant isolation guarantees MUST include both `scoped-db-credentials` and `rls-defence-in-depth`. Schema-per-tenant alone is necessary but not sufficient.',
    detect(arch): boolean {
      const iso = asObject(readField(arch, 'security.tenantIsolationGuarantees'));
      if (!iso) return false;
      const enforcement = asArray(iso.enforcement);
      if (!enforcement) return false;
      const set = new Set(enforcement.filter((v): v is string => typeof v === 'string'));
      return set.has('scoped-db-credentials') && set.has('rls-defence-in-depth');
    }
  },
  {
    id: 'security.secrets-never-logged',
    contributor: 'security',
    reads: ['security.secretsHandling'],
    severity: 'fail',
    description:
      'secretsHandling.neverLog MUST include `password`, `token`, `secret`, and `authorization`.',
    detect(arch): boolean {
      const sec = asObject(readField(arch, 'security.secretsHandling'));
      if (!sec) return false;
      const neverLog = asArray(sec.neverLog);
      if (!neverLog) return false;
      const set = new Set(neverLog.filter((v): v is string => typeof v === 'string'));
      return ['password', 'token', 'secret', 'authorization'].every(k => set.has(k));
    }
  },
  {
    id: 'security.audit-required-event-types',
    contributor: 'security',
    reads: ['security.auditLogRequirements'],
    severity: 'fail',
    description:
      'Audit-log requirements MUST cover auth.login.failure, authz.deny, secrets.access, and tenant.isolation.breach.attempt.',
    detect(arch): boolean {
      const audit = asObject(readField(arch, 'security.auditLogRequirements'));
      if (!audit) return false;
      const perEvent = asObject(audit.perEventType);
      if (!perEvent) return false;
      const required = [
        'auth.login.failure',
        'authz.deny',
        'secrets.access',
        'tenant.isolation.breach.attempt'
      ];
      return required.every(k => k in perEvent);
    }
  },
  {
    id: 'security.rate-limit-marketing-tightest',
    contributor: 'security',
    reads: ['security.rateLimitingRules'],
    severity: 'advisory',
    description:
      'perAuthTier rate limits should escalate from public → authenticated → service.',
    detect(arch): boolean {
      const rl = asObject(readField(arch, 'security.rateLimitingRules'));
      if (!rl) return false;
      const tier = asObject(rl.perAuthTier);
      if (!tier) return true;
      const pub = asObject(tier.public);
      const auth = asObject(tier.authenticated);
      const svc = asObject(tier.service);
      const pubMax = pub && typeof pub.max === 'number' ? (pub.max as number) : null;
      const authMax = auth && typeof auth.max === 'number' ? (auth.max as number) : null;
      const svcMax = svc && typeof svc.max === 'number' ? (svc.max as number) : null;
      if (pubMax !== null && authMax !== null && pubMax > authMax) return false;
      if (authMax !== null && svcMax !== null && authMax > svcMax) return false;
      return true;
    }
  },
  {
    id: 'security.input-validation-global-defaults',
    contributor: 'security',
    reads: ['security.inputValidation'],
    severity: 'fail',
    description:
      'inputValidation.globalDefaults MUST set rejectUnknownKeys=true and define maxBodyBytes.',
    detect(arch): boolean {
      const iv = asObject(readField(arch, 'security.inputValidation'));
      if (!iv) return false;
      const defaults = asObject(iv.globalDefaults);
      if (!defaults) return false;
      if (defaults.rejectUnknownKeys !== true) return false;
      if (typeof defaults.maxBodyBytes !== 'number' || (defaults.maxBodyBytes as number) <= 0) return false;
      return true;
    }
  },
  {
    id: 'security.authentication-strategy-declared',
    contributor: 'security',
    reads: ['security.authenticationStrategy'],
    severity: 'fail',
    description:
      'authenticationStrategy MUST declare a default scheme and a session model.',
    detect(arch): boolean {
      const auth = asObject(readField(arch, 'security.authenticationStrategy'));
      if (!auth) return false;
      if (typeof auth.default !== 'string' || (auth.default as string).length === 0) return false;
      const session = asObject(auth.sessionModel);
      if (!session) return false;
      if (typeof session.kind !== 'string') return false;
      return true;
    }
  }
];
