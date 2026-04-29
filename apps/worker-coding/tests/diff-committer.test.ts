/**
 * DiffCommitter + parseGhPrCreateOutput — CODING-005 unit tests.
 *
 * Verifies: commit no-op on clean tree, commit happy path, openPr push +
 * gh invocation + URL parsing, conventional-commit message format,
 * derived PR title + body include AC + test cases.
 *
 * 13 cases.
 */

import { DiffCommitter, parseGhPrCreateOutput } from '../src/diff-committer';
import type { Bundle } from '../src/bundle-reader';
import type { Worktree } from '../src/worktree-manager';

function makeBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    story: {
      id: 's_health',
      title: 'Add /health endpoint',
      description: '',
      status: 'pending',
      rootPromptId: null,
      parentEntityId: null,
      parentEntityType: null,
      bucketId: 'bkt_dashboard',
      templateVersion: 'v1',
      templateValidationStatus: 'pending',
      templateValidationErrors: null,
      enrichedAt: null,
      updatedAt: null,
    },
    ticket: {
      lifecycle: 'new',
      acceptanceCriteria: ['returns 200', 'returns { ok: true }'],
      claims: { files: ['apps/dashboard/app/health/route.ts'], schemas: [], apiRoutes: ['/health'], domains: [] },
      testCases: [
        { id: 'TC-001', title: 'happy path 200', category: 'happy' },
        { id: 'TC-002', title: 'no auth required', category: 'happy' },
      ],
    },
    ticketParseError: null,
    prompt: null,
    requirement: null,
    bucket: { id: 'bkt_dashboard', kind: 'parallel', domainSlug: null, sequenceIndex: null, status: 'open' },
    labels: [],
    dependencies: { upstream: [], downstream: [] },
    inputDependencies: [],
    ...overrides,
  };
}

function makeWorktree(): Worktree {
  return {
    storyId: 's_health',
    path: '/tmp/wt/s_health',
    branch: 'feat/s_health-add-health',
    integrationBranch: 'main',
    createdAt: 1234,
  };
}

describe('parseGhPrCreateOutput', () => {
  it('parses URL and number from gh stdout', () => {
    const out = 'https://github.com/x/y/pull/482\n';
    expect(parseGhPrCreateOutput(out)).toEqual({
      prUrl: 'https://github.com/x/y/pull/482',
      prNumber: 482,
    });
  });

  it('handles extra log lines around the URL', () => {
    const out = 'Creating draft pull request\nhttps://github.com/x/y/pull/9\nDone\n';
    expect(parseGhPrCreateOutput(out).prNumber).toBe(9);
  });

  it('throws when no URL present', () => {
    expect(() => parseGhPrCreateOutput('failed\n')).toThrow(/did not return a URL/);
  });

  it('throws when URL missing the /pull/N segment', () => {
    expect(() => parseGhPrCreateOutput('https://github.com/x/y/issues/3\n')).toThrow(/could not parse/);
  });
});

describe('DiffCommitter.commit', () => {
  it('no-op on clean tree (returns current HEAD as sha)', () => {
    const calls: string[][] = [];
    const exec = ((bin: string, args: string[]) => {
      calls.push([bin, ...args]);
      if (args[0] === 'status') return { status: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: 'deadbeef\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    }) as never;
    const c = new DiffCommitter({ execImpl: exec });
    const r = c.commit({ worktree: makeWorktree(), bundle: makeBundle() });
    expect(r.sha).toBe('deadbeef');
    expect(r.message).toBe('(no changes)');
    // No git add or git commit in calls.
    expect(calls.find((c) => c[1] === 'add')).toBeUndefined();
    expect(calls.find((c) => c[1] === 'commit')).toBeUndefined();
  });

  it('happy path: status -> add -> commit -> rev-parse', () => {
    const calls: string[][] = [];
    const exec = ((bin: string, args: string[]) => {
      calls.push([bin, ...args]);
      if (args[0] === 'status') return { status: 0, stdout: ' M src/x.ts\n', stderr: '' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: 'cafef00d\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    }) as never;
    const c = new DiffCommitter({ execImpl: exec });
    const r = c.commit({ worktree: makeWorktree(), bundle: makeBundle() });
    expect(r.sha).toBe('cafef00d');
    expect(calls.map((c) => c[1])).toEqual(['status', 'add', 'commit', 'rev-parse']);
    // Commit message is the conventional-commit format
    const commitCall = calls.find((c) => c[1] === 'commit');
    const msg = commitCall![commitCall!.indexOf('-m') + 1];
    expect(msg).toContain('feat(dashboard): add /health endpoint');
    expect(msg).toContain('Story: s_health');
  });

  it('respects subjectOverride', () => {
    const calls: string[][] = [];
    const exec = ((bin: string, args: string[]) => {
      calls.push([bin, ...args]);
      if (args[0] === 'status') return { status: 0, stdout: 'M\n', stderr: '' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: 'sha\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    }) as never;
    const c = new DiffCommitter({ execImpl: exec });
    c.commit({
      worktree: makeWorktree(),
      bundle: makeBundle(),
      subjectOverride: 'custom: my own subject',
    });
    const commitCall = calls.find((c) => c[1] === 'commit');
    const msg = commitCall![commitCall!.indexOf('-m') + 1];
    expect(msg).toBe('custom: my own subject');
  });

  it('throws with stderr when git fails', () => {
    const exec = (() => ({ status: 1, stdout: '', stderr: 'fatal: oops' })) as never;
    const c = new DiffCommitter({ execImpl: exec });
    expect(() => c.commit({ worktree: makeWorktree(), bundle: makeBundle() })).toThrow(/oops/);
  });
});

describe('DiffCommitter.openPr', () => {
  it('pushes then runs gh pr create with correct flags', () => {
    const calls: string[][] = [];
    const exec = ((bin: string, args: string[]) => {
      calls.push([bin, ...args]);
      if (bin === 'gh') {
        return { status: 0, stdout: 'https://github.com/p/r/pull/42\n', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    }) as never;
    const c = new DiffCommitter({ execImpl: exec });
    const r = c.openPr({ worktree: makeWorktree(), bundle: makeBundle() });
    expect(r).toEqual({ prUrl: 'https://github.com/p/r/pull/42', prNumber: 42 });
    expect(calls[0]![0]).toBe('git');
    expect(calls[0]!.slice(1, 5)).toEqual(['push', '-u', 'origin', 'feat/s_health-add-health']);
    expect(calls[1]![0]).toBe('gh');
    const ghArgs = calls[1]!;
    expect(ghArgs[1]).toBe('pr');
    expect(ghArgs[2]).toBe('create');
    expect(ghArgs).toContain('--base');
    expect(ghArgs).toContain('main');
    expect(ghArgs).toContain('--head');
    expect(ghArgs).toContain('feat/s_health-add-health');
  });

  it('skips push when pushFirst:false', () => {
    const calls: string[][] = [];
    const exec = ((bin: string, args: string[]) => {
      calls.push([bin, ...args]);
      if (bin === 'gh') {
        return { status: 0, stdout: 'https://github.com/p/r/pull/1\n', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    }) as never;
    const c = new DiffCommitter({ execImpl: exec });
    c.openPr({ worktree: makeWorktree(), bundle: makeBundle(), pushFirst: false });
    expect(calls.find((c) => c[1] === 'push')).toBeUndefined();
  });
});

describe('DiffCommitter — message + body builders', () => {
  it('derivePrTitle is the conventional commit subject', () => {
    const c = new DiffCommitter();
    expect(c.derivePrTitle(makeBundle(), makeWorktree())).toBe('feat(dashboard): add /health endpoint');
  });

  it('buildPrBody embeds AC, test cases, claims', () => {
    const c = new DiffCommitter();
    const body = c.buildPrBody(makeBundle(), makeWorktree());
    expect(body).toContain('Add /health endpoint');
    expect(body).toContain('returns 200');
    expect(body).toContain('TC-001');
    expect(body).toContain('TC-002');
    expect(body).toContain('apps/dashboard/app/health/route.ts');
    expect(body).toContain('feat/s_health-add-health');
    expect(body).toContain('main');
  });

  it('uses fix/ for lifecycle=bug', () => {
    const c = new DiffCommitter();
    const b = makeBundle();
    (b.ticket as Record<string, unknown>).lifecycle = 'bug';
    expect(c.derivePrTitle(b, makeWorktree())).toBe('fix(dashboard): add /health endpoint');
  });

  it('uses chore/ for lifecycle=docs', () => {
    const c = new DiffCommitter();
    const b = makeBundle();
    (b.ticket as Record<string, unknown>).lifecycle = 'docs';
    expect(c.derivePrTitle(b, makeWorktree())).toBe('chore(dashboard): add /health endpoint');
  });
});
