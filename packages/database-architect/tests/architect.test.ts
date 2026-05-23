/**
 * `DatabaseArchitect` — interface compliance tests.
 *
 * Verifies the class adheres to `SpecialistArchitect` per spec §1.1.
 * Mirrors the Frontend Architect's interface compliance suite — the
 * canonical template for every architect package.
 */

import { describe, it, expect } from 'vitest';

import type { SpecialistArchitect } from '../src/types.js';

import {
  DatabaseArchitect,
  DATABASE_ARCHITECT_NAME,
  DATABASE_ARCHITECT_TOOLS
} from '../src/architect.js';
import { DatabaseArchitectContract } from '../src/contract.js';
import { buildFakeInput, fakeGoldenSpawner } from './helpers/fakes.js';

describe('DatabaseArchitect — SpecialistArchitect interface compliance', () => {
  it('exports a class that can be instantiated without args', () => {
    const a = new DatabaseArchitect();
    expect(a).toBeInstanceOf(DatabaseArchitect);
  });

  it('satisfies SpecialistArchitect structurally (will extend BaseArchitect once the kit lands on develop)', () => {
    const a = new DatabaseArchitect();
    expect(typeof a.run).toBe('function');
    expect(typeof a.systemPrompt).toBe('function');
    expect(a.sectionContract).toBeTruthy();
  });

  it('exposes a stable `name` matching the package suffix', () => {
    const a = new DatabaseArchitect();
    expect(a.name).toBe('database');
    expect(a.name).toBe(DATABASE_ARCHITECT_NAME);
  });

  it('exposes `sectionContract` that equals the exported contract', () => {
    const a = new DatabaseArchitect();
    expect(a.sectionContract).toBe(DatabaseArchitectContract);
  });

  it('sectionContract.architectName matches `name` (registry-invariant)', () => {
    const a = new DatabaseArchitect();
    expect(a.sectionContract.architectName).toBe(a.name);
  });

  it('exposes empty `tools` array per V1 spec §2.3 (caia-db-introspect is V2)', () => {
    const a = new DatabaseArchitect();
    expect(a.tools).toBe(DATABASE_ARCHITECT_TOOLS);
    expect(a.tools).toEqual([]);
    expect(a.tools.length).toBe(0);
  });

  it('`systemPrompt()` is a pure function (identical output every call)', () => {
    const a = new DatabaseArchitect();
    const p1 = a.systemPrompt();
    const p2 = a.systemPrompt();
    const p3 = a.systemPrompt();
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
  });

  it('`systemPrompt()` returns a non-empty string', () => {
    const a = new DatabaseArchitect();
    const p = a.systemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(100);
  });

  it('satisfies the `SpecialistArchitect` interface (structural)', () => {
    const a = new DatabaseArchitect();
    const view: SpecialistArchitect = a;
    expect(view.name).toBeTruthy();
    expect(view.sectionContract).toBeTruthy();
    expect(typeof view.systemPrompt).toBe('function');
    expect(typeof view.run).toBe('function');
    expect(Array.isArray(view.tools)).toBe(true);
  });

  it('`run()` returns a Promise<ArchitectOutput>', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new DatabaseArchitect({ spawner });
    const result = a.run(buildFakeInput());
    expect(result).toBeInstanceOf(Promise);
    const out = await result;
    expect(out.architectName).toBe('database');
  });

  it('constructor accepts an injected spawner (test seam)', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    const a = new DatabaseArchitect({ spawner });
    await a.run(buildFakeInput());
    expect(calls.length).toBe(1);
  });

  it('constructor with no spawner falls back to the default (smoke check, no real spawn)', () => {
    // Just instantiating should not error. We do NOT call run() here
    // because that would invoke the real claude binary.
    const a = new DatabaseArchitect();
    expect(a).toBeInstanceOf(DatabaseArchitect);
    expect(typeof a.systemPrompt).toBe('function');
  });
});
