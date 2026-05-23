/**
 * `BackendArchitect` — interface compliance tests.
 *
 * Verifies the class adheres to `SpecialistArchitect` per spec §1.1 and
 * satisfies SpecialistArchitect structurally (will extend BaseArchitect
 * when the kit lands on develop). These tests mirror the canonical
 * `@caia/frontend-architect` compliance suite.
 */

import { describe, it, expect } from 'vitest';

import type { SpecialistArchitect } from '../src/types.js';

import {
  BackendArchitect,
  BACKEND_ARCHITECT_NAME,
  BACKEND_ARCHITECT_TOOLS
} from '../src/architect.js';
import { BackendArchitectContract } from '../src/contract.js';
import { buildFakeInput, fakeGoldenSpawner } from './helpers/fakes.js';

describe('BackendArchitect — SpecialistArchitect interface compliance', () => {
  it('exports a class that can be instantiated without args', () => {
    const a = new BackendArchitect();
    expect(a).toBeInstanceOf(BackendArchitect);
  });

  it('satisfies SpecialistArchitect structurally (will extend BaseArchitect once the kit lands on develop)', () => {
    const a = new BackendArchitect();
    expect(typeof a.run).toBe('function');
    expect(typeof a.systemPrompt).toBe('function');
    expect(a.sectionContract).toBeTruthy();
  });

  it('exposes a stable `name` matching the package suffix', () => {
    const a = new BackendArchitect();
    expect(a.name).toBe('backend');
    expect(a.name).toBe(BACKEND_ARCHITECT_NAME);
  });

  it('exposes `sectionContract` that equals the exported contract', () => {
    const a = new BackendArchitect();
    expect(a.sectionContract).toBe(BackendArchitectContract);
  });

  it('sectionContract.architectName matches `name` (registry-invariant)', () => {
    const a = new BackendArchitect();
    expect(a.sectionContract.architectName).toBe(a.name);
  });

  it('exposes empty `tools` array per V1 spec §2.2', () => {
    const a = new BackendArchitect();
    expect(a.tools).toBe(BACKEND_ARCHITECT_TOOLS);
    expect(a.tools).toEqual([]);
    expect(a.tools.length).toBe(0);
  });

  it('`systemPrompt()` is a pure function (identical output every call)', () => {
    const a = new BackendArchitect();
    const p1 = a.systemPrompt();
    const p2 = a.systemPrompt();
    const p3 = a.systemPrompt();
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
  });

  it('`systemPrompt()` returns a non-empty string', () => {
    const a = new BackendArchitect();
    const p = a.systemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(100);
  });

  it('satisfies the `SpecialistArchitect` interface (structural)', () => {
    const a = new BackendArchitect();
    const view: SpecialistArchitect = a;
    expect(view.name).toBeTruthy();
    expect(view.sectionContract).toBeTruthy();
    expect(typeof view.systemPrompt).toBe('function');
    expect(typeof view.run).toBe('function');
    expect(Array.isArray(view.tools)).toBe(true);
  });

  it('`run()` returns a Promise<ArchitectOutput>', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new BackendArchitect({ spawner });
    const result = a.run(buildFakeInput());
    expect(result).toBeInstanceOf(Promise);
    const out = await result;
    expect(out.architectName).toBe('backend');
  });

  it('constructor accepts an injected spawner (test seam)', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    const a = new BackendArchitect({ spawner });
    await a.run(buildFakeInput());
    expect(calls.length).toBe(1);
  });

  it('constructor with no spawner falls back to the default (smoke check, no real spawn)', () => {
    // Just instantiating should not error. We do NOT call run() here
    // because that would invoke the real claude binary.
    const a = new BackendArchitect();
    expect(a).toBeInstanceOf(BackendArchitect);
    expect(typeof a.systemPrompt).toBe('function');
  });
});
