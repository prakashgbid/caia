/**
 * `TimeMachineArchitect` — interface compliance tests.
 */

import { describe, it, expect } from 'vitest';

import type { SpecialistArchitect } from '../src/types.js';

import {
  TimeMachineArchitect,
  TIME_MACHINE_ARCHITECT_NAME,
  TIME_MACHINE_ARCHITECT_TOOLS
} from '../src/architect.js';
import { TimeMachineArchitectContract } from '../src/contract.js';
import { buildFakeInput, fakeGoldenSpawner } from './helpers/fakes.js';

describe('TimeMachineArchitect — SpecialistArchitect interface compliance', () => {
  it('exports a class that can be instantiated without args', () => {
    const a = new TimeMachineArchitect();
    expect(a).toBeInstanceOf(TimeMachineArchitect);
  });

  it('satisfies SpecialistArchitect structurally', () => {
    const a = new TimeMachineArchitect();
    expect(typeof a.run).toBe('function');
    expect(typeof a.systemPrompt).toBe('function');
    expect(a.sectionContract).toBeTruthy();
  });

  it('exposes a stable `name` matching the V2 task brief', () => {
    const a = new TimeMachineArchitect();
    expect(a.name).toBe('time-machine');
    expect(a.name).toBe(TIME_MACHINE_ARCHITECT_NAME);
  });

  it('exposes `sectionContract` that equals the exported contract', () => {
    const a = new TimeMachineArchitect();
    expect(a.sectionContract).toBe(TimeMachineArchitectContract);
  });

  it('sectionContract.architectName matches `name` (registry-invariant)', () => {
    const a = new TimeMachineArchitect();
    expect(a.sectionContract.architectName).toBe(a.name);
  });

  it('exposes empty `tools` array per V1 task brief', () => {
    const a = new TimeMachineArchitect();
    expect(a.tools).toBe(TIME_MACHINE_ARCHITECT_TOOLS);
    expect(a.tools).toEqual([]);
    expect(a.tools.length).toBe(0);
  });

  it('`systemPrompt()` is a pure function (identical output every call)', () => {
    const a = new TimeMachineArchitect();
    const p1 = a.systemPrompt();
    const p2 = a.systemPrompt();
    const p3 = a.systemPrompt();
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
  });

  it('`systemPrompt()` returns a non-empty string', () => {
    const a = new TimeMachineArchitect();
    const p = a.systemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(100);
  });

  it('satisfies the `SpecialistArchitect` interface (structural)', () => {
    const a = new TimeMachineArchitect();
    const view: SpecialistArchitect = a;
    expect(view.name).toBeTruthy();
    expect(view.sectionContract).toBeTruthy();
    expect(typeof view.systemPrompt).toBe('function');
    expect(typeof view.run).toBe('function');
    expect(Array.isArray(view.tools)).toBe(true);
  });

  it('`run()` returns a Promise<ArchitectOutput>', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new TimeMachineArchitect({ spawner });
    const result = a.run(buildFakeInput());
    expect(result).toBeInstanceOf(Promise);
    const out = await result;
    expect(out.architectName).toBe('time-machine');
  });

  it('constructor accepts an injected spawner (test seam)', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    const a = new TimeMachineArchitect({ spawner });
    await a.run(buildFakeInput());
    expect(calls.length).toBe(1);
  });

  it('constructor with no spawner falls back to the default (smoke check, no real spawn)', () => {
    const a = new TimeMachineArchitect();
    expect(a).toBeInstanceOf(TimeMachineArchitect);
    expect(typeof a.systemPrompt).toBe('function');
  });
});
