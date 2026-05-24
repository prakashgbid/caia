/**
 * DevopsArchitect — interface compliance tests.
 */
import { describe, it, expect } from 'vitest';
import type { SpecialistArchitect } from '../src/types.js';
import { DevopsArchitect, DEVOPS_ARCHITECT_NAME, DEVOPS_ARCHITECT_TOOLS } from '../src/architect.js';
import { DevopsArchitectContract } from '../src/contract.js';
import { buildFakeInput, fakeGoldenSpawner } from './helpers/fakes.js';

describe('DevopsArchitect - SpecialistArchitect interface compliance', () => {
  it('exports a class that can be instantiated without args', () => {
    const a = new DevopsArchitect();
    expect(a).toBeInstanceOf(DevopsArchitect);
  });

  it('satisfies SpecialistArchitect structurally', () => {
    const a = new DevopsArchitect();
    expect(typeof a.run).toBe('function');
    expect(typeof a.systemPrompt).toBe('function');
    expect(a.sectionContract).toBeTruthy();
  });

  it('exposes a stable name matching the package suffix', () => {
    const a = new DevopsArchitect();
    expect(a.name).toBe('devops');
    expect(a.name).toBe(DEVOPS_ARCHITECT_NAME);
  });

  it('sectionContract equals exported contract', () => {
    const a = new DevopsArchitect();
    expect(a.sectionContract).toBe(DevopsArchitectContract);
  });

  it('sectionContract.architectName matches name (registry-invariant)', () => {
    const a = new DevopsArchitect();
    expect(a.sectionContract.architectName).toBe(a.name);
  });

  it('exposes empty tools array per V1', () => {
    const a = new DevopsArchitect();
    expect(a.tools).toBe(DEVOPS_ARCHITECT_TOOLS);
    expect(a.tools).toEqual([]);
    expect(a.tools.length).toBe(0);
  });

  it('systemPrompt() is pure (identical output every call)', () => {
    const a = new DevopsArchitect();
    expect(a.systemPrompt()).toBe(a.systemPrompt());
  });

  it('systemPrompt() returns a non-empty string', () => {
    const a = new DevopsArchitect();
    const p = a.systemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(100);
  });

  it('satisfies the SpecialistArchitect interface structurally', () => {
    const a = new DevopsArchitect();
    const view: SpecialistArchitect = a;
    expect(view.name).toBeTruthy();
    expect(view.sectionContract).toBeTruthy();
    expect(typeof view.systemPrompt).toBe('function');
    expect(typeof view.run).toBe('function');
    expect(Array.isArray(view.tools)).toBe(true);
  });

  it('run() returns a Promise<ArchitectOutput>', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new DevopsArchitect({ spawner });
    const result = a.run(buildFakeInput());
    expect(result).toBeInstanceOf(Promise);
    const out = await result;
    expect(out.architectName).toBe('devops');
  });

  it('constructor accepts an injected spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    const a = new DevopsArchitect({ spawner });
    await a.run(buildFakeInput());
    expect(calls.length).toBe(1);
  });

  it('constructor with no spawner falls back to default', () => {
    const a = new DevopsArchitect();
    expect(a).toBeInstanceOf(DevopsArchitect);
    expect(typeof a.systemPrompt).toBe('function');
  });
});
