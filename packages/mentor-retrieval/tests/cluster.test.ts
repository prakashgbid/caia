/**
 * Tests for Mentor Phase-4 PR-1 incident clustering.
 */

import { describe, expect, it } from 'vitest';

import {
  clusterProposals,
  DEFAULT_BURST_WINDOW_MS,
  DEFAULT_SYSTEMIC_THRESHOLD,
  parseProposalSlug,
  stripCollisionSuffix,
  systemicClusters
} from '../src/cluster.js';
import type { IndexedLesson } from '../src/types.js';

function fakeLesson(
  rawSlug: string,
  kind: 'feedback' | 'proposal' = 'proposal'
): IndexedLesson {
  return {
    id: 0,
    sourcePath: `/fake/${rawSlug}.md`,
    kind,
    slug: rawSlug,
    mtimeMs: 0,
    contentSha256: 'x',
    contentSnippet: '',
    embeddingDim: 1,
    embedding: Buffer.alloc(4),
    indexedAtMs: 0
  };
}

describe('stripCollisionSuffix', () => {
  it('strips a single trailing -N digits suffix', () => {
    expect(stripCollisionSuffix('pr-0-regression-after-merge-2')).toBe(
      'pr-0-regression-after-merge'
    );
  });
  it('strips multi-digit suffixes', () => {
    expect(stripCollisionSuffix('pr-0-regression-after-merge-15')).toBe(
      'pr-0-regression-after-merge'
    );
  });
  it('leaves slugs without numeric tails intact', () => {
    expect(stripCollisionSuffix('pr-0-regression-after-merge')).toBe(
      'pr-0-regression-after-merge'
    );
  });
  it('leaves embedded numbers in non-tail positions intact', () => {
    expect(stripCollisionSuffix('pr-12-flake')).toBe('pr-12-flake');
  });
  it('leaves tails containing non-digits intact', () => {
    expect(stripCollisionSuffix('pr-0-merge-v2-final')).toBe('pr-0-merge-v2-final');
  });
  it('handles single-token slugs', () => {
    expect(stripCollisionSuffix('alone')).toBe('alone');
  });
  it('does not collapse a slug to an empty string', () => {
    expect(stripCollisionSuffix('-7')).toBe('-7');
  });
});

describe('parseProposalSlug', () => {
  it('parses canonical Mentor proposal slug', () => {
    const m = parseProposalSlug(
      '20260505-155146-prematurecompletion-pr-0-regression-after-merge'
    );
    expect(m).not.toBeNull();
    expect(m?.classification).toBe('prematurecompletion');
    expect(m?.topicSlug).toBe('pr-0-regression-after-merge');
    // 2026-05-05T15:51:46Z
    expect(m?.timestampMs).toBe(Date.UTC(2026, 4, 5, 15, 51, 46));
  });
  it('strips -N collision suffix', () => {
    const a = parseProposalSlug(
      '20260505-155146-prematurecompletion-pr-0-regression-after-merge'
    );
    const b = parseProposalSlug(
      '20260505-155146-prematurecompletion-pr-0-regression-after-merge-10'
    );
    expect(a?.topicSlug).toBe(b?.topicSlug);
  });
  it('handles unclassified proposals', () => {
    const m = parseProposalSlug(
      '20260505-051149-unclassified-leg-4-stage-6-verify-test'
    );
    expect(m?.classification).toBe('unclassified');
    expect(m?.topicSlug).toBe('leg-4-stage-6-verify-test');
  });
  it('returns null for non-proposal slugs', () => {
    expect(parseProposalSlug('feedback_pat_topic')).toBeNull();
    expect(parseProposalSlug('mentor_agent_directive')).toBeNull();
  });
  it('returns null for slugs missing classification', () => {
    expect(parseProposalSlug('20260505-155146')).toBeNull();
    expect(parseProposalSlug('20260505-155146-classonly')).toBeNull();
  });
  it('returns null for invalid date components', () => {
    // month=13
    expect(parseProposalSlug('20261305-000000-x-y')).toBeNull();
    // hour=25
    expect(parseProposalSlug('20260505-250000-x-y')).toBeNull();
  });
  it('lowercases the classification', () => {
    const m = parseProposalSlug('20260505-155146-PrematureCompletion-x-y');
    expect(m?.classification).toBe('prematurecompletion');
  });
});

describe('clusterProposals', () => {
  it('returns empty array for empty input', () => {
    expect(clusterProposals([])).toEqual([]);
  });

  it('skips feedback rows', () => {
    const lessons: IndexedLesson[] = [
      fakeLesson('feedback_pat_topic', 'feedback'),
      fakeLesson('20260505-100000-relitigation-pat-issue', 'feedback')
    ];
    expect(clusterProposals(lessons)).toEqual([]);
  });

  it('clusters distinct proposals into single-member clusters', () => {
    const clusters = clusterProposals([
      fakeLesson('20260505-100000-relitigation-pat-issue'),
      fakeLesson('20260505-110000-decisionclassifierviolation-asking-questions')
    ]);
    expect(clusters).toHaveLength(2);
    for (const c of clusters) {
      expect(c.occurrenceCount).toBe(1);
      expect(c.systemic).toBe(false);
    }
  });

  it('collapses -N collision-suffix duplicates into one cluster', () => {
    const lessons = [
      fakeLesson('20260505-155146-prematurecompletion-pr-0-regression-after-merge'),
      fakeLesson('20260505-155146-prematurecompletion-pr-0-regression-after-merge-2'),
      fakeLesson('20260505-155146-prematurecompletion-pr-0-regression-after-merge-3'),
      fakeLesson('20260505-155216-prematurecompletion-pr-0-regression-after-merge-10')
    ];
    const clusters = clusterProposals(lessons);
    expect(clusters).toHaveLength(1);
    const c = clusters[0]!;
    expect(c.classification).toBe('prematurecompletion');
    expect(c.topicSlug).toBe('pr-0-regression-after-merge');
    expect(c.occurrenceCount).toBe(4);
    expect(c.systemic).toBe(true);
  });

  it('marks systemic at >= threshold (default 3)', () => {
    const baseSlug = '20260505-100000-relitigation-pat-issue';
    const lessons = [
      fakeLesson(baseSlug),
      fakeLesson(`${baseSlug}-2`),
      fakeLesson(`${baseSlug}-3`)
    ];
    const c = clusterProposals(lessons)[0]!;
    expect(c.occurrenceCount).toBe(3);
    expect(c.systemic).toBe(true);
  });

  it('respects custom systemicThreshold', () => {
    const baseSlug = '20260505-100000-relitigation-pat-issue';
    const lessons = [fakeLesson(baseSlug), fakeLesson(`${baseSlug}-2`)];
    expect(clusterProposals(lessons, { systemicThreshold: 2 })[0]?.systemic).toBe(true);
    expect(clusterProposals(lessons, { systemicThreshold: 5 })[0]?.systemic).toBe(false);
  });

  it('marks burst when all occurrences fit inside burstWindowMs (default 1h)', () => {
    const lessons = [
      fakeLesson('20260505-100000-prematurecompletion-x-y'),
      fakeLesson('20260505-100500-prematurecompletion-x-y-2'),
      fakeLesson('20260505-101500-prematurecompletion-x-y-3')
    ];
    const c = clusterProposals(lessons)[0]!;
    expect(c.burst).toBe(true);
  });

  it('does NOT mark burst when occurrences span >1h', () => {
    const lessons = [
      fakeLesson('20260505-100000-prematurecompletion-x-y'),
      fakeLesson('20260505-130000-prematurecompletion-x-y-2'),
      fakeLesson('20260506-100000-prematurecompletion-x-y-3')
    ];
    const c = clusterProposals(lessons)[0]!;
    expect(c.burst).toBe(false);
  });

  it('respects custom burstWindowMs', () => {
    const lessons = [
      fakeLesson('20260505-100000-prematurecompletion-x-y'),
      fakeLesson('20260505-130000-prematurecompletion-x-y-2')
    ];
    expect(
      clusterProposals(lessons, { burstWindowMs: 60_000 })[0]?.burst
    ).toBe(false);
    // 4h window — yes, that's a burst
    expect(
      clusterProposals(lessons, { burstWindowMs: 4 * 60 * 60 * 1000 })[0]?.burst
    ).toBe(true);
  });

  it('orders clusters by occurrence desc, then last-seen desc', () => {
    const lessons = [
      // 1x relitigation/foo (older)
      fakeLesson('20260504-100000-relitigation-foo'),
      // 4x prematurecompletion/bar (newer)
      fakeLesson('20260505-100000-prematurecompletion-bar'),
      fakeLesson('20260505-100100-prematurecompletion-bar-2'),
      fakeLesson('20260505-100200-prematurecompletion-bar-3'),
      fakeLesson('20260505-100300-prematurecompletion-bar-4'),
      // 4x decisionclassifierviolation/baz (oldest of the two 4x clusters)
      fakeLesson('20260504-100000-decisionclassifierviolation-baz'),
      fakeLesson('20260504-100100-decisionclassifierviolation-baz-2'),
      fakeLesson('20260504-100200-decisionclassifierviolation-baz-3'),
      fakeLesson('20260504-100300-decisionclassifierviolation-baz-4')
    ];
    const clusters = clusterProposals(lessons);
    expect(clusters.map((c) => `${c.classification}/${c.topicSlug}`)).toEqual([
      'prematurecompletion/bar',
      'decisionclassifierviolation/baz',
      'relitigation/foo'
    ]);
  });

  it('includes member metadata in chronological order', () => {
    const lessons = [
      fakeLesson('20260505-100200-x-y-3'),
      fakeLesson('20260505-100000-x-y'),
      fakeLesson('20260505-100100-x-y-2')
    ];
    const c = clusterProposals(lessons)[0]!;
    const ts = c.members.map((m) => m.timestampMs);
    const sorted = [...ts].sort((a, b) => a - b);
    expect(ts).toEqual(sorted);
  });

  it('attaches sourcePath from the IndexedLesson', () => {
    const c = clusterProposals([fakeLesson('20260505-100000-x-y')])[0]!;
    expect(c.members[0]?.sourcePath).toBe('/fake/20260505-100000-x-y.md');
  });

  it('skips proposal rows with un-parseable slugs', () => {
    const lessons = [
      fakeLesson('not-a-real-mentor-slug'),
      fakeLesson('20260505-100000-relitigation-foo')
    ];
    const clusters = clusterProposals(lessons);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.topicSlug).toBe('foo');
  });
});

describe('systemicClusters', () => {
  it('filters down to systemic clusters only', () => {
    const lessons = [
      fakeLesson('20260505-100000-x-y'),
      fakeLesson('20260505-100100-a-b'),
      fakeLesson('20260505-100200-a-b-2'),
      fakeLesson('20260505-100300-a-b-3')
    ];
    const all = clusterProposals(lessons);
    const sys = systemicClusters(all);
    expect(sys).toHaveLength(1);
    expect(sys[0]?.classification).toBe('a');
  });
});

describe('public defaults', () => {
  it('exports the documented threshold default', () => {
    expect(DEFAULT_SYSTEMIC_THRESHOLD).toBe(3);
  });
  it('exports the documented burst window default (1h)', () => {
    expect(DEFAULT_BURST_WINDOW_MS).toBe(60 * 60 * 1000);
  });
});
