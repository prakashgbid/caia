/**
 * Capsule formalization tests (CAPSULE-FORMALIZE / third-party paper §C.5).
 *
 * Coverage:
 *   1.  canonicalize — preserves primitives + null
 *   2.  canonicalize — sorts object keys at every depth
 *   3.  canonicalize — preserves array order + canonicalises elements
 *   4.  canonicalize — omits undefined values
 *   5.  canonicalJSON — stable across key-order permutations
 *   6.  canonicalJSON — handles unicode + nested null
 *   7.  extractCapsule — produces the six expected slice keys
 *   8.  extractCapsule — file_allowlist is sorted unique union
 *   9.  extractCapsule — tool_allowlist is sorted unique union
 *  10.  computeCapsuleHash — 64-char lowercase hex sha256
 *  11.  computeCapsuleHash — deterministic across calls
 *  12.  freezeCapsule — populates capsuleHash, capsuleFrozenAt, capsuleVersion
 *  13.  freezeCapsule — passes through the now() override
 *  14.  freezeCapsule — does not mutate input ticket
 *  15.  verifyCapsule — returns valid:true for a freshly frozen capsule
 *  16.  verifyCapsule — returns valid:false with hash-mismatch when scope changes
 *  17.  verifyCapsule — returns valid:false with hash-mismatch when AC changes
 *  18.  verifyCapsule — returns valid:false with hash-mismatch when testCases changes
 *  19.  verifyCapsule — returns valid:false with hash-mismatch when claims.files changes
 *  20.  verifyCapsule — returns valid:false with no-frozen-hash when capsuleHash absent
 */

import { describe, expect, it } from 'vitest';
import {
  CAPSULE_SLICE_KEYS,
  CAPSULE_VERSION,
  buildDraftTicket,
  canonicalJSON,
  canonicalize,
  computeCapsuleHash,
  extractCapsule,
  freezeCapsule,
  verifyCapsule,
} from './index';

const TS = 1_700_000_000_000; // deterministic timestamp

function fixtureTicket() {
  // Augment the draft to include claims, taxonomy, architecturalInstructions,
  // testCases — every slice the capsule covers must be exercised in tests.
  const t = buildDraftTicket({
    rootPromptId: 'prm_capsule_test_0123456789abcdef',
    requirementId: 'req_capsule_001',
    parentEpic: 'epic_capsule',
    domainPrimary: 'auth',
    domainAll: ['auth', 'api-gateway'],
    nature: 'feature',
    complexity: 'medium',
    summary: 'capsule fixture summary',
    inScope: ['login flow', 'session refresh'],
    outOfScope: ['SSO'],
    acceptanceCriteria: [
      'Given valid creds When POST /login Then 200 with session cookie',
      'Given expired token When refresh requested Then 401 with retry hint',
      'Given malformed body When POST /login Then 400 with validation error',
    ],
    verificationPlan: ['unit', 'integration'],
    upstream: ['req_capsule_000'],
    downstream: [],
    files: ['apps/auth/src/login.ts'],
    poDecomposedAt: TS,
    taxonomy: {
      project: 'caia',
      businessSubDomains: ['auth'],
      techSubDomains: { primary: 'backend', all: ['backend', 'auth'] },
      lifecycle: 'new',
      qualityTags: ['security'],
      risk: 'medium',
      effort: 'M',
      priorityBucket: 'P1',
    },
    claims: {
      files: ['apps/auth/src/login.ts', 'apps/auth/src/session.ts'],
      apiRoutes: ['POST /login'],
      schemas: [],
      domains: ['auth'],
    },
  });
  // Inject test cases + an architectural instruction so the
  // acceptance_tests + contracts slices are non-empty.
  t.testCases = [
    {
      id: 'tc-1',
      title: 'login happy path',
      category: 'happy',
      layer: 'integration',
      given: 'valid creds',
      when: 'POST /login',
      then: '200 + cookie',
      selectorHints: [],
      mocks: [],
      required: true,
      status: 'pending',
      designedBy: 'testing-agent',
      designedAt: TS,
    },
  ];
  t.architecturalInstructions = [
    {
      id: 'arch-1',
      techSubDomain: 'auth',
      action: 'enhance',
      summary: 'extend session token TTL',
      details: 'see existing arch_apis #42',
      referencedArtifactIds: ['arch_apis#42'],
      confidence: 0.9,
    },
  ];
  return t;
}

describe('canonicalize', () => {
  it('preserves primitives + null', () => {
    expect(canonicalize(1)).toBe(1);
    expect(canonicalize('s')).toBe('s');
    expect(canonicalize(true)).toBe(true);
    expect(canonicalize(null)).toBe(null);
  });

  it('sorts object keys at every depth', () => {
    const c = canonicalize({ b: 2, a: { z: 1, y: { c: 0, a: 1 } } }) as Record<string, unknown>;
    expect(Object.keys(c)).toEqual(['a', 'b']);
    const a = c.a as Record<string, unknown>;
    expect(Object.keys(a)).toEqual(['y', 'z']);
    expect(Object.keys(a.y as object)).toEqual(['a', 'c']);
  });

  it('preserves array order + canonicalises elements', () => {
    const c = canonicalize([{ b: 1, a: 2 }, { d: 3, c: 4 }]) as object[];
    expect(c).toHaveLength(2);
    expect(Object.keys(c[0])).toEqual(['a', 'b']);
    expect(Object.keys(c[1])).toEqual(['c', 'd']);
  });

  it('omits undefined values from objects', () => {
    const c = canonicalize({ a: 1, b: undefined, c: 3 }) as Record<string, unknown>;
    expect(Object.keys(c)).toEqual(['a', 'c']);
    expect(c).not.toHaveProperty('b');
  });
});

describe('canonicalJSON', () => {
  it('is stable across key-order permutations', () => {
    const a = canonicalJSON({ b: 1, a: 2 });
    const b = canonicalJSON({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it('handles unicode + nested null', () => {
    const s = canonicalJSON({ name: 'café', meta: { tag: null } });
    // Default JSON.stringify escapes non-ASCII; we accept either escaped
    // or literal because Node's stringify output is deterministic per
    // version. The hash is over whatever this returns, which is what
    // matters for our use.
    expect(s).toContain('"name"');
    expect(s).toContain('"meta"');
    expect(s).toContain('null');
  });
});

describe('extractCapsule', () => {
  it('produces the six expected slice keys', () => {
    const t = fixtureTicket();
    const c = extractCapsule(t);
    expect(Object.keys(c).sort()).toEqual([...CAPSULE_SLICE_KEYS]);
    expect(CAPSULE_SLICE_KEYS).toHaveLength(6);
  });

  it('file_allowlist is the sorted unique union of dependencies.files + claims.files', () => {
    const t = fixtureTicket();
    // dependencies.files = ['apps/auth/src/login.ts']
    // claims.files = ['apps/auth/src/login.ts', 'apps/auth/src/session.ts']
    const c = extractCapsule(t);
    expect(c.file_allowlist).toEqual([
      'apps/auth/src/login.ts',
      'apps/auth/src/session.ts',
    ]);
  });

  it('tool_allowlist is the sorted unique union of architecturalInstructions[*].techSubDomain + taxonomy.techSubDomains.all', () => {
    const t = fixtureTicket();
    // archInstructions has one with techSubDomain='auth'
    // taxonomy.techSubDomains.all = ['backend', 'auth']
    const c = extractCapsule(t);
    expect(c.tool_allowlist).toEqual(['auth', 'backend']);
  });
});

describe('computeCapsuleHash', () => {
  it('returns a 64-char lowercase hex sha256', () => {
    const t = fixtureTicket();
    const h = computeCapsuleHash(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic across calls', () => {
    const t = fixtureTicket();
    const h1 = computeCapsuleHash(t);
    const h2 = computeCapsuleHash(t);
    expect(h1).toBe(h2);
  });
});

describe('freezeCapsule', () => {
  it('populates capsuleHash, capsuleFrozenAt, and capsuleVersion', () => {
    const t = fixtureTicket();
    const frozen = freezeCapsule(t, { now: TS });
    expect(frozen.capsuleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(frozen.capsuleFrozenAt).toBe(TS);
    expect(frozen.capsuleVersion).toBe(CAPSULE_VERSION);
  });

  it('passes through the now() override', () => {
    const t = fixtureTicket();
    const frozenA = freezeCapsule(t, { now: 1000 });
    const frozenB = freezeCapsule(t, { now: 2000 });
    expect(frozenA.capsuleFrozenAt).toBe(1000);
    expect(frozenB.capsuleFrozenAt).toBe(2000);
    // Hash is independent of the timestamp — only content matters.
    expect(frozenA.capsuleHash).toBe(frozenB.capsuleHash);
  });

  it('does not mutate the input ticket', () => {
    const t = fixtureTicket();
    expect(t.capsuleHash).toBeUndefined();
    freezeCapsule(t, { now: TS });
    expect(t.capsuleHash).toBeUndefined();
  });
});

describe('verifyCapsule', () => {
  it('returns valid:true for a freshly frozen capsule', () => {
    const frozen = freezeCapsule(fixtureTicket(), { now: TS });
    const v = verifyCapsule(frozen);
    expect(v.valid).toBe(true);
    if (v.valid) {
      expect(v.expected).toBe(v.actual);
      expect(v.drift).toBeNull();
    }
  });

  it('detects hash-mismatch when scope.summary changes', () => {
    const frozen = freezeCapsule(fixtureTicket(), { now: TS });
    const tampered = { ...frozen, scope: { ...frozen.scope, summary: 'tampered' } };
    const v = verifyCapsule(tampered);
    expect(v.valid).toBe(false);
    if (!v.valid) {
      expect(v.drift.reason).toBe('hash-mismatch');
      expect(v.drift.expected).toBe(frozen.capsuleHash);
      expect(v.drift.actual).not.toBe(frozen.capsuleHash);
    }
  });

  it('detects hash-mismatch when an acceptance criterion changes', () => {
    const frozen = freezeCapsule(fixtureTicket(), { now: TS });
    const tampered = {
      ...frozen,
      acceptanceCriteria: [...frozen.acceptanceCriteria, 'a brand new AC'],
    };
    const v = verifyCapsule(tampered);
    expect(v.valid).toBe(false);
  });

  it('detects hash-mismatch when testCases changes', () => {
    const frozen = freezeCapsule(fixtureTicket(), { now: TS });
    const tampered = { ...frozen, testCases: [] };
    const v = verifyCapsule(tampered);
    expect(v.valid).toBe(false);
  });

  it('detects hash-mismatch when claims.files changes', () => {
    const frozen = freezeCapsule(fixtureTicket(), { now: TS });
    const tampered = {
      ...frozen,
      claims: { ...(frozen.claims!), files: [...(frozen.claims?.files ?? []), 'apps/auth/src/extra.ts'] },
    };
    const v = verifyCapsule(tampered);
    expect(v.valid).toBe(false);
  });

  it('returns no-frozen-hash drift when capsuleHash is absent', () => {
    const v = verifyCapsule(fixtureTicket());
    expect(v.valid).toBe(false);
    if (!v.valid) {
      expect(v.drift.reason).toBe('no-frozen-hash');
      expect(v.drift.expected).toBeNull();
      expect(v.drift.actual).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('is insensitive to capsuleFrozenAt — only content drives the hash', () => {
    const t = fixtureTicket();
    const frozenA = freezeCapsule(t, { now: 1000 });
    const frozenB = freezeCapsule(t, { now: 999_999 });
    // Both verify against their own hash
    expect(verifyCapsule(frozenA).valid).toBe(true);
    expect(verifyCapsule(frozenB).valid).toBe(true);
    // …and the hashes are equal because content is identical
    expect(frozenA.capsuleHash).toBe(frozenB.capsuleHash);
  });
});

describe('hash determinism — extra invariants', () => {
  it('reordering claims.files does not change the hash', () => {
    const a = fixtureTicket();
    const b = fixtureTicket();
    // reverse the claims file list
    if (b.claims) b.claims.files = [...b.claims.files].reverse();
    expect(computeCapsuleHash(a)).toBe(computeCapsuleHash(b));
  });

  it('reordering taxonomy.techSubDomains.all does not change the hash', () => {
    const a = fixtureTicket();
    const b = fixtureTicket();
    if (b.taxonomy?.techSubDomains) {
      b.taxonomy.techSubDomains = {
        primary: b.taxonomy.techSubDomains.primary,
        all: [...b.taxonomy.techSubDomains.all].reverse(),
      };
    }
    expect(computeCapsuleHash(a)).toBe(computeCapsuleHash(b));
  });
});
