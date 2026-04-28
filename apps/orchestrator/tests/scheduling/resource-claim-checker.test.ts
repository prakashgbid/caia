/**
 * BUCKET-009 — resource-claim checker unit tests.
 */

import {
  parseClaims,
  checkClaimsConflict,
  requiresFineGrainedClaims,
  passesFineGrainedClaimsGate,
} from '../../src/scheduling/resource-claim-checker';

describe('parseClaims', () => {
  it('returns empty claims for null/undefined/empty', () => {
    expect(parseClaims(null)).toEqual({ files: [], schemas: [], apiRoutes: [], domains: [] });
    expect(parseClaims(undefined)).toEqual({ files: [], schemas: [], apiRoutes: [], domains: [] });
    expect(parseClaims('')).toEqual({ files: [], schemas: [], apiRoutes: [], domains: [] });
  });

  it('returns empty on malformed JSON', () => {
    expect(parseClaims('not json')).toEqual({
      files: [],
      schemas: [],
      apiRoutes: [],
      domains: [],
    });
  });

  it('parses a well-formed claims JSON', () => {
    const c = parseClaims(
      JSON.stringify({
        files: ['a.ts'],
        schemas: ['t.col'],
        apiRoutes: ['POST /x'],
        domains: ['frontend'],
      }),
    );
    expect(c.files).toEqual(['a.ts']);
    expect(c.schemas).toEqual(['t.col']);
    expect(c.apiRoutes).toEqual(['POST /x']);
    expect(c.domains).toEqual(['frontend']);
  });

  it('filters out non-string entries', () => {
    const c = parseClaims(
      JSON.stringify({
        files: ['a.ts', 42, null, 'b.ts'],
        schemas: [],
        apiRoutes: [],
        domains: [],
      }),
    );
    expect(c.files).toEqual(['a.ts', 'b.ts']);
  });
});

describe('checkClaimsConflict', () => {
  const empty = { files: [], schemas: [], apiRoutes: [], domains: [] };

  it('no conflict when both candidate and inFlight are empty', () => {
    const r = checkClaimsConflict({ id: 'a', claims: empty }, []);
    expect(r.conflict).toBe(false);
  });

  it('conflict on overlapping file', () => {
    const r = checkClaimsConflict(
      { id: 'a', claims: { ...empty, files: ['x.ts'] } },
      [{ id: 'b', claims: { ...empty, files: ['x.ts'] } }],
    );
    expect(r.conflict).toBe(true);
    expect(r.overlappingFiles).toEqual(['x.ts']);
    expect(r.blockerStoryId).toBe('b');
  });

  it('conflict on overlapping schema', () => {
    const r = checkClaimsConflict(
      { id: 'a', claims: { ...empty, schemas: ['stories.lifecycle'] } },
      [{ id: 'b', claims: { ...empty, schemas: ['stories.lifecycle'] } }],
    );
    expect(r.conflict).toBe(true);
    expect(r.overlappingSchemas).toEqual(['stories.lifecycle']);
  });

  it('conflict on overlapping api route', () => {
    const r = checkClaimsConflict(
      { id: 'a', claims: { ...empty, apiRoutes: ['POST /api/billing'] } },
      [{ id: 'b', claims: { ...empty, apiRoutes: ['POST /api/billing'] } }],
    );
    expect(r.conflict).toBe(true);
    expect(r.overlappingApiRoutes).toEqual(['POST /api/billing']);
  });

  it('domains overlap alone does NOT cause a conflict', () => {
    const r = checkClaimsConflict(
      { id: 'a', claims: { ...empty, domains: ['frontend'] } },
      [{ id: 'b', claims: { ...empty, domains: ['frontend'] } }],
    );
    expect(r.conflict).toBe(false);
  });

  it('different files in same dir do NOT conflict', () => {
    const r = checkClaimsConflict(
      { id: 'a', claims: { ...empty, files: ['a/b/x.ts'] } },
      [{ id: 'b', claims: { ...empty, files: ['a/b/y.ts'] } }],
    );
    expect(r.conflict).toBe(false);
  });

  it('a story does not conflict with itself', () => {
    const r = checkClaimsConflict(
      { id: 'a', claims: { ...empty, files: ['x.ts'] } },
      [{ id: 'a', claims: { ...empty, files: ['x.ts'] } }],
    );
    expect(r.conflict).toBe(false);
  });

  it('returns first conflict only', () => {
    const r = checkClaimsConflict(
      { id: 'a', claims: { ...empty, files: ['x.ts', 'y.ts'] } },
      [
        { id: 'b', claims: { ...empty, files: ['x.ts'] } },
        { id: 'c', claims: { ...empty, files: ['y.ts'] } },
      ],
    );
    expect(r.conflict).toBe(true);
    expect(r.blockerStoryId).toBe('b');
  });
});

describe('requiresFineGrainedClaims', () => {
  it('returns true for high', () => {
    expect(requiresFineGrainedClaims('high')).toBe(true);
  });
  it('returns true for critical', () => {
    expect(requiresFineGrainedClaims('critical')).toBe(true);
  });
  it('returns false for low/medium/null/undefined', () => {
    expect(requiresFineGrainedClaims('low')).toBe(false);
    expect(requiresFineGrainedClaims('medium')).toBe(false);
    expect(requiresFineGrainedClaims(null)).toBe(false);
    expect(requiresFineGrainedClaims(undefined)).toBe(false);
  });
});

describe('passesFineGrainedClaimsGate', () => {
  const empty = { files: [], schemas: [], apiRoutes: [], domains: [] };

  it('always passes for low/medium risk', () => {
    expect(passesFineGrainedClaimsGate('low', empty)).toBe(true);
    expect(passesFineGrainedClaimsGate('medium', empty)).toBe(true);
  });

  it('fails for high risk with no file claims', () => {
    expect(passesFineGrainedClaimsGate('high', empty)).toBe(false);
  });

  it('passes for high risk with file claims', () => {
    expect(passesFineGrainedClaimsGate('high', { ...empty, files: ['x.ts'] })).toBe(true);
  });

  it('fails for critical risk with no file claims', () => {
    expect(passesFineGrainedClaimsGate('critical', empty)).toBe(false);
  });

  it('passes for critical risk with file claims', () => {
    expect(passesFineGrainedClaimsGate('critical', { ...empty, files: ['x.ts'] })).toBe(true);
  });
});
