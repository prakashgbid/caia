/**
 * Cross-architect invariants — verifies API Gateway's contributions to
 * the EA Reviewer's invariant registry (per spec §6.2).
 */

import { describe, it, expect } from 'vitest';

import { API_GATEWAY_INVARIANTS } from '../src/invariants.js';
import { goldenExpectedOutput } from './helpers/fakes.js';

describe('API_GATEWAY_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(API_GATEWAY_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of API_GATEWAY_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `apiGateway`', () => {
    for (const inv of API_GATEWAY_INVARIANTS) {
      expect(inv.contributor).toBe('apiGateway');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of API_GATEWAY_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of API_GATEWAY_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of API_GATEWAY_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('API_GATEWAY_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of API_GATEWAY_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('error-envelope-covers-required-codes fails when a code is missing', () => {
    const inv = API_GATEWAY_INVARIANTS.find(i => i.id === 'apiGateway.error-envelope-covers-required-codes');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'apiGateway.errorEnvelope': {
        ...(goldenArch['apiGateway.errorEnvelope'] as Record<string, unknown>),
        mapping: { rateLimited: { httpStatus: 429, gatewayCode: 'GATEWAY_RATE_LIMITED', retryable: true } }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('cors-wildcard-credentials-forbidden fails when wildcard + credentials are set', () => {
    const inv = API_GATEWAY_INVARIANTS.find(i => i.id === 'apiGateway.cors-wildcard-credentials-forbidden');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'apiGateway.corsPolicy': {
        default: { allowedOrigins: ['*'], allowCredentials: true }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('versioning-kind-allowed fails on an unknown kind', () => {
    const inv = API_GATEWAY_INVARIANTS.find(i => i.id === 'apiGateway.versioning-kind-allowed');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'apiGateway.versioningStrategy': { kind: 'date-based', sunsetPolicy: { advanceNoticeDays: 180 } }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('versioning-sunset-window fails on < 180 days', () => {
    const inv = API_GATEWAY_INVARIANTS.find(i => i.id === 'apiGateway.versioning-sunset-window');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'apiGateway.versioningStrategy': {
        kind: 'url-prefix',
        sunsetPolicy: { advanceNoticeDays: 30 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('transforms-inject-request-id fails when no inject-header op for X-Request-Id exists', () => {
    const inv = API_GATEWAY_INVARIANTS.find(i => i.id === 'apiGateway.transforms-inject-request-id');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'apiGateway.requestResponseTransforms': {
        request: [{ op: 'canonicalize-query', target: '*' }],
        response: [
          { op: 'strip-header', header: 'Server' },
          { op: 'strip-header', header: 'X-Powered-By' }
        ]
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('transforms-strip-server-fingerprint fails when Server / X-Powered-By aren\'t stripped', () => {
    const inv = API_GATEWAY_INVARIANTS.find(i => i.id === 'apiGateway.transforms-strip-server-fingerprint');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'apiGateway.requestResponseTransforms': {
        request: [{ op: 'inject-header', header: 'X-Request-Id' }],
        response: [{ op: 'strip-header', header: 'Server' }]
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('quotas-cover-required-tiers fails when a tier is missing', () => {
    const inv = API_GATEWAY_INVARIANTS.find(i => i.id === 'apiGateway.quotas-cover-required-tiers');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'apiGateway.apiQuotas': {
        perTier: { free: { overage: 'reject' }, pro: { overage: 'throttle' } }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('free-tier-rejects-overage fails when free tier throttles instead of rejecting', () => {
    const inv = API_GATEWAY_INVARIANTS.find(i => i.id === 'apiGateway.free-tier-rejects-overage');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'apiGateway.apiQuotas': {
        perTier: {
          free: { overage: 'throttle' },
          pro: { overage: 'throttle' },
          enterprise: { overage: 'bill' }
        }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('auth-gates-types-allowed fails on an unknown auth type', () => {
    const inv = API_GATEWAY_INVARIANTS.find(i => i.id === 'apiGateway.auth-gates-types-allowed');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'apiGateway.authGates': {
        'POST /v1/contacts': { authType: 'basic-auth', gateAt: 'edge', required: true }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('webhook-signing-strong-algorithm fails on HMAC-SHA1', () => {
    const inv = API_GATEWAY_INVARIANTS.find(i => i.id === 'apiGateway.webhook-signing-strong-algorithm');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'apiGateway.webhookSecrets': {
        signing: { algorithm: 'HMAC-SHA1', timestampToleranceSec: 300 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('webhook-timestamp-tolerance-bounded fails on > 300 seconds', () => {
    const inv = API_GATEWAY_INVARIANTS.find(i => i.id === 'apiGateway.webhook-timestamp-tolerance-bounded');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'apiGateway.webhookSecrets': {
        signing: { algorithm: 'HMAC-SHA256', timestampToleranceSec: 3600 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('rate-limits-perRoute-present fails when perRoute is missing', () => {
    const inv = API_GATEWAY_INVARIANTS.find(i => i.id === 'apiGateway.rate-limits-perRoute-present');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'apiGateway.rateLimits': {
        defaults: { public: { max: 20 } }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });
});
