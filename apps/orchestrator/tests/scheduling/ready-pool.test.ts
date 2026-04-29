/**
 * BUCKET-009 — ready-pool unit tests.
 */

import {
  recompute,
  snapshotStory,
  type StorySnapshot,
} from '../../src/scheduling/ready-pool';

const empty = { files: [], schemas: [], apiRoutes: [], domains: [] };

function story(
  id: string,
  status: string,
  opts: Partial<Omit<StorySnapshot, 'id' | 'status'>> = {},
): StorySnapshot {
  return {
    id,
    status,
    bucketId: opts.bucketId ?? null,
    blockedBy: opts.blockedBy ?? [],
    risk: opts.risk ?? 'medium',
    priorityBucket: opts.priorityBucket ?? 'P2',
    claims: opts.claims ?? empty,
  };
}

describe('snapshotStory', () => {
  it('parses raw row into the snapshot shape', () => {
    const snap = snapshotStory({
      id: 's1',
      status: 'pending',
      bucketId: 'bkt_a',
      blockedByJson: '["s2","s3"]',
      risk: 'high',
      priorityBucket: 'P1',
      claimsJson: JSON.stringify({ ...empty, files: ['x.ts'] }),
    });
    expect(snap.id).toBe('s1');
    expect(snap.status).toBe('pending');
    expect(snap.bucketId).toBe('bkt_a');
    expect(snap.blockedBy).toEqual(['s2', 's3']);
    expect(snap.risk).toBe('high');
    expect(snap.priorityBucket).toBe('P1');
    expect(snap.claims.files).toEqual(['x.ts']);
  });

  it('handles null/missing fields gracefully', () => {
    const snap = snapshotStory({ id: 's1', status: 'pending' });
    expect(snap.bucketId).toBeNull();
    expect(snap.blockedBy).toEqual([]);
    expect(snap.risk).toBeNull();
    expect(snap.priorityBucket).toBeNull();
    expect(snap.claims).toEqual(empty);
  });
});

describe('recompute — basic gates', () => {
  it('empty input -> empty output', () => {
    const r = recompute([]);
    expect(r.ready).toEqual([]);
    expect(r.deferred).toEqual([]);
    expect(r.inFlight).toEqual([]);
  });

  it('a pending story with no blockers is ready', () => {
    const r = recompute([story('s1', 'pending')]);
    expect(r.ready.map((e) => e.storyId)).toEqual(['s1']);
    expect(r.deferred).toEqual([]);
  });

  it('a blocked-by gate defers the candidate', () => {
    const r = recompute([
      story('blocker', 'pending'),
      story('s1', 'pending', { blockedBy: ['blocker'] }),
    ]);
    expect(r.ready.map((e) => e.storyId)).toEqual(['blocker']);
    expect(r.deferred).toHaveLength(1);
    expect(r.deferred[0]!.reason).toBe('blocked-by');
    expect(r.deferred[0]!.blockerIds).toEqual(['blocker']);
  });

  it('blocked-by passes once blocker is verified', () => {
    const r = recompute([
      story('blocker', 'verified'),
      story('s1', 'pending', { blockedBy: ['blocker'] }),
    ]);
    expect(r.ready.map((e) => e.storyId)).toContain('s1');
  });

  it('deferred when blocker is not in the snapshot at all', () => {
    const r = recompute([story('s1', 'pending', { blockedBy: ['ghost'] })]);
    expect(r.deferred[0]!.reason).toBe('blocked-by');
  });
});

describe('recompute — fine-grained-claims gate', () => {
  it('high risk + empty file claims -> deferred via claims-gate', () => {
    const r = recompute([story('s1', 'pending', { risk: 'high' })]);
    expect(r.deferred[0]!.reason).toBe('claims-gate');
  });

  it('high risk + file claims -> ready', () => {
    const r = recompute([
      story('s1', 'pending', { risk: 'high', claims: { ...empty, files: ['x.ts'] } }),
    ]);
    expect(r.ready.map((e) => e.storyId)).toEqual(['s1']);
  });

  it('critical risk requires file claims too', () => {
    const r = recompute([story('s1', 'pending', { risk: 'critical' })]);
    expect(r.deferred[0]!.reason).toBe('claims-gate');
  });

  it('low risk -> no claims requirement', () => {
    const r = recompute([story('s1', 'pending', { risk: 'low' })]);
    expect(r.ready.map((e) => e.storyId)).toEqual(['s1']);
  });
});

describe('recompute — claims-conflict gate', () => {
  it('candidate clashes with in-flight on file -> deferred', () => {
    const r = recompute([
      story('a', 'in_progress', { claims: { ...empty, files: ['shared.ts'] } }),
      story('b', 'pending', { claims: { ...empty, files: ['shared.ts'] } }),
    ]);
    expect(r.ready.map((e) => e.storyId)).toEqual([]);
    expect(r.deferred[0]!.reason).toBe('claims-conflict');
    expect(r.deferred[0]!.conflictingStoryId).toBe('a');
    expect(r.deferred[0]!.conflictingClaim).toEqual({ kind: 'file', value: 'shared.ts' });
  });

  it('different files do NOT conflict', () => {
    const r = recompute([
      story('a', 'in_progress', { claims: { ...empty, files: ['a.ts'] } }),
      story('b', 'pending', { claims: { ...empty, files: ['b.ts'] } }),
    ]);
    expect(r.ready.map((e) => e.storyId)).toEqual(['b']);
  });

  it('two pending stories with overlapping claims both READY (only conflict against in-flight)', () => {
    const r = recompute([
      story('a', 'pending', { claims: { ...empty, files: ['shared.ts'] } }),
      story('b', 'pending', { claims: { ...empty, files: ['shared.ts'] } }),
    ]);
    expect(r.ready).toHaveLength(2);
  });
});

describe('recompute — ordering', () => {
  it('orders ready by priorityBucket then story id', () => {
    const r = recompute([
      story('z', 'pending', { priorityBucket: 'P0' }),
      story('a', 'pending', { priorityBucket: 'P0' }),
      story('m', 'pending', { priorityBucket: 'P3' }),
      story('b', 'pending', { priorityBucket: 'P1' }),
    ]);
    expect(r.ready.map((e) => e.storyId)).toEqual(['a', 'z', 'b', 'm']);
  });
});

describe('recompute — partition correctness', () => {
  it('partitions every story into exactly one of {ready, deferred, inFlight, omitted}', () => {
    const stories = [
      story('done', 'verified'),
      story('inflight', 'in_progress'),
      story('ready', 'pending'),
      story('blocked', 'pending', { blockedBy: ['done'] }),
    ];
    const r = recompute(stories);
    expect(r.ready.map((e) => e.storyId)).toEqual(['ready', 'blocked']);
    expect(r.inFlight.map((e) => e.storyId)).toEqual(['inflight']);
    // 'done' is neither ready nor deferred — it's just done.
  });
});
