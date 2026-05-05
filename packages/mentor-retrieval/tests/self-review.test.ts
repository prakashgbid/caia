/**
 * Tests for the Mentor Phase-4 PR-3 quarterly self-review.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  generateSelfReview,
  renderSelfReviewMarkdown,
  DEFAULT_TOP_CLUSTERS,
  DEFAULT_WINDOW_DAYS
} from '../src/self-review.js';
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

const NOW_MS = Date.UTC(2026, 4, 5, 18, 0, 0); // 2026-05-05T18:00:00Z

describe('generateSelfReview — index health', () => {
  it('counts feedback vs proposal kinds', () => {
    const lessons = [
      fakeLesson('feedback_a', 'feedback'),
      fakeLesson('feedback_b', 'feedback'),
      fakeLesson('20260505-100000-relitigation-x'),
      fakeLesson('20260505-100100-prematurecompletion-y')
    ];
    const s = generateSelfReview(lessons, { nowMs: NOW_MS });
    expect(s.totalLessons).toBe(4);
    expect(s.feedbackCount).toBe(2);
    expect(s.proposalCount).toBe(2);
  });

  it('passes through index meta', () => {
    const s = generateSelfReview([], {
      nowMs: NOW_MS,
      meta: {
        embeddingModel: 'nomic-embed-text',
        embeddingDim: 768,
        lastBuildAtMs: NOW_MS - 1000,
        lastBuildScanned: 70
      }
    });
    expect(s.embeddingModel).toBe('nomic-embed-text');
    expect(s.embeddingDim).toBe(768);
    expect(s.lastBuildAtIso).toBe(new Date(NOW_MS - 1000).toISOString());
    expect(s.lastBuildScanned).toBe(70);
  });

  it('handles missing meta gracefully', () => {
    const s = generateSelfReview([], { nowMs: NOW_MS });
    expect(s.embeddingModel).toBeNull();
    expect(s.embeddingDim).toBeNull();
    expect(s.lastBuildAtIso).toBeNull();
    expect(s.lastBuildScanned).toBeNull();
  });
});

describe('generateSelfReview — windowing', () => {
  it('counts only proposals inside the rolling window', () => {
    // Window = 90d ending NOW_MS. Anything older than 2026-02-04 is out.
    const lessons = [
      fakeLesson('20260505-100000-relitigation-recent'),       // in window
      fakeLesson('20260505-100100-relitigation-recent-2'),     // in window
      fakeLesson('20251201-100000-relitigation-old')           // out (Dec 2025)
    ];
    const s = generateSelfReview(lessons, { nowMs: NOW_MS, windowDays: 90 });
    expect(s.proposalsWithinWindow).toBe(2);
    // breakdown groups by classification — all 3 are 'relitigation'
    expect(s.classificationBreakdown).toHaveLength(1);
    expect(s.classificationBreakdown[0]?.totalCount).toBe(3);
    expect(s.classificationBreakdown[0]?.withinWindowCount).toBe(2);
  });

  it('respects custom windowDays', () => {
    const lessons = [
      fakeLesson('20260505-100000-relitigation-today'),
      fakeLesson('20260101-100000-relitigation-jan-1')
    ];
    const s = generateSelfReview(lessons, { nowMs: NOW_MS, windowDays: 1 });
    expect(s.proposalsWithinWindow).toBe(1);
  });
});

describe('generateSelfReview — classification breakdown', () => {
  it('groups by classification with within-window + total counts', () => {
    const lessons = [
      // 3 prematurecompletion within window (clusters as one cluster of 3)
      fakeLesson('20260505-100000-prematurecompletion-x'),
      fakeLesson('20260505-100100-prematurecompletion-x-2'),
      fakeLesson('20260505-100200-prematurecompletion-x-3'),
      // 1 relitigation within window
      fakeLesson('20260505-100300-relitigation-y'),
      // 1 relitigation outside window
      fakeLesson('20251201-100000-relitigation-z')
    ];
    const s = generateSelfReview(lessons, { nowMs: NOW_MS });
    expect(s.classificationBreakdown).toHaveLength(2);
    const pc = s.classificationBreakdown.find(
      (b) => b.classification === 'prematurecompletion'
    );
    const rl = s.classificationBreakdown.find(
      (b) => b.classification === 'relitigation'
    );
    expect(pc?.totalCount).toBe(3);
    expect(pc?.withinWindowCount).toBe(3);
    expect(rl?.totalCount).toBe(2);
    expect(rl?.withinWindowCount).toBe(1);
  });
});

describe('generateSelfReview — cluster shape', () => {
  it('counts systemic vs one-off vs burst', () => {
    const lessons = [
      // systemic + burst (4x within minutes)
      fakeLesson('20260505-100000-prematurecompletion-x'),
      fakeLesson('20260505-100010-prematurecompletion-x-2'),
      fakeLesson('20260505-100020-prematurecompletion-x-3'),
      fakeLesson('20260505-100030-prematurecompletion-x-4'),
      // systemic + sustained (3x across days)
      fakeLesson('20260503-100000-relitigation-y'),
      fakeLesson('20260504-100000-relitigation-y-2'),
      fakeLesson('20260505-100000-relitigation-y-3'),
      // one-off
      fakeLesson('20260505-100400-decisionclassifierviolation-z')
    ];
    const s = generateSelfReview(lessons, { nowMs: NOW_MS });
    expect(s.totalClusters).toBe(3);
    expect(s.systemicClusterCount).toBe(2);
    expect(s.oneOffClusterCount).toBe(1);
    expect(s.burstClusterCount).toBeGreaterThanOrEqual(1);
    expect(s.sustainedSystemicCount).toBe(1);
  });
});

describe('generateSelfReview — Steward-rule coverage', () => {
  it('marks cluster as "with rule" if proposal index contains the key', () => {
    const lessons = [
      fakeLesson('20260505-100000-prematurecompletion-x-y'),
      fakeLesson('20260505-100100-prematurecompletion-x-y-2'),
      fakeLesson('20260505-100200-prematurecompletion-x-y-3')
    ];
    const idx = new Set(['prematurecompletion::x-y']);
    const s = generateSelfReview(lessons, {
      nowMs: NOW_MS,
      ruleProposalIndex: idx
    });
    expect(s.systemicClustersWithRuleProposal).toBe(1);
    expect(s.systemicClustersWithoutRuleProposal).toBe(0);
    expect(s.topSystemicClusters[0]?.hasStewardRuleProposal).toBe(true);
  });

  it('marks systemic clusters without proposals correctly', () => {
    const lessons = [
      fakeLesson('20260505-100000-prematurecompletion-x-y'),
      fakeLesson('20260505-100100-prematurecompletion-x-y-2'),
      fakeLesson('20260505-100200-prematurecompletion-x-y-3')
    ];
    const s = generateSelfReview(lessons, {
      nowMs: NOW_MS,
      ruleProposalIndex: new Set()
    });
    expect(s.systemicClustersWithRuleProposal).toBe(0);
    expect(s.systemicClustersWithoutRuleProposal).toBe(1);
  });

  it('uses default FS scanner against memoryDir when ruleProposalIndex absent', () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'mentor-self-review-'));
    mkdirSync(join(memoryDir, 'proposals'));
    writeFileSync(
      join(memoryDir, 'proposals', 'steward-rule-prematurecompletion-x-y.md'),
      '# proposal\n'
    );

    const lessons = [
      fakeLesson('20260505-100000-prematurecompletion-x-y'),
      fakeLesson('20260505-100100-prematurecompletion-x-y-2'),
      fakeLesson('20260505-100200-prematurecompletion-x-y-3')
    ];
    const s = generateSelfReview(lessons, {
      nowMs: NOW_MS,
      memoryDir
    });
    expect(s.stewardRuleProposalsOnDisk).toBe(1);
    expect(s.systemicClustersWithRuleProposal).toBe(1);
  });

  it('handles missing proposals dir gracefully', () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'mentor-self-review-no-prop-'));
    const s = generateSelfReview([], { nowMs: NOW_MS, memoryDir });
    expect(s.stewardRuleProposalsOnDisk).toBe(0);
  });
});

describe('generateSelfReview — top clusters', () => {
  it('limits to topClustersToHighlight', () => {
    const lessons: IndexedLesson[] = [];
    // 5 distinct systemic clusters
    for (let cls = 0; cls < 5; cls++) {
      for (let i = 0; i < 3; i++) {
        lessons.push(
          fakeLesson(
            `20260505-${String(100000 + cls).padStart(6, '0')}-cls${cls}-topic${i > 0 ? `-${i + 1}` : ''}`
          )
        );
      }
    }
    const s = generateSelfReview(lessons, {
      nowMs: NOW_MS,
      topClustersToHighlight: 2
    });
    expect(s.topSystemicClusters).toHaveLength(2);
  });

  it('orders by occurrence then last-seen', () => {
    const lessons = [
      // 4x cluster A
      fakeLesson('20260505-100000-a-topicA'),
      fakeLesson('20260505-100100-a-topicA-2'),
      fakeLesson('20260505-100200-a-topicA-3'),
      fakeLesson('20260505-100300-a-topicA-4'),
      // 3x cluster B
      fakeLesson('20260504-100000-b-topicB'),
      fakeLesson('20260504-100100-b-topicB-2'),
      fakeLesson('20260504-100200-b-topicB-3')
    ];
    const s = generateSelfReview(lessons, { nowMs: NOW_MS });
    expect(s.topSystemicClusters).toHaveLength(2);
    expect(s.topSystemicClusters[0]?.classification).toBe('a');
    expect(s.topSystemicClusters[1]?.classification).toBe('b');
  });
});

describe('renderSelfReviewMarkdown', () => {
  it('produces a stable markdown document', () => {
    const s = generateSelfReview(
      [
        fakeLesson('feedback_x', 'feedback'),
        fakeLesson('20260505-100000-prematurecompletion-foo'),
        fakeLesson('20260505-100100-prematurecompletion-foo-2'),
        fakeLesson('20260505-100200-prematurecompletion-foo-3')
      ],
      { nowMs: NOW_MS, ruleProposalIndex: new Set() }
    );
    const md = renderSelfReviewMarkdown(s);
    expect(md).toMatch(/^# Mentor self-review/);
    expect(md).toMatch(/## Index health/);
    expect(md).toMatch(/## Incident volume/);
    expect(md).toMatch(/## Cluster shape/);
    expect(md).toMatch(/## Steward-rule coverage/);
    expect(md).toMatch(/## Top systemic clusters/);
    expect(md).toMatch(/prematurecompletion\/foo/);
  });

  it('is deterministic across renders', () => {
    const s = generateSelfReview(
      [fakeLesson('20260505-100000-relitigation-x')],
      { nowMs: NOW_MS, ruleProposalIndex: new Set() }
    );
    const a = renderSelfReviewMarkdown(s);
    const b = renderSelfReviewMarkdown(s);
    expect(a).toBe(b);
  });

  it('includes the action prompt when systemic clusters lack proposals', () => {
    const s = generateSelfReview(
      [
        fakeLesson('20260505-100000-prematurecompletion-foo'),
        fakeLesson('20260505-100100-prematurecompletion-foo-2'),
        fakeLesson('20260505-100200-prematurecompletion-foo-3')
      ],
      { nowMs: NOW_MS, ruleProposalIndex: new Set() }
    );
    const md = renderSelfReviewMarkdown(s);
    expect(md).toMatch(/caia-mentor-propose-steward-rule write/);
  });

  it('omits action prompt when all systemic clusters covered', () => {
    const s = generateSelfReview(
      [
        fakeLesson('20260505-100000-prematurecompletion-foo'),
        fakeLesson('20260505-100100-prematurecompletion-foo-2'),
        fakeLesson('20260505-100200-prematurecompletion-foo-3')
      ],
      {
        nowMs: NOW_MS,
        ruleProposalIndex: new Set(['prematurecompletion::foo'])
      }
    );
    const md = renderSelfReviewMarkdown(s);
    expect(md).not.toMatch(/Action.*caia-mentor-propose-steward-rule/);
  });

  it('renders empty-state correctly', () => {
    const s = generateSelfReview([], { nowMs: NOW_MS });
    const md = renderSelfReviewMarkdown(s);
    expect(md).toMatch(/no proposals indexed yet/);
    expect(md).toMatch(/none yet/);
  });
});

describe('public defaults', () => {
  it('exports DEFAULT_WINDOW_DAYS = 90', () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(90);
  });
  it('exports DEFAULT_TOP_CLUSTERS = 10', () => {
    expect(DEFAULT_TOP_CLUSTERS).toBe(10);
  });
});
