/**
 * @caia/principal-po — facade re-export smoke tests.
 *
 * These tests deliberately do NOT duplicate functional coverage of the
 * three subordinate packages. Each subordinate (decomposer-recursive,
 * principal-engineer, architect-kit) owns its own functional tests.
 *
 * Here we only assert that the facade's public surface is wired up:
 *   1. every named export resolves
 *   2. the underlying value/class identity matches the subordinate package
 *   3. canonical-name aliases (`scheduleStoryGraph`, `decomposeStoryHierarchy`)
 *      point at the right underlying implementation
 */

import { describe, expect, it } from 'vitest';

import * as facade from '../src/index.js';
import { schedule as principalEngineerSchedule } from '@caia/principal-engineer';
import {
  PORecursiveDecomposer as DRPORecursiveDecomposer,
} from '@chiefaia/decomposer-recursive';
import {
  ArchitectRegistry as KitArchitectRegistry,
  BaseArchitect as KitBaseArchitect,
  computeWaves as kitComputeWaves,
  computeWavesFromMeta as kitComputeWavesFromMeta,
} from '@caia/architect-kit';

describe('@caia/principal-po — facade re-export shape', () => {
  it('exports a callable `scheduleStoryGraph` aliasing principal-engineer.schedule', () => {
    expect(typeof facade.scheduleStoryGraph).toBe('function');
    expect(facade.scheduleStoryGraph).toBe(principalEngineerSchedule);
  });

  it('exports a callable `decomposeStoryHierarchy` wrapper', () => {
    expect(typeof facade.decomposeStoryHierarchy).toBe('function');
    // Wrapper is a fresh function, not the underlying method — but it
    // must construct a PORecursiveDecomposer when called. Smoke-check
    // its arity (one argument: opts).
    expect(facade.decomposeStoryHierarchy.length).toBe(1);
  });

  it('re-exports `PORecursiveDecomposer` class identity from decomposer-recursive', () => {
    expect(facade.PORecursiveDecomposer).toBe(DRPORecursiveDecomposer);
    expect(typeof facade.PORecursiveDecomposer).toBe('function');
    const instance = new facade.PORecursiveDecomposer();
    expect(instance).toBeInstanceOf(DRPORecursiveDecomposer);
  });

  it('re-exports `ArchitectRegistry` class identity from architect-kit', () => {
    expect(facade.ArchitectRegistry).toBe(KitArchitectRegistry);
    expect(typeof facade.ArchitectRegistry).toBe('function');
  });

  it('re-exports `BaseArchitect` class identity from architect-kit', () => {
    expect(facade.BaseArchitect).toBe(KitBaseArchitect);
    expect(typeof facade.BaseArchitect).toBe('function');
  });

  it('re-exports `computeWaves` function identity from architect-kit', () => {
    expect(facade.computeWaves).toBe(kitComputeWaves);
    expect(typeof facade.computeWaves).toBe('function');
  });

  it('re-exports `computeWavesFromMeta` function identity from architect-kit', () => {
    expect(facade.computeWavesFromMeta).toBe(kitComputeWavesFromMeta);
    expect(typeof facade.computeWavesFromMeta).toBe('function');
  });

  it('decomposeStoryHierarchy is not the same reference as PORecursiveDecomposer.prototype.decomposeRoot (it is a wrapper)', () => {
    expect(facade.decomposeStoryHierarchy).not.toBe(
      DRPORecursiveDecomposer.prototype.decomposeRoot,
    );
  });

  it('exposes every advertised named export (snapshot of canonical surface)', () => {
    const expected = [
      'decomposeStoryHierarchy',
      'scheduleStoryGraph',
      'PORecursiveDecomposer',
      'ArchitectRegistry',
      'BaseArchitect',
      'computeWaves',
      'computeWavesFromMeta',
    ];
    for (const name of expected) {
      expect(
        Object.prototype.hasOwnProperty.call(facade, name),
        `facade should re-export ${name}`,
      ).toBe(true);
    }
  });

  it('does NOT re-export anything outside the canonical surface (no accidental leaks)', () => {
    // The facade is intentionally narrow. Adding new exports is allowed,
    // but they should be deliberate and documented in README.md. This
    // test prevents drift by enforcing an allowlist.
    const allowlist = new Set([
      // value exports
      'decomposeStoryHierarchy',
      'scheduleStoryGraph',
      'PORecursiveDecomposer',
      'ArchitectRegistry',
      'BaseArchitect',
      'computeWaves',
      'computeWavesFromMeta',
    ]);
    const actualValueExports = Object.keys(facade).filter(
      (k) => typeof (facade as Record<string, unknown>)[k] !== 'undefined',
    );
    for (const name of actualValueExports) {
      expect(allowlist.has(name), `unexpected export ${name}`).toBe(true);
    }
  });

  it('facade is importable as a single module (no side-effect crash on load)', () => {
    expect(facade).toBeDefined();
    expect(typeof facade).toBe('object');
  });

  it('underlying packages stay independent — facade does not mutate their exports', () => {
    // Reassigning on the facade namespace should not leak back to source.
    const originalSchedule = principalEngineerSchedule;
    const originalRegistry = KitArchitectRegistry;
    // (we don't actually try to mutate — ES modules are read-only — but
    // the test documents the invariant)
    expect(facade.scheduleStoryGraph).toBe(originalSchedule);
    expect(facade.ArchitectRegistry).toBe(originalRegistry);
  });
});
