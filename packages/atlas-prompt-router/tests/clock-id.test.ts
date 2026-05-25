import { describe, expect, it } from 'vitest';
import { counterIdGen, randomIdGen } from '../src/id.js';
import { frozenClockFrom, steppingClockFrom, systemClock } from '../src/clock.js';

describe('counterIdGen', () => {
  it('emits monotonically increasing ids', () => {
    const g = counterIdGen('tv');
    expect(g()).toBe('tv_000001');
    expect(g()).toBe('tv_000002');
    expect(g()).toBe('tv_000003');
  });
  it('rejects empty prefix', () => {
    expect(() => counterIdGen('')).toThrow(TypeError);
  });
});

describe('randomIdGen', () => {
  it('produces ids of the expected shape', () => {
    let n = 0;
    const rng = (): number => { n += 1; return (n * 0.3) % 1; };
    const g = randomIdGen('pg', rng);
    expect(g()).toMatch(/^pg_[0-9a-z]{10}$/);
  });
  it('rejects empty prefix', () => {
    expect(() => randomIdGen('')).toThrow(TypeError);
  });
});

describe('frozenClockFrom', () => {
  it('returns the same instant on repeated calls', () => {
    const c = frozenClockFrom('2026-05-24T12:00:00.000Z');
    expect(c()).toBe('2026-05-24T12:00:00.000Z');
    expect(c()).toBe('2026-05-24T12:00:00.000Z');
  });
  it('normalises tz suffixes', () => {
    const c = frozenClockFrom('2026-05-24T17:30:00+05:30');
    expect(c()).toBe('2026-05-24T12:00:00.000Z');
  });
  it('rejects unparseable input', () => {
    expect(() => frozenClockFrom('not a date')).toThrow(TypeError);
  });
});

describe('steppingClockFrom', () => {
  it('advances by stepMs on each call', () => {
    const c = steppingClockFrom('2026-05-24T12:00:00.000Z', 250);
    expect(c()).toBe('2026-05-24T12:00:00.000Z');
    expect(c()).toBe('2026-05-24T12:00:00.250Z');
    expect(c()).toBe('2026-05-24T12:00:00.500Z');
  });
  it('rejects negative stepMs', () => {
    expect(() => steppingClockFrom('2026-05-24T12:00:00.000Z', -1)).toThrow(TypeError);
  });
});

describe('systemClock', () => {
  it('returns the wall-clock as ISO', () => {
    const out = systemClock()();
    expect(typeof out).toBe('string');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
