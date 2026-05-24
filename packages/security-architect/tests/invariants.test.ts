/**
 * Cross-architect invariants.
 */
import { describe, it, expect } from 'vitest';
import { OWASP_TOP_10_KEYS } from '../src/contract.js';
import { SECURITY_INVARIANTS } from '../src/invariants.js';
import { goldenExpectedOutput } from './helpers/fakes.js';

describe('SECURITY_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => expect(SECURITY_INVARIANTS.length).toBeGreaterThan(0));
  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of SECURITY_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });
  it('every invariant is contributed by `security`', () => {
    for (const inv of SECURITY_INVARIANTS) expect(inv.contributor).toBe('security');
  });
  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of SECURITY_INVARIANTS) expect(inv.reads.length).toBeGreaterThan(0);
  });
  it('every invariant has a valid severity', () => {
    for (const inv of SECURITY_INVARIANTS) expect(['fail', 'advisory']).toContain(inv.severity);
  });
  it('every invariant has a non-empty description', () => {
    for (const inv of SECURITY_INVARIANTS) expect(inv.description.length).toBeGreaterThan(20);
  });
});

describe('SECURITY_INVARIANTS — predicates against the golden fixture', () => {
  const arch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of SECURITY_INVARIANTS) expect(inv.detect(arch), `invariant ${inv.id} should pass`).toBe(true);
  });

  it('owasp-top10-fully-covered fails when a category is missing', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.owasp-top10-fully-covered')!;
    const owasp = { ...(arch['security.owaspMitigations'] as Record<string, unknown>) };
    delete owasp.a05_securityMisconfiguration;
    expect(inv.detect({ ...arch, 'security.owaspMitigations': owasp })).toBe(false);
  });

  it('owasp-top10-fully-covered fails when verdict is unrecognised', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.owasp-top10-fully-covered')!;
    const owasp = { ...(arch['security.owaspMitigations'] as Record<string, unknown>), a03_injection: { verdict: 'maybe-ok', mitigations: [], evidenceRefs: [] } };
    expect(inv.detect({ ...arch, 'security.owaspMitigations': owasp })).toBe(false);
  });

  it('owasp-accepted-risk-has-operator-signoff fails when acceptedBy missing', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.owasp-accepted-risk-has-operator-signoff')!;
    const owasp = { ...(arch['security.owaspMitigations'] as Record<string, unknown>), a05_securityMisconfiguration: { verdict: 'accepted-risk', mitigations: [], evidenceRefs: [] } };
    expect(inv.detect({ ...arch, 'security.owaspMitigations': owasp })).toBe(false);
  });

  it('owasp-accepted-risk-has-operator-signoff passes when acceptedBy + acceptedOn present', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.owasp-accepted-risk-has-operator-signoff')!;
    const owasp = { ...(arch['security.owaspMitigations'] as Record<string, unknown>), a05_securityMisconfiguration: { verdict: 'accepted-risk', mitigations: [], evidenceRefs: [], acceptedBy: 'operator@caia.dev', acceptedOn: '2026-05-23' } };
    expect(inv.detect({ ...arch, 'security.owaspMitigations': owasp })).toBe(true);
  });

  it('csp-strict-dynamic-no-unsafe-inline fails on unsafe-inline script-src', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.csp-strict-dynamic-no-unsafe-inline')!;
    const h = arch['security.securityHeaders'] as Record<string, unknown>;
    const csp = { ...(h.csp as Record<string, unknown>), scriptSrc: ["'self'", "'unsafe-inline'"] };
    expect(inv.detect({ ...arch, 'security.securityHeaders': { ...h, csp } })).toBe(false);
  });

  it('csp-strict-dynamic-no-unsafe-inline fails on unsafe-eval', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.csp-strict-dynamic-no-unsafe-inline')!;
    const h = arch['security.securityHeaders'] as Record<string, unknown>;
    const csp = { ...(h.csp as Record<string, unknown>), scriptSrc: ["'self'", "'unsafe-eval'"] };
    expect(inv.detect({ ...arch, 'security.securityHeaders': { ...h, csp } })).toBe(false);
  });

  it('csp-strict-dynamic-no-unsafe-inline fails when directive is not strict-dynamic', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.csp-strict-dynamic-no-unsafe-inline')!;
    const h = arch['security.securityHeaders'] as Record<string, unknown>;
    const csp = { ...(h.csp as Record<string, unknown>), directive: 'self' };
    expect(inv.detect({ ...arch, 'security.securityHeaders': { ...h, csp } })).toBe(false);
  });

  it('hsts-preloaded-includesubdomains fails when maxAge below 1y', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.hsts-preloaded-includesubdomains')!;
    const h = arch['security.securityHeaders'] as Record<string, unknown>;
    const hsts = { ...(h.hsts as Record<string, unknown>), maxAgeSec: 1000 };
    expect(inv.detect({ ...arch, 'security.securityHeaders': { ...h, hsts } })).toBe(false);
  });

  it('hsts-preloaded-includesubdomains fails when preload is false', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.hsts-preloaded-includesubdomains')!;
    const h = arch['security.securityHeaders'] as Record<string, unknown>;
    const hsts = { ...(h.hsts as Record<string, unknown>), preload: false };
    expect(inv.detect({ ...arch, 'security.securityHeaders': { ...h, hsts } })).toBe(false);
  });

  it('xframe-options-deny fails on SAMEORIGIN', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.xframe-options-deny')!;
    const h = { ...(arch['security.securityHeaders'] as Record<string, unknown>), xFrameOptions: 'SAMEORIGIN' };
    expect(inv.detect({ ...arch, 'security.securityHeaders': h })).toBe(false);
  });

  it('deny-by-default-authorization fails when denyByDefault=false', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.deny-by-default-authorization')!;
    const a = { ...(arch['security.authorizationRules'] as Record<string, unknown>), denyByDefault: false };
    expect(inv.detect({ ...arch, 'security.authorizationRules': a })).toBe(false);
  });

  it('tenant-isolation-defence-in-depth fails when scoped-db-credentials missing', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.tenant-isolation-defence-in-depth')!;
    const iso = { ...(arch['security.tenantIsolationGuarantees'] as Record<string, unknown>), enforcement: ['schema-search-path', 'rls-defence-in-depth'] };
    expect(inv.detect({ ...arch, 'security.tenantIsolationGuarantees': iso })).toBe(false);
  });

  it('tenant-isolation-defence-in-depth fails when rls-defence-in-depth missing', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.tenant-isolation-defence-in-depth')!;
    const iso = { ...(arch['security.tenantIsolationGuarantees'] as Record<string, unknown>), enforcement: ['schema-search-path', 'scoped-db-credentials'] };
    expect(inv.detect({ ...arch, 'security.tenantIsolationGuarantees': iso })).toBe(false);
  });

  it('secrets-never-logged fails when `password` not in neverLog', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.secrets-never-logged')!;
    const s = { ...(arch['security.secretsHandling'] as Record<string, unknown>), neverLog: ['token', 'secret', 'authorization'] };
    expect(inv.detect({ ...arch, 'security.secretsHandling': s })).toBe(false);
  });

  it('audit-required-event-types fails when authz.deny missing', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.audit-required-event-types')!;
    const a = { ...(arch['security.auditLogRequirements'] as Record<string, unknown>), perEventType: { 'auth.login.failure': {}, 'secrets.access': {}, 'tenant.isolation.breach.attempt': {} } };
    expect(inv.detect({ ...arch, 'security.auditLogRequirements': a })).toBe(false);
  });

  it('rate-limit-marketing-tightest (advisory) fails when public > authenticated', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.rate-limit-marketing-tightest')!;
    const rl = { ...(arch['security.rateLimitingRules'] as Record<string, unknown>), perAuthTier: {
      public: { windowSec: 60, max: 1000, scope: 'ip' },
      authenticated: { windowSec: 60, max: 120, scope: 'user' },
      service: { windowSec: 60, max: 600, scope: 'tenant' }
    } };
    expect(inv.detect({ ...arch, 'security.rateLimitingRules': rl })).toBe(false);
  });

  it('input-validation-global-defaults fails when rejectUnknownKeys is false', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.input-validation-global-defaults')!;
    const iv = { ...(arch['security.inputValidation'] as Record<string, unknown>), globalDefaults: { maxBodyBytes: 1048576, allowedContentTypes: ['application/json'], rejectUnknownKeys: false } };
    expect(inv.detect({ ...arch, 'security.inputValidation': iv })).toBe(false);
  });

  it('authentication-strategy-declared fails when default scheme missing', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.authentication-strategy-declared')!;
    const a = { ...(arch['security.authenticationStrategy'] as Record<string, unknown>), default: '' };
    expect(inv.detect({ ...arch, 'security.authenticationStrategy': a })).toBe(false);
  });
});

describe('SECURITY_INVARIANTS — OWASP coverage check', () => {
  it('owasp-top10-fully-covered invariant exists with severity=fail', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.owasp-top10-fully-covered')!;
    expect(inv).toBeDefined();
    expect(inv.severity).toBe('fail');
  });
  it('predicate considers all 10 OWASP keys', () => {
    const inv = SECURITY_INVARIANTS.find(i => i.id === 'security.owasp-top10-fully-covered')!;
    const arch = goldenExpectedOutput().architectureFields;
    for (const k of OWASP_TOP_10_KEYS) {
      const owasp = { ...(arch['security.owaspMitigations'] as Record<string, unknown>) };
      delete owasp[k];
      expect(inv.detect({ ...arch, 'security.owaspMitigations': owasp }), `dropping ${k} should fail`).toBe(false);
    }
  });
});
