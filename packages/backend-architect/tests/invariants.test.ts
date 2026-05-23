/**
 * Cross-architect invariants — verifies Backend's contributions to the
 * EA Reviewer's invariant registry (per spec §6.2).
 */

import { describe, it, expect } from 'vitest';

import { BACKEND_INVARIANTS } from '../src/invariants.js';
import { goldenExpectedOutput } from './helpers/fakes.js';

describe('BACKEND_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(BACKEND_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of BACKEND_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `backend`', () => {
    for (const inv of BACKEND_INVARIANTS) {
      expect(inv.contributor).toBe('backend');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of BACKEND_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant `reads` only `backend.*` paths (no cross-architect reads)', () => {
    for (const inv of BACKEND_INVARIANTS) {
      for (const r of inv.reads) {
        expect(r.startsWith('backend.')).toBe(true);
      }
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of BACKEND_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of BACKEND_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('BACKEND_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of BACKEND_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('apiEndpoints-nonempty fails on an empty list', () => {
    const inv = BACKEND_INVARIANTS.find(i => i.id === 'backend.apiEndpoints-nonempty');
    expect(inv).toBeDefined();
    const empty = { ...goldenArch, 'backend.apiEndpoints': [] };
    expect(inv!.detect(empty)).toBe(false);
  });

  it('framework-is-next fails on Express', () => {
    const inv = BACKEND_INVARIANTS.find(i => i.id === 'backend.framework-is-next');
    expect(inv).toBeDefined();
    const wrong = { ...goldenArch, 'backend.framework': { name: 'express' } };
    expect(inv!.detect(wrong)).toBe(false);
  });

  it('serviceBoundaries-declared fails on missing style', () => {
    const inv = BACKEND_INVARIANTS.find(i => i.id === 'backend.serviceBoundaries-declared');
    expect(inv).toBeDefined();
    const wrong = { ...goldenArch, 'backend.serviceBoundaries': { foo: 'bar' } };
    expect(inv!.detect(wrong)).toBe(false);
  });

  it('endpoint-enumeration-matches-api-endpoints fails when a route is missing from enumeration', () => {
    const inv = BACKEND_INVARIANTS.find(
      i => i.id === 'backend.endpoint-enumeration-matches-api-endpoints'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'backend.endpointEnumeration': [
        { route: 'POST /api/contacts', table: 'contacts', op: 'insert' }
        // Missing the GET/GET-list/DELETE entries.
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('every-endpoint-has-response-schema fails when a ref is dangling', () => {
    const inv = BACKEND_INVARIANTS.find(i => i.id === 'backend.every-endpoint-has-response-schema');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'backend.responseSchemas': {} // none of the refs resolve
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('request-schemas-resolve fails when a referenced schema is missing', () => {
    const inv = BACKEND_INVARIANTS.find(i => i.id === 'backend.request-schemas-resolve');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'backend.requestSchemas': {} // every referenced schema becomes dangling
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('error-envelope-declared fails when mapping is empty', () => {
    const inv = BACKEND_INVARIANTS.find(i => i.id === 'backend.error-envelope-declared');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'backend.errorEnvelope': {
        schema: 'z.object({})',
        mapping: {}
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('auth-requirements-declared fails on an unknown scheme', () => {
    const inv = BACKEND_INVARIANTS.find(i => i.id === 'backend.auth-requirements-declared');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'backend.authRequirements': { default: { scheme: 'magic' } }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('rate-limits-declared fails when default is missing fields', () => {
    const inv = BACKEND_INVARIANTS.find(i => i.id === 'backend.rate-limits-declared');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'backend.rateLimits': { default: { windowMs: 1000 } } // missing max + scope
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('data-access-tables-cover-endpoint-touchpoints fails when a table is missing', () => {
    const inv = BACKEND_INVARIANTS.find(
      i => i.id === 'backend.data-access-tables-cover-endpoint-touchpoints'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'backend.dataAccess': { orm: 'drizzle', tables: [], queries: {} }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('endpoints-have-auth-and-rate-limit fails when an endpoint omits auth', () => {
    const inv = BACKEND_INVARIANTS.find(i => i.id === 'backend.endpoints-have-auth-and-rate-limit');
    expect(inv).toBeDefined();
    const goldenEndpoints = goldenArch['backend.apiEndpoints'] as Array<Record<string, unknown>>;
    const corruptedEndpoints = goldenEndpoints.map((ep, idx) =>
      idx === 0 ? { ...ep, auth: undefined } : ep
    );
    const corrupted = { ...goldenArch, 'backend.apiEndpoints': corruptedEndpoints };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('predicates also work against a composed (nested) architecture blob', () => {
    // Simulate what the EA Dispatcher composes — fields nested under
    // backend.* rather than flat dotted keys.
    const nested = {
      backend: {
        apiEndpoints: goldenArch['backend.apiEndpoints'],
        framework: goldenArch['backend.framework']
      }
    };
    const nonempty = BACKEND_INVARIANTS.find(i => i.id === 'backend.apiEndpoints-nonempty');
    const isNext = BACKEND_INVARIANTS.find(i => i.id === 'backend.framework-is-next');
    expect(nonempty!.detect(nested)).toBe(true);
    expect(isNext!.detect(nested)).toBe(true);
  });
});
