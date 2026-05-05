import { describe, it, expect, vi } from 'vitest';
import { makeGitOps, shellEscape } from '../src/git-ops';
import type { ShellRunner, ShellResult } from '../src/shell-runner';

const okResult = (stdout: string): ShellResult => ({ code: 0, stdout, stderr: '', durationMs: 0 });
const failResult = (code: number, stderr = 'boom'): ShellResult => ({ code, stdout: '', stderr, durationMs: 0 });

describe('shellEscape', () => {
  it('passes through clean tokens', () => {
    expect(shellEscape('develop')).toBe('develop');
    expect(shellEscape('abc123def4567')).toBe('abc123def4567');
    expect(shellEscape('/Users/MAC/project')).toBe('/Users/MAC/project');
  });

  it('quotes tokens with shell metacharacters', () => {
    expect(shellEscape('a b')).toBe("'a b'");
    expect(shellEscape("she's here")).toBe("'she'\\''s here'");
    expect(shellEscape('a;b')).toBe("'a;b'");
  });
});

describe('makeGitOps', () => {
  it('fetch issues git fetch origin <branch>', async () => {
    const fakeShell: ShellRunner = vi.fn(async () => okResult(''));
    const gitOps = makeGitOps(fakeShell);
    await gitOps.fetch('/repo', 'develop');
    expect(fakeShell).toHaveBeenCalledOnce();
    const [cmd, opts] = (fakeShell as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(cmd).toContain('git fetch origin develop');
    expect(opts.cwd).toBe('/repo');
  });

  it('resolveBranchSha returns the trimmed SHA', async () => {
    const sha = 'abcdef1234567890abcdef1234567890abcdef12';
    const fakeShell: ShellRunner = vi.fn(async () => okResult(`${sha}\n`));
    const gitOps = makeGitOps(fakeShell);
    const result = await gitOps.resolveBranchSha('/repo', 'develop');
    expect(result).toBe(sha);
  });

  it('resolveBranchSha rejects malformed output', async () => {
    const fakeShell: ShellRunner = vi.fn(async () => okResult('not-a-sha-at-all\n'));
    const gitOps = makeGitOps(fakeShell);
    await expect(gitOps.resolveBranchSha('/repo', 'develop')).rejects.toThrow(/Invalid SHA/);
  });

  it('worktreeAdd issues correct command', async () => {
    const fakeShell: ShellRunner = vi.fn(async () => okResult(''));
    const gitOps = makeGitOps(fakeShell);
    await gitOps.worktreeAdd('/repo', '/tmp/wt-x', 'abc1234');
    const [cmd] = (fakeShell as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(cmd).toContain('git worktree add --detach --force');
    expect(cmd).toContain('/tmp/wt-x');
    expect(cmd).toContain('abc1234');
  });

  it('worktreeRemove issues correct command', async () => {
    const fakeShell: ShellRunner = vi.fn(async () => okResult(''));
    const gitOps = makeGitOps(fakeShell);
    await gitOps.worktreeRemove('/repo', '/tmp/wt-x');
    const [cmd] = (fakeShell as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(cmd).toContain('git worktree remove --force');
  });

  it('throws when shell command fails', async () => {
    const fakeShell: ShellRunner = vi.fn(async () => failResult(128, 'fatal: not a git repository'));
    const gitOps = makeGitOps(fakeShell);
    await expect(gitOps.fetch('/not-a-repo', 'develop')).rejects.toThrow(/exit 128/);
  });
});
