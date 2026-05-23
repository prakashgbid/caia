import { describe, it, expect } from 'vitest';
import {
  contractPaths,
  findDuplicatePaths,
  findOverlappingPaths,
} from '../src/architect-section-contract.js';
import { makeContract, canonicalContractSet } from './fixtures.js';

describe('ArchitectSectionContract — path helpers', () => {
  it('contractPaths returns every declared section path', () => {
    const c = makeContract('foo', ['foo.a', 'foo.b', 'foo.c']);
    expect(contractPaths(c)).toEqual(['foo.a', 'foo.b', 'foo.c']);
  });

  it('findDuplicatePaths returns intra-contract duplicates', () => {
    const c = makeContract('foo', ['foo.a', 'foo.b', 'foo.a']);
    expect(findDuplicatePaths(c)).toEqual(['foo.a']);
  });

  it('findDuplicatePaths returns empty for a clean contract', () => {
    const c = makeContract('foo', ['foo.a', 'foo.b']);
    expect(findDuplicatePaths(c)).toEqual([]);
  });

  it('findOverlappingPaths surfaces inter-contract path conflicts', () => {
    const a = makeContract('a', ['x', 'y']);
    const b = makeContract('b', ['y', 'z']);
    expect(findOverlappingPaths(a, b)).toEqual(['y']);
  });

  it('findOverlappingPaths returns empty for disjoint contracts', () => {
    const a = makeContract('a', ['x']);
    const b = makeContract('b', ['y']);
    expect(findOverlappingPaths(a, b)).toEqual([]);
  });

  it('canonical 17-architect set has disjoint paths globally', () => {
    const contracts = canonicalContractSet();
    const allPaths = contracts.flatMap((c) => contractPaths(c));
    expect(new Set(allPaths).size).toBe(allPaths.length);
  });

  it('canonical 17-architect set contains exactly 17 architects', () => {
    expect(canonicalContractSet().length).toBe(17);
  });
});
