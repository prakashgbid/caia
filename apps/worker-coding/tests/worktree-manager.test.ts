/**
 * WorktreeManager — CODING-002 unit tests.
 *
 * Uses a stubbed exec + a temp-dir fs so tests don't need a real git
 * worktree. The integration test that exercises real git is in CODING-009.
 *
 * 12 cases.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { detectIntegrationBranch, WorktreeManager } from '../src/worktree-manager';

describe('detectIntegrationBranch', () => {
  it('returns main for caia', () => {
    expect(detectIntegrationBranch('caia')).toBe('main');
  });

  it('returns master for pokerzeno', () => {
    expect(detectIntegrationBranch('pokerzeno')).toBe('master');
  });

  it('returns master for roulettecommunity', () => {
    expect(detectIntegrationBranch('roulettecommunity')).toBe('master');
  });

  it('falls back to develop for unknown repos', () => {
    expect(detectIntegrationBranch('mystery-repo')).toBe('develop');
  });
});

describe('WorktreeManager.branchName', () => {
  function makeManager() {
    return new WorktreeManager({
      execImpl: jest.fn() as never,
      fsImpl: { existsSync: () => false, mkdirSync: () => undefined } as never,
    });
  }

  it('uses feat/ prefix for lifecycle=new', () => {
    const m = makeManager();
    expect(m.branchName({ storyId: 'story-abc', repoPath: '/x', lifecycle: 'new' })).toBe('feat/story-abc-story-abc');
  });

  it('uses feat/ prefix for lifecycle=enhance (default)', () => {
    const m = makeManager();
    expect(m.branchName({ storyId: 'story-xyz', repoPath: '/x' })).toBe('feat/story-xyz-story-xyz');
  });

  it('uses fix/ prefix for lifecycle=bug', () => {
    const m = makeManager();
    expect(m.branchName({ storyId: 'story-bug', repoPath: '/x', lifecycle: 'bug' })).toBe('fix/story-bug-story-bug');
  });

  it('uses chore/ prefix for lifecycle=chore or docs', () => {
    const m = makeManager();
    expect(m.branchName({ storyId: 's_chore', repoPath: '/x', lifecycle: 'chore' })).toBe('chore/s_chore-s-chore');
    expect(m.branchName({ storyId: 's_docs', repoPath: '/x', lifecycle: 'docs' })).toBe('chore/s_docs-s-docs');
  });

  it('honours an explicit slug', () => {
    const m = makeManager();
    expect(
      m.branchName({ storyId: 's1', repoPath: '/x', lifecycle: 'new', slug: 'add-leaderboard' }),
    ).toBe('feat/s1-add-leaderboard');
  });

  it('truncates very long slugs to 40 chars', () => {
    const m = makeManager();
    const long = 'a'.repeat(100);
    const branch = m.branchName({ storyId: 's', repoPath: '/x', slug: long });
    // prefix + 's' + '-' + 40 chars
    expect(branch).toBe('feat/s-' + 'a'.repeat(40));
  });
});

describe('WorktreeManager.claim — happy path', () => {
  it('mkdir + git fetch + git worktree add, returns Worktree record', () => {
    const calls: Array<{ bin: string; args: string[]; cwd?: string }> = [];
    const exec = ((bin: string, args: string[], opts: { cwd?: string }) => {
      calls.push({ bin, args, cwd: opts.cwd });
      return { status: 0, stdout: '', stderr: '' };
    }) as never;
    const made: string[] = [];
    const fsImpl = {
      existsSync: () => false,
      mkdirSync: (p: string) => { made.push(p); },
    } as never;
    const m = new WorktreeManager({
      baseDir: '/tmp/caia-test-worktrees',
      execImpl: exec,
      fsImpl,
      now: () => 12345,
    });
    const wt = m.claim({
      storyId: 'story-abc',
      repoPath: '/Users/x/code/caia',
      lifecycle: 'new',
      slug: 'add-foo',
    });
    expect(made).toContain('/tmp/caia-test-worktrees');
    expect(calls.length).toBe(2);
    expect(calls[0]!.args).toEqual(['fetch', 'origin', 'main']);
    expect(calls[1]!.args).toEqual([
      'worktree', 'add', '-b', 'feat/story-abc-add-foo',
      '/tmp/caia-test-worktrees/story-abc',
      'origin/main',
    ]);
    expect(wt.path).toBe('/tmp/caia-test-worktrees/story-abc');
    expect(wt.branch).toBe('feat/story-abc-add-foo');
    expect(wt.integrationBranch).toBe('main');
    expect(wt.createdAt).toBe(12345);
  });
});

describe('WorktreeManager.claim — idempotency', () => {
  it('reuses existing worktree if already present', () => {
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const exec = ((_bin: string, args: string[], opts: { cwd?: string }) => {
      calls.push({ args, cwd: opts.cwd });
      // For rev-parse --abbrev-ref HEAD, return a branch name
      if (args[0] === 'rev-parse') {
        return { status: 0, stdout: 'feat/existing-branch\n', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    }) as never;
    const fsImpl = {
      existsSync: () => true,           // worktree dir already exists
      mkdirSync: () => undefined,
    } as never;
    const m = new WorktreeManager({
      baseDir: '/tmp/wt',
      execImpl: exec,
      fsImpl,
      now: () => 9999,
    });
    const wt = m.claim({ storyId: 'story-abc', repoPath: '/repo' });
    // Only the rev-parse should run; no fetch + worktree add.
    expect(calls.map((c) => c.args[0])).toEqual(['rev-parse']);
    expect(wt.branch).toBe('feat/existing-branch');
  });
});

describe('WorktreeManager.claim — error propagation', () => {
  it('throws with stderr when git fails', () => {
    const exec = (() => ({ status: 128, stdout: '', stderr: 'fatal: not a repo' })) as never;
    const fsImpl = { existsSync: () => false, mkdirSync: () => undefined } as never;
    const m = new WorktreeManager({ baseDir: '/tmp/wt', execImpl: exec, fsImpl });
    expect(() => m.claim({ storyId: 's1', repoPath: '/repo' })).toThrow(/not a repo/);
  });
});

describe('WorktreeManager.release', () => {
  it('runs git worktree remove --force', () => {
    const calls: string[][] = [];
    const exec = ((_bin: string, args: string[]) => {
      calls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }) as never;
    const fsImpl = { existsSync: () => true, mkdirSync: () => undefined } as never;
    const m = new WorktreeManager({ baseDir: '/tmp/wt', execImpl: exec, fsImpl });
    m.release('s1', '/repo');
    expect(calls).toEqual([['worktree', 'remove', '--force', '/tmp/wt/s1']]);
  });

  it('skips when keep:true', () => {
    const calls: string[][] = [];
    const exec = ((_bin: string, args: string[]) => {
      calls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }) as never;
    const fsImpl = { existsSync: () => true, mkdirSync: () => undefined } as never;
    const m = new WorktreeManager({ baseDir: '/tmp/wt', execImpl: exec, fsImpl });
    m.release('s1', '/repo', { keep: true });
    expect(calls).toEqual([]);
  });

  it('no-op when worktree does not exist', () => {
    const calls: string[][] = [];
    const exec = ((_bin: string, args: string[]) => {
      calls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }) as never;
    const fsImpl = { existsSync: () => false, mkdirSync: () => undefined } as never;
    const m = new WorktreeManager({ baseDir: '/tmp/wt', execImpl: exec, fsImpl });
    m.release('s1', '/repo');
    expect(calls).toEqual([]);
  });
});

describe('WorktreeManager — paths', () => {
  it('pathFor concatenates baseDir and storyId', () => {
    const m = new WorktreeManager({ baseDir: '/tmp/x' });
    expect(m.pathFor('story-1')).toBe('/tmp/x/story-1');
  });

  it('default baseDir is under ~/.caia/worktrees', () => {
    const m = new WorktreeManager();
    expect(m.pathFor('s')).toBe(path.join(os.homedir(), '.caia', 'worktrees', 's'));
  });
});
