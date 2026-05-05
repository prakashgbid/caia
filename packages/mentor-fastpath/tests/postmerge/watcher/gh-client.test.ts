/**
 * Unit tests for the gh-client wrapper.
 *
 * No real `gh` CLI calls — every test injects a mock RunGh that returns
 * canned JSON. We verify:
 *   - The right CLI flags are constructed.
 *   - JSON parsing works for the expected `gh --json` output shapes.
 *   - Defensive parsing tolerates missing optional fields.
 *   - Error paths (non-array JSON, parse failure) throw with helpful
 *     messages.
 */

import { describe, expect, it } from 'vitest';

import {
  getFailedJobNames,
  listFailedRuns,
  listMergedPrs,
  type RunGh
} from '../../../src/postmerge/watcher/gh-client.js';

function makeMock(): { run: RunGh; calls: string[][]; queue: string[] } {
  const calls: string[][] = [];
  const queue: string[] = [];
  const run: RunGh = (args) => {
    calls.push([...args]);
    if (queue.length === 0) return '';
    return queue.shift()!;
  };
  return { run, calls, queue };
}

describe('listMergedPrs', () => {
  it('constructs the right gh args', () => {
    const m = makeMock();
    m.queue.push('[]');
    listMergedPrs({ runGh: m.run }, '2026-05-04T00:00:00Z');
    expect(m.calls.length).toBe(1);
    const args = m.calls[0]!;
    expect(args).toContain('pr');
    expect(args).toContain('list');
    expect(args).toContain('--state');
    expect(args).toContain('merged');
    expect(args.join(' ')).toContain('merged:>=2026-05-04T00:00:00Z');
    expect(args.join(' ')).toContain('base:develop');
    expect(args.join(' ')).toContain('base:main');
    expect(args.join(' ')).toContain('--json');
  });

  it('parses well-formed gh JSON output', () => {
    const m = makeMock();
    m.queue.push(
      JSON.stringify([
        {
          number: 327,
          title: 'feat(curator-phase1-001): scan loop',
          mergeCommit: { oid: 'ea23ab0' },
          baseRefName: 'develop',
          headRefName: 'feat/curator-phase1-001-scan-loop',
          mergedAt: '2026-05-05T05:23:00Z',
          author: { login: 'campaign-coordinator' }
        }
      ])
    );
    const prs = listMergedPrs({ runGh: m.run }, '2026-05-04T00:00:00Z');
    expect(prs).toHaveLength(1);
    expect(prs[0]).toEqual({
      number: 327,
      title: 'feat(curator-phase1-001): scan loop',
      mergeCommit: 'ea23ab0',
      baseRefName: 'develop',
      headRefName: 'feat/curator-phase1-001-scan-loop',
      mergedAt: '2026-05-05T05:23:00Z',
      author: 'campaign-coordinator'
    });
  });

  it('returns [] when gh returns empty string', () => {
    const m = makeMock();
    m.queue.push('');
    const prs = listMergedPrs({ runGh: m.run }, '2026-05-04T00:00:00Z');
    expect(prs).toEqual([]);
  });

  it('tolerates missing optional fields (mergeCommit, author)', () => {
    const m = makeMock();
    m.queue.push(
      JSON.stringify([
        {
          number: 100,
          title: 'partial PR',
          mergeCommit: null,
          baseRefName: 'develop',
          headRefName: '',
          mergedAt: '2026-05-04T00:00:00Z'
        }
      ])
    );
    const prs = listMergedPrs({ runGh: m.run }, '2026-05-04T00:00:00Z');
    expect(prs[0]?.mergeCommit).toBe('');
    expect(prs[0]?.author).toBe('unknown');
  });

  it('throws on non-JSON output', () => {
    const m = makeMock();
    m.queue.push('not json');
    expect(() => listMergedPrs({ runGh: m.run }, '2026-05-04T00:00:00Z')).toThrow(
      /unparseable/
    );
  });

  it('throws when JSON is not an array', () => {
    const m = makeMock();
    m.queue.push('{}');
    expect(() => listMergedPrs({ runGh: m.run }, '2026-05-04T00:00:00Z')).toThrow(
      /expected array/
    );
  });

  it('passes --repo flag when provided', () => {
    const m = makeMock();
    m.queue.push('[]');
    listMergedPrs(
      { runGh: m.run, repo: 'owner/repo' },
      '2026-05-04T00:00:00Z'
    );
    expect(m.calls[0]).toContain('--repo');
    expect(m.calls[0]).toContain('owner/repo');
  });
});

describe('listFailedRuns', () => {
  it('makes one call per branch', () => {
    const m = makeMock();
    m.queue.push('[]', '[]');
    listFailedRuns({ runGh: m.run }, '2026-05-04T00:00:00Z', ['develop', 'main']);
    expect(m.calls).toHaveLength(2);
    expect(m.calls[0]).toContain('develop');
    expect(m.calls[1]).toContain('main');
  });

  it('parses run JSON', () => {
    const m = makeMock();
    m.queue.push(
      JSON.stringify([
        {
          databaseId: 12345,
          name: 'Build · Test · Lint · Typecheck',
          headBranch: 'develop',
          headSha: 'ea23ab0',
          updatedAt: '2026-05-05T05:30:00Z',
          conclusion: 'failure'
        }
      ]),
      '[]'
    );
    const runs = listFailedRuns({ runGh: m.run }, '2026-05-04T00:00:00Z');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      databaseId: 12345,
      workflowName: 'Build · Test · Lint · Typecheck',
      headBranch: 'develop',
      headSha: 'ea23ab0',
      conclusion: 'failure'
    });
  });

  it('filters out runs older than the since cutoff', () => {
    const m = makeMock();
    m.queue.push(
      JSON.stringify([
        {
          databaseId: 1,
          name: 'old',
          headBranch: 'develop',
          headSha: 'aaa',
          updatedAt: '2026-05-01T00:00:00Z',
          conclusion: 'failure'
        },
        {
          databaseId: 2,
          name: 'new',
          headBranch: 'develop',
          headSha: 'bbb',
          updatedAt: '2026-05-05T05:00:00Z',
          conclusion: 'failure'
        }
      ]),
      '[]'
    );
    const runs = listFailedRuns({ runGh: m.run }, '2026-05-04T00:00:00Z', [
      'develop'
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.databaseId).toBe(2);
  });

  it('handles empty per-branch results without throwing', () => {
    const m = makeMock();
    m.queue.push('', '');
    const runs = listFailedRuns({ runGh: m.run }, '2026-05-04T00:00:00Z');
    expect(runs).toEqual([]);
  });
});

describe('getFailedJobNames', () => {
  it('returns names of jobs with conclusion=failure', () => {
    const m = makeMock();
    m.queue.push(
      JSON.stringify({
        jobs: [
          { name: 'lint', conclusion: 'failure' },
          { name: 'typecheck', conclusion: 'success' },
          { name: 'integration-tests', conclusion: 'failure' }
        ]
      })
    );
    const names = getFailedJobNames({ runGh: m.run }, 12345);
    expect(names).toEqual(['lint', 'integration-tests']);
  });

  it('returns [] when run has no failed jobs', () => {
    const m = makeMock();
    m.queue.push(
      JSON.stringify({
        jobs: [{ name: 'all-good', conclusion: 'success' }]
      })
    );
    expect(getFailedJobNames({ runGh: m.run }, 1)).toEqual([]);
  });

  it('returns [] when gh returns empty string', () => {
    const m = makeMock();
    m.queue.push('');
    expect(getFailedJobNames({ runGh: m.run }, 1)).toEqual([]);
  });

  it('returns [] when JSON has no jobs key', () => {
    const m = makeMock();
    m.queue.push('{}');
    expect(getFailedJobNames({ runGh: m.run }, 1)).toEqual([]);
  });

  it('handles missing job names', () => {
    const m = makeMock();
    m.queue.push(
      JSON.stringify({
        jobs: [
          { name: 'real', conclusion: 'failure' },
          { conclusion: 'failure' } // no name
        ]
      })
    );
    const names = getFailedJobNames({ runGh: m.run }, 1);
    // Name-less jobs are filtered out (empty name).
    expect(names).toEqual(['real']);
  });
});
