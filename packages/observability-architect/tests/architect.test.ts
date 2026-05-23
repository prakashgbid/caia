/**
 * `ObservabilityArchitect` — interface compliance tests.
 *
 * Verifies the class adheres to `SpecialistArchitect` per spec §1.1 and
 * satisfies SpecialistArchitect structurally (will extend BaseArchitect
 * when the kit lands on develop). These tests are part of the canonical
 * compliance suite the 17 architect packages share.
 */

import { describe, it, expect } from 'vitest';

import type { SpecialistArchitect } from '../src/types.js';

import {
  ObservabilityArchitect,
  OBSERVABILITY_ARCHITECT_NAME,
  OBSERVABILITY_ARCHITECT_TOOLS
} from '../src/architect.js';
import { ObservabilityArchitectContract } from '../src/contract.js';
import { buildFakeInput, fakeGoldenSpawner } from './helpers/fakes.js';

describe('ObservabilityArchitect — SpecialistArchitect interface compliance', () => {
  it('exports a class that can be instantiated without args', () => {
    const a = new ObservabilityArchitect();
    expect(a).toBeInstanceOf(ObservabilityArchitect);
  });

  it('satisfies SpecialistArchitect structurally', () => {
    const a = new ObservabilityArchitect();
    expect(typeof a.run).toBe('function');
    expect(typeof a.systemPrompt).toBe('function');
    expect(a.sectionContract).toBeTruthy();
  });

  it('exposes a stable `name` matching the package suffix', () => {
    const a = new ObservabilityArchitect();
    expect(a.name).toBe('observability');
    expect(a.name).toBe(OBSERVABILITY_ARCHITECT_NAME);
  });

  it('exposes `sectionContract` that equals the exported contract', () => {
    const a = new ObservabilityArchitect();
    expect(a.sectionContract).toBe(ObservabilityArchitectContract);
  });

  it('sectionContract.architectName matches `name` (registry-invariant)', () => {
    const a = new ObservabilityArchitect();
    expect(a.sectionContract.architectName).toBe(a.name);
  });

  it('exposes empty `tools` array per V1 spec §2.9', () => {
    const a = new ObservabilityArchitect();
    expect(a.tools).toBe(OBSERVABILITY_ARCHITECT_TOOLS);
    expect(a.tools).toEqual([]);
    expect(a.tools.length).toBe(0);
  });

  it('`systemPrompt()` is a pure function (identical output every call)', () => {
    const a = new ObservabilityArchitect();
    const p1 = a.systemPrompt();
    const p2 = a.systemPrompt();
    const p3 = a.systemPrompt();
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
  });

  it('`systemPrompt()` returns a non-empty string', () => {
    const a = new ObservabilityArchitect();
    const p = a.systemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(100);
  });

  it('satisfies the `SpecialistArchitect` interface (structural)', () => {
    const a = new ObservabilityArchitect();
    const view: SpecialistArchitect = a;
    expect(view.name).toBeTruthy();
    expect(view.sectionContract).toBeTruthy();
    expect(typeof view.systemPrompt).toBe('function');
    expect(typeof view.run).toBe('function');
    expect(Array.isArray(view.tools)).toBe(true);
  });

  it('`run()` returns a Promise<ArchitectOutput>', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new ObservabilityArchitect({ spawner });
    const result = a.run(buildFakeInput());
    expect(result).toBeInstanceOf(Promise);
    const out = await result;
    expect(out.architectName).toBe('observability');
  });

  it('constructor accepts an injected spawner (test seam)', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    const a = new ObservabilityArchitect({ spawner });
    await a.run(buildFakeInput());
    expect(calls.length).toBe(1);
  });

  it('constructor with no spawner falls back to the default (smoke check, no real spawn)', () => {
    const a = new ObservabilityArchitect();
    expect(a).toBeInstanceOf(ObservabilityArchitect);
    expect(typeof a.systemPrompt).toBe('function');
  });
});
