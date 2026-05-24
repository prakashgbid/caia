/**
 * `AnalyticsArchitect` — interface compliance tests.
 *
 * Verifies the class adheres to `SpecialistArchitect` per spec §1.1.
 */

import { describe, it, expect } from 'vitest';

import type { SpecialistArchitect } from '../src/types.js';

import {
  AnalyticsArchitect,
  ANALYTICS_ARCHITECT_NAME,
  ANALYTICS_ARCHITECT_TOOLS
} from '../src/architect.js';
import { AnalyticsArchitectContract } from '../src/contract.js';
import { buildFakeInput, fakeGoldenSpawner } from './helpers/fakes.js';

describe('AnalyticsArchitect — SpecialistArchitect interface compliance', () => {
  it('exports a class that can be instantiated without args', () => {
    const a = new AnalyticsArchitect();
    expect(a).toBeInstanceOf(AnalyticsArchitect);
  });

  it('satisfies SpecialistArchitect structurally', () => {
    const a = new AnalyticsArchitect();
    expect(typeof a.run).toBe('function');
    expect(typeof a.systemPrompt).toBe('function');
    expect(a.sectionContract).toBeTruthy();
  });

  it('exposes a stable `name` matching the architect-kit canonical entry', () => {
    const a = new AnalyticsArchitect();
    expect(a.name).toBe('analytics');
    expect(a.name).toBe(ANALYTICS_ARCHITECT_NAME);
  });

  it('exposes `sectionContract` that equals the exported contract', () => {
    const a = new AnalyticsArchitect();
    expect(a.sectionContract).toBe(AnalyticsArchitectContract);
  });

  it('sectionContract.architectName matches `name` (registry-invariant)', () => {
    const a = new AnalyticsArchitect();
    expect(a.sectionContract.architectName).toBe(a.name);
  });

  it('exposes empty `tools` array per V1 spec §2.8', () => {
    const a = new AnalyticsArchitect();
    expect(a.tools).toBe(ANALYTICS_ARCHITECT_TOOLS);
    expect(a.tools).toEqual([]);
    expect(a.tools.length).toBe(0);
  });

  it('`systemPrompt()` is a pure function (identical output every call)', () => {
    const a = new AnalyticsArchitect();
    const p1 = a.systemPrompt();
    const p2 = a.systemPrompt();
    const p3 = a.systemPrompt();
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
  });

  it('`systemPrompt()` returns a non-empty string', () => {
    const a = new AnalyticsArchitect();
    const p = a.systemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(100);
  });

  it('satisfies the `SpecialistArchitect` interface (structural)', () => {
    const a = new AnalyticsArchitect();
    const view: SpecialistArchitect = a;
    expect(view.name).toBeTruthy();
    expect(view.sectionContract).toBeTruthy();
    expect(typeof view.systemPrompt).toBe('function');
    expect(typeof view.run).toBe('function');
    expect(Array.isArray(view.tools)).toBe(true);
  });

  it('`run()` returns a Promise<ArchitectOutput>', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new AnalyticsArchitect({ spawner });
    const result = a.run(buildFakeInput());
    expect(result).toBeInstanceOf(Promise);
    const out = await result;
    expect(out.architectName).toBe('analytics');
  });

  it('constructor accepts an injected spawner (test seam)', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    const a = new AnalyticsArchitect({ spawner });
    await a.run(buildFakeInput());
    expect(calls.length).toBe(1);
  });

  it('constructor with no spawner falls back to the default (smoke check, no real spawn)', () => {
    // Just instantiating should not error. We do NOT call run() here
    // because that would invoke the real claude binary.
    const a = new AnalyticsArchitect();
    expect(a).toBeInstanceOf(AnalyticsArchitect);
    expect(typeof a.systemPrompt).toBe('function');
  });
});
