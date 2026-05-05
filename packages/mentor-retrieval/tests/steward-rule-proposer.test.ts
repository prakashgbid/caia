/**
 * Tests for the Mentor Phase-4 PR-2 Steward rule proposer.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  proposeStewardRule,
  renderStewardRuleProposalMarkdown,
  writeStewardRuleProposals
} from '../src/steward-rule-proposer.js';
import type { Cluster, ProposalMetadata } from '../src/cluster.js';

function fakeMember(rawSlug: string, ts: number): ProposalMetadata {
  return {
    sourcePath: `/fake/${rawSlug}.md`,
    rawSlug,
    classification: 'unused',
    topicSlug: 'unused',
    timestampMs: ts
  };
}

function fakeCluster(opts: {
  classification: string;
  topicSlug: string;
  occurrences: number;
  burst?: boolean;
  baseTs?: number;
  spreadMs?: number;
}): Cluster {
  const baseTs = opts.baseTs ?? Date.UTC(2026, 4, 5, 10, 0, 0);
  const spreadMs = opts.spreadMs ?? (opts.burst === false ? 7 * 24 * 3600 * 1000 : 60_000);

  const members: ProposalMetadata[] = [];
  for (let i = 0; i < opts.occurrences; i++) {
    const ts = baseTs + Math.floor((i * spreadMs) / Math.max(opts.occurrences - 1, 1));
    const slug = `20260505-${String(100000 + i).padStart(6, '0')}-${opts.classification}-${opts.topicSlug}${i > 0 ? `-${i + 1}` : ''}`;
    members.push(fakeMember(slug, ts));
  }
  members.sort((a, b) => a.timestampMs - b.timestampMs);
  const firstSeenMs = members[0]!.timestampMs;
  const lastSeenMs = members[members.length - 1]!.timestampMs;
  return {
    classification: opts.classification,
    topicSlug: opts.topicSlug,
    occurrenceCount: opts.occurrences,
    members,
    firstSeenMs,
    lastSeenMs,
    systemic: opts.occurrences >= 3,
    burst: opts.burst ?? lastSeenMs - firstSeenMs <= 60 * 60 * 1000
  };
}

describe('proposeStewardRule', () => {
  it('returns a proposal with stable slug', () => {
    const c = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'pr-0-regression-after-merge',
      occurrences: 5
    });
    const p = proposeStewardRule(c);
    expect(p.proposalSlug).toBe(
      'steward-rule-prematurecompletion-pr-0-regression-after-merge'
    );
    expect(p.classification).toBe('prematurecompletion');
    expect(p.topicSlug).toBe('pr-0-regression-after-merge');
    expect(p.occurrenceCount).toBe(5);
  });

  it('routes prematurecompletion to post-merge with relevant heuristic', () => {
    const c = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'foo',
      occurrences: 3
    });
    const p = proposeStewardRule(c);
    expect(p.proposedCheckType).toBe('post-merge');
    expect(p.triggerHeuristic).toMatch(/CI run on the merge commit/);
    expect(p.remediationGuidance).toMatch(/Stage-6/);
  });

  it('routes relitigation to pre-merge with feedback consultation', () => {
    const c = fakeCluster({
      classification: 'relitigation',
      topicSlug: 'pat-topic',
      occurrences: 3
    });
    const p = proposeStewardRule(c);
    expect(p.proposedCheckType).toBe('pre-merge');
    expect(p.triggerHeuristic).toMatch(/feedback_pat_topic/);
  });

  it('routes decisionclassifierviolation to pre-merge with phrase scan', () => {
    const c = fakeCluster({
      classification: 'decisionclassifierviolation',
      topicSlug: 'asking-questions',
      occurrences: 3
    });
    const p = proposeStewardRule(c);
    expect(p.proposedCheckType).toBe('pre-merge');
    expect(p.triggerHeuristic).toMatch(/want me to|should I|your call/);
  });

  it('routes coordinationfailure / gitbranchhygienefailure to cron', () => {
    const a = proposeStewardRule(
      fakeCluster({
        classification: 'coordinationfailure',
        topicSlug: 'parallel-overrun',
        occurrences: 3
      })
    );
    const b = proposeStewardRule(
      fakeCluster({
        classification: 'gitbranchhygienefailure',
        topicSlug: 'orphan-branch',
        occurrences: 3
      })
    );
    expect(a.proposedCheckType).toBe('cron');
    expect(b.proposedCheckType).toBe('cron');
  });

  it('routes unclassified explicitly with operator-prompt', () => {
    const p = proposeStewardRule(
      fakeCluster({
        classification: 'unclassified',
        topicSlug: 'foo',
        occurrences: 3
      })
    );
    expect(p.proposedCheckType).toBe('unclassified');
    expect(p.triggerHeuristic).toMatch(/Operator must skim/);
  });

  it('falls back to unclassified for unknown classifications', () => {
    const p = proposeStewardRule(
      fakeCluster({
        classification: 'xyznevergonnaknow',
        topicSlug: 'foo',
        occurrences: 3
      })
    );
    expect(p.proposedCheckType).toBe('unclassified');
    expect(p.triggerHeuristic).toMatch(/does not yet have an entry/);
  });

  it('preserves the cluster span + member list', () => {
    const c = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'foo',
      occurrences: 4,
      burst: true
    });
    const p = proposeStewardRule(c);
    expect(p.spanMs).toBe(c.lastSeenMs - c.firstSeenMs);
    expect(p.evidence).toHaveLength(4);
    expect(p.evidence[0]?.timestampIso).toBe(new Date(c.firstSeenMs).toISOString());
  });

  it('records burst flag from the cluster', () => {
    const c = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'foo',
      occurrences: 3,
      burst: true
    });
    expect(proposeStewardRule(c).burst).toBe(true);
  });
});

describe('renderStewardRuleProposalMarkdown', () => {
  it('produces YAML frontmatter + headings + evidence list', () => {
    const c = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'foo',
      occurrences: 3
    });
    const md = renderStewardRuleProposalMarkdown(proposeStewardRule(c));
    expect(md).toMatch(/^---\n/);
    expect(md).toMatch(/type: steward-rule-proposal/);
    expect(md).toMatch(/classifiedAs: prematurecompletion/);
    expect(md).toMatch(/topicSlug: foo/);
    expect(md).toMatch(/occurrenceCount: 3/);
    expect(md).toMatch(/^# Steward rule proposal — /m);
    expect(md).toMatch(/## Why/);
    expect(md).toMatch(/## Proposed check/);
    expect(md).toMatch(/## Evidence/);
    expect(md).toMatch(/## How to apply/);
  });

  it('is deterministic across calls', () => {
    const c = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'foo',
      occurrences: 3
    });
    const a = renderStewardRuleProposalMarkdown(proposeStewardRule(c));
    const b = renderStewardRuleProposalMarkdown(proposeStewardRule(c));
    expect(a).toBe(b);
  });

  it('mentions burst caveat when cluster.burst is true', () => {
    const c = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'foo',
      occurrences: 3,
      burst: true
    });
    const md = renderStewardRuleProposalMarkdown(proposeStewardRule(c));
    expect(md).toMatch(/burst.*Verify the underlying source/i);
  });

  it('mentions sustained-signal language when cluster.burst is false', () => {
    const c = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'foo',
      occurrences: 3,
      burst: false
    });
    const md = renderStewardRuleProposalMarkdown(proposeStewardRule(c));
    expect(md).toMatch(/Sustained signal/);
  });
});

describe('writeStewardRuleProposals', () => {
  let memoryDir: string;
  beforeEach(() => {
    memoryDir = mkdtempSync(join(tmpdir(), 'mentor-rule-writer-'));
  });
  afterEach(() => {
    // tmpdir auto-cleaned
  });

  it('writes one file per cluster under proposals/', () => {
    const a = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'foo',
      occurrences: 3
    });
    const b = fakeCluster({
      classification: 'relitigation',
      topicSlug: 'pat-topic',
      occurrences: 3
    });
    const result = writeStewardRuleProposals([a, b], { memoryDir });
    expect(result.written).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    for (const w of result.written) {
      expect(existsSync(w.path)).toBe(true);
      const md = readFileSync(w.path, 'utf-8');
      expect(md).toMatch(/type: steward-rule-proposal/);
    }
  });

  it('creates the proposals dir if missing', () => {
    const c = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'foo',
      occurrences: 3
    });
    expect(existsSync(join(memoryDir, 'proposals'))).toBe(false);
    const result = writeStewardRuleProposals([c], { memoryDir });
    expect(existsSync(join(memoryDir, 'proposals'))).toBe(true);
    expect(result.proposalsDir).toBe(join(memoryDir, 'proposals'));
  });

  it('preserves existing files when force=false (default)', () => {
    const c = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'foo',
      occurrences: 3
    });
    // Pre-write an "operator-edited" file.
    const proposalsDir = join(memoryDir, 'proposals');
    const path = join(proposalsDir, 'steward-rule-prematurecompletion-foo.md');
    const result1 = writeStewardRuleProposals([c], { memoryDir });
    expect(result1.written).toHaveLength(1);
    writeFileSync(path, '# operator-edited content\n', 'utf-8');

    const result2 = writeStewardRuleProposals([c], { memoryDir });
    expect(result2.written).toHaveLength(0);
    expect(result2.skipped).toHaveLength(1);
    expect(result2.skipped[0]?.reason).toBe('already-exists');
    // Operator content preserved.
    expect(readFileSync(path, 'utf-8')).toMatch(/operator-edited/);
  });

  it('overwrites existing files when force=true', () => {
    const c = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'foo',
      occurrences: 3
    });
    const result1 = writeStewardRuleProposals([c], { memoryDir });
    const path = result1.written[0]!.path;
    writeFileSync(path, '# operator-edited content\n', 'utf-8');

    const result2 = writeStewardRuleProposals([c], { memoryDir, force: true });
    expect(result2.written).toHaveLength(1);
    expect(result2.skipped).toHaveLength(0);
    expect(readFileSync(path, 'utf-8')).toMatch(/type: steward-rule-proposal/);
  });

  it('dryRun does not write but returns intended paths', () => {
    const c = fakeCluster({
      classification: 'prematurecompletion',
      topicSlug: 'foo',
      occurrences: 3
    });
    const result = writeStewardRuleProposals([c], { memoryDir, dryRun: true });
    expect(result.written).toHaveLength(1);
    expect(existsSync(result.written[0]!.path)).toBe(false);
  });

  it('handles empty cluster list as no-op', () => {
    const result = writeStewardRuleProposals([], { memoryDir });
    expect(result.written).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});
