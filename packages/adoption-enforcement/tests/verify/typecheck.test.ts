import { describe, expect, it } from 'vitest';
import { runTypecheck } from '../../src/verify/typecheck.js';
import { runTests } from '../../src/verify/tests.js';
import { runBuild } from '../../src/verify/build.js';
import { runGauntlet } from '../../src/verify/gauntlet.js';

describe('verify/typecheck', () => {
  it('returns skipped when no packages provided', async () => {
    const result = await runTypecheck({ cwd: process.cwd(), targetPackages: [] });
    expect(result.id).toBe('V1');
    expect(result.label).toBe('typecheck');
    expect(result.status).toBe('skipped');
    expect(result.exitCode).toBe(0);
  });

  it('builds the expected command for a single target package', async () => {
    // We pin timeout to 1ms so the spawn times out fast — we only care about
    // the command string, not the actual pnpm exit.
    const result = await runTypecheck({
      cwd: '/nonexistent-dir-for-fast-fail',
      targetPackages: ['@chiefaia/foo'],
      timeoutMs: 1,
    });
    expect(result.command).toContain('--filter @chiefaia/foo');
    expect(result.command).toContain('typecheck');
    expect(['fail', 'timeout']).toContain(result.status);
  });

  it('deduplicates target/consumer overlap', async () => {
    const result = await runTypecheck({
      cwd: '/nonexistent-dir-for-fast-fail',
      targetPackages: ['@chiefaia/foo'],
      consumerPackages: ['@chiefaia/foo', '@chiefaia/bar'],
      timeoutMs: 1,
    });
    const filterMatches = (result.command.match(/--filter @chiefaia\/foo/g) ?? []).length;
    expect(filterMatches).toBe(1);
    expect(result.command).toContain('--filter @chiefaia/bar');
  });
});

describe('verify/tests', () => {
  it('returns skipped when no consumer or target packages', async () => {
    const result = await runTests({ cwd: process.cwd(), targetPackages: [] });
    expect(result.id).toBe('V2');
    expect(result.status).toBe('skipped');
  });

  it('emits the test command for consumer packages', async () => {
    const result = await runTests({
      cwd: '/nonexistent-dir-for-fast-fail',
      targetPackages: [],
      consumerPackages: ['@chiefaia/quux'],
      timeoutMs: 1,
    });
    expect(result.command).toContain('--filter @chiefaia/quux');
    expect(result.command).toContain('test');
  });
});

describe('verify/build', () => {
  it('falls back to repo-wide build when no targets', async () => {
    const result = await runBuild({
      cwd: '/nonexistent-dir-for-fast-fail',
      targetPackages: [],
      timeoutMs: 1,
    });
    expect(result.command).toContain('-w');
    expect(result.command).toContain('build');
  });

  it('uses --filter <pkg>... for targets', async () => {
    const result = await runBuild({
      cwd: '/nonexistent-dir-for-fast-fail',
      targetPackages: ['@chiefaia/foo'],
      timeoutMs: 1,
    });
    expect(result.command).toContain('--filter @chiefaia/foo...');
  });
});

describe('verify/gauntlet', () => {
  it('returns pass=false when no checks could run', async () => {
    const result = await runGauntlet({
      cwd: '/nonexistent-dir-for-fast-fail',
      targetPackages: [],
      wallClockMs: 100,
      shortCircuit: false,
    });
    // V1 + V2 skip (no packages); V3 hits repo-wide build which fast-fails.
    expect(result.checks.length).toBe(3);
    expect(result.pass).toBe(false);
  });

  it('short-circuits subsequent checks after a failure', async () => {
    const result = await runGauntlet({
      cwd: '/nonexistent-dir-for-fast-fail',
      targetPackages: ['@chiefaia/foo'],
      consumerPackages: ['@chiefaia/bar'],
      wallClockMs: 500,
      shortCircuit: true,
    });
    expect(result.checks[0]?.id).toBe('V1');
    // V1 fails => V2 and V3 should be 'skipped'
    const v2 = result.checks.find((c) => c.id === 'V2');
    const v3 = result.checks.find((c) => c.id === 'V3');
    expect(v2?.status).toBe('skipped');
    expect(v3?.status).toBe('skipped');
    expect(result.pass).toBe(false);
  });
});
