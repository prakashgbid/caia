import { describe, expect, it } from 'vitest';
import { probeBinary, runBinary, tail } from '../src/scanners/spawn.js';

describe('tail', () => {
  it('returns full string when within cap', () => {
    expect(tail('hello', 10)).toBe('hello');
  });
  it('truncates with marker when over cap', () => {
    const out = tail('a'.repeat(100), 10);
    expect(out).toMatch(/truncated 90 bytes/);
    expect(out.endsWith('a'.repeat(10))).toBe(true);
  });
});

describe('probeBinary', () => {
  it('resolves a present binary (sh)', async () => {
    const res = await probeBinary('sh');
    expect(res.state).toBe('present');
    expect(res.binaryPath).toBeDefined();
  });
  it('returns absent for a nonsense binary', async () => {
    const res = await probeBinary('definitely-not-a-real-binary-xyz-12345');
    expect(res.state).toBe('absent');
  });
});

describe('runBinary', () => {
  it('captures stdout from an echo', async () => {
    const r = await runBinary('/bin/echo', ['hello'], { cwd: '/tmp' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('hello');
    expect(r.notFound).toBe(false);
  });
  it('returns notFound=true for a missing binary', async () => {
    const r = await runBinary('/definitely/not/here/xyz', [], { cwd: '/tmp' });
    expect(r.notFound).toBe(true);
  });
  it('honours a short timeout', async () => {
    const r = await runBinary('/bin/sleep', ['5'], { cwd: '/tmp', timeoutMs: 100 });
    expect(r.timedOut).toBe(true);
  });
});
