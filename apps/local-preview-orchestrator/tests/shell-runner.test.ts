import { describe, it, expect } from 'vitest';
import { defaultShellRunner, runOrThrow } from '../src/shell-runner';

describe('shell-runner', () => {
  it('runs a simple bash command and returns code 0', async () => {
    const result = await defaultShellRunner('echo hello', { cwd: '/tmp', timeoutMs: 5_000 });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.stderr).toBe('');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures non-zero exit code without throwing', async () => {
    const result = await defaultShellRunner('exit 42', { cwd: '/tmp', timeoutMs: 5_000 });
    expect(result.code).toBe(42);
  });

  it('captures stderr', async () => {
    const result = await defaultShellRunner('echo oops 1>&2', { cwd: '/tmp', timeoutMs: 5_000 });
    expect(result.code).toBe(0);
    expect(result.stderr.trim()).toBe('oops');
  });

  it('respects cwd', async () => {
    // /tmp is a symlink to /private/tmp on macOS — pwd reports the resolved path.
    // Use a freshly-created mkdtempSync directory so we get a stable absolute path
    // without symlink ambiguity.
    const { mkdtempSync, rmSync, realpathSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'shell-cwd-test-')));
    try {
      const result = await defaultShellRunner('pwd', { cwd: dir, timeoutMs: 5_000 });
      expect(result.stdout.trim()).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces timeout (SIGKILL on overrun)', async () => {
    const result = await defaultShellRunner('sleep 5', { cwd: '/tmp', timeoutMs: 100 });
    expect(result.code).toBe(124);
    expect(result.stderr).toContain('killed: timeout');
  });

  it('runOrThrow returns on success', async () => {
    const result = await runOrThrow(defaultShellRunner, 'echo ok', { cwd: '/tmp', timeoutMs: 5_000 });
    expect(result.stdout.trim()).toBe('ok');
  });

  it('runOrThrow throws on non-zero exit', async () => {
    await expect(
      runOrThrow(defaultShellRunner, 'false', { cwd: '/tmp', timeoutMs: 5_000 })
    ).rejects.toThrow(/exit 1/);
  });
});
