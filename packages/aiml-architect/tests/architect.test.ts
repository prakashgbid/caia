/**
 * `AIMLArchitect` — interface compliance tests.
 *
 * Verifies the class adheres to `SpecialistArchitect` per spec §1.1 and
 * satisfies SpecialistArchitect structurally. Mirrors the canonical
 * compliance suite from @caia/frontend-architect.
 */

import { describe, it, expect } from 'vitest';

import type { SpecialistArchitect } from '../src/types.js';

import {
  AIMLArchitect,
  AIML_ARCHITECT_NAME,
  AIML_ARCHITECT_TOOLS
} from '../src/architect.js';
import { AIMLArchitectContract } from '../src/contract.js';
import { buildFakeInput, fakeGoldenSpawner } from './helpers/fakes.js';

describe('AIMLArchitect — SpecialistArchitect interface compliance', () => {
  it('exports a class that can be instantiated without args', () => {
    const a = new AIMLArchitect();
    expect(a).toBeInstanceOf(AIMLArchitect);
  });

  it('satisfies SpecialistArchitect structurally', () => {
    const a = new AIMLArchitect();
    expect(typeof a.run).toBe('function');
    expect(typeof a.systemPrompt).toBe('function');
    expect(a.sectionContract).toBeTruthy();
  });

  it('exposes a stable `name` matching the V2 brief', () => {
    const a = new AIMLArchitect();
    expect(a.name).toBe('ai-ml');
    expect(a.name).toBe(AIML_ARCHITECT_NAME);
  });

  it('exposes `sectionContract` that equals the exported contract', () => {
    const a = new AIMLArchitect();
    expect(a.sectionContract).toBe(AIMLArchitectContract);
  });

  it('sectionContract.architectName matches `name` (registry-invariant)', () => {
    const a = new AIMLArchitect();
    expect(a.sectionContract.architectName).toBe(a.name);
  });

  it('exposes empty `tools` array per V1 brief', () => {
    const a = new AIMLArchitect();
    expect(a.tools).toBe(AIML_ARCHITECT_TOOLS);
    expect(a.tools).toEqual([]);
    expect(a.tools.length).toBe(0);
  });

  it('`systemPrompt()` is a pure function (identical output every call)', () => {
    const a = new AIMLArchitect();
    const p1 = a.systemPrompt();
    const p2 = a.systemPrompt();
    const p3 = a.systemPrompt();
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
  });

  it('`systemPrompt()` returns a non-empty string', () => {
    const a = new AIMLArchitect();
    const p = a.systemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(100);
  });

  it('satisfies the `SpecialistArchitect` interface (structural)', () => {
    const a = new AIMLArchitect();
    const view: SpecialistArchitect = a;
    expect(view.name).toBeTruthy();
    expect(view.sectionContract).toBeTruthy();
    expect(typeof view.systemPrompt).toBe('function');
    expect(typeof view.run).toBe('function');
    expect(Array.isArray(view.tools)).toBe(true);
  });

  it('`run()` returns a Promise<ArchitectOutput>', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new AIMLArchitect({ spawner });
    const result = a.run(buildFakeInput());
    expect(result).toBeInstanceOf(Promise);
    const out = await result;
    expect(out.architectName).toBe('ai-ml');
  });

  it('constructor accepts an injected spawner (test seam)', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    const a = new AIMLArchitect({ spawner });
    await a.run(buildFakeInput());
    expect(calls.length).toBe(1);
  });

  it('constructor with no spawner falls back to the default (smoke check, no real spawn)', () => {
    // Just instantiating should not error. We do NOT call run() here
    // because that would invoke the real claude binary.
    const a = new AIMLArchitect();
    expect(a).toBeInstanceOf(AIMLArchitect);
    expect(typeof a.systemPrompt).toBe('function');
  });
});
