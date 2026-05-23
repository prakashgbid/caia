/**
 * `PerformanceArchitect` — interface compliance tests.
 *
 * Verifies the class adheres to `SpecialistArchitect` per spec §1.1 and
 * satisfies SpecialistArchitect structurally (will extend BaseArchitect
 * when the kit lands on develop). These tests mirror the Frontend +
 * Accessibility Architect compliance suites — the same shape every
 * architect package uses.
 */

import { describe, it, expect } from 'vitest';

import type { SpecialistArchitect } from '../src/types.js';

import {
  PerformanceArchitect,
  PERFORMANCE_ARCHITECT_NAME,
  PERFORMANCE_ARCHITECT_TOOLS
} from '../src/architect.js';
import { PerformanceArchitectContract } from '../src/contract.js';
import { buildFakeInput, fakeGoldenSpawner } from './helpers/fakes.js';

describe('PerformanceArchitect — SpecialistArchitect interface compliance', () => {
  it('exports a class that can be instantiated without args', () => {
    const a = new PerformanceArchitect();
    expect(a).toBeInstanceOf(PerformanceArchitect);
  });

  it('satisfies SpecialistArchitect structurally (will extend BaseArchitect once the kit lands on develop)', () => {
    const a = new PerformanceArchitect();
    expect(typeof a.run).toBe('function');
    expect(typeof a.systemPrompt).toBe('function');
    expect(a.sectionContract).toBeTruthy();
  });

  it('exposes a stable `name` matching the package suffix', () => {
    const a = new PerformanceArchitect();
    expect(a.name).toBe('performance');
    expect(a.name).toBe(PERFORMANCE_ARCHITECT_NAME);
  });

  it('exposes `sectionContract` that equals the exported contract', () => {
    const a = new PerformanceArchitect();
    expect(a.sectionContract).toBe(PerformanceArchitectContract);
  });

  it('sectionContract.architectName matches `name` (registry-invariant)', () => {
    const a = new PerformanceArchitect();
    expect(a.sectionContract.architectName).toBe(a.name);
  });

  it('exposes empty `tools` array per V1 spec §2.6', () => {
    const a = new PerformanceArchitect();
    expect(a.tools).toBe(PERFORMANCE_ARCHITECT_TOOLS);
    expect(a.tools).toEqual([]);
    expect(a.tools.length).toBe(0);
  });

  it('declares Frontend as an upstream dependency', () => {
    const a = new PerformanceArchitect();
    expect(a.sectionContract.architectMeta.dependsOn).toEqual(['frontend']);
  });

  it('`systemPrompt()` is a pure function (identical output every call)', () => {
    const a = new PerformanceArchitect();
    const p1 = a.systemPrompt();
    const p2 = a.systemPrompt();
    const p3 = a.systemPrompt();
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
  });

  it('`systemPrompt()` returns a non-empty string', () => {
    const a = new PerformanceArchitect();
    const p = a.systemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(100);
  });

  it('satisfies the `SpecialistArchitect` interface (structural)', () => {
    const a = new PerformanceArchitect();
    const view: SpecialistArchitect = a;
    expect(view.name).toBeTruthy();
    expect(view.sectionContract).toBeTruthy();
    expect(typeof view.systemPrompt).toBe('function');
    expect(typeof view.run).toBe('function');
    expect(Array.isArray(view.tools)).toBe(true);
  });

  it('`run()` returns a Promise<ArchitectOutput>', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new PerformanceArchitect({ spawner });
    const result = a.run(buildFakeInput());
    expect(result).toBeInstanceOf(Promise);
    const out = await result;
    expect(out.architectName).toBe('performance');
  });

  it('constructor accepts an injected spawner (test seam)', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    const a = new PerformanceArchitect({ spawner });
    await a.run(buildFakeInput());
    expect(calls.length).toBe(1);
  });

  it('constructor with no spawner falls back to the default (smoke check, no real spawn)', () => {
    // Just instantiating should not error. We do NOT call run() here
    // because that would invoke the real claude binary.
    const a = new PerformanceArchitect();
    expect(a).toBeInstanceOf(PerformanceArchitect);
    expect(typeof a.systemPrompt).toBe('function');
  });
});
