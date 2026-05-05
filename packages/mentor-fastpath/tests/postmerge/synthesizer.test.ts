/**
 * Unit tests for the Phase-2 postmerge synthesizer.
 *
 * Coverage:
 *   - Output shape (slug, title, frontmatter, markdown).
 *   - Frontmatter contains the right fields (name, classifiedAs,
 *     severity, generalizability, signal, originSessionId).
 *   - "Why" section enumerates structured fields (PR #, branch, SHA,
 *     failed jobs, age) — not free-form text quoting.
 *   - Per-signal "How to apply" template selection.
 *   - Slug determinism: same PR + signal → same slug (lets the memory-
 *     writer dedupe).
 *   - Title truncation when PR title is long.
 *   - Defensive: missing title, missing description, empty failedJobs.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyPostMerge,
  synthesizePostMerge
} from '../../src/postmerge/index.js';
import type {
  PostMergeEventRow,
  PostMergeInput
} from '../../src/postmerge/index.js';

function row(overrides: Partial<PostMergeEventRow> = {}): PostMergeEventRow {
  return {
    id: 'ev_test_abc',
    event_type: 'PRMerged',
    schema_version: 1,
    correlation_id: 'corr_test',
    parent_event_id: null,
    emitted_at: '2026-05-05T15:00:00.000Z',
    hostname: 'mac.local',
    process_name: 'caia-postmerge-watcher',
    payload_json: '{}',
    validation_failed: 0,
    ingest_offset: 42,
    ...overrides
  };
}

function base(overrides: Partial<PostMergeInput> = {}): PostMergeInput {
  return {
    prNumber: 327,
    sha: 'ea23ab0',
    branch: 'develop',
    failedJobs: ['integration-tests'],
    title: 'feat(curator-phase1-001): scan loop infrastructure',
    author: 'campaign-coordinator',
    postMergeAgeSec: 240,
    signal: 'regression-after-merge',
    ...overrides
  };
}

describe('synthesizePostMerge — output shape', () => {
  it('returns slug, title, frontmatter, markdown', () => {
    const input = base();
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);

    expect(lesson).toHaveProperty('slug');
    expect(lesson).toHaveProperty('title');
    expect(lesson).toHaveProperty('frontmatter');
    expect(lesson).toHaveProperty('markdown');
    expect(typeof lesson.slug).toBe('string');
    expect(lesson.slug.length).toBeGreaterThan(0);
    expect(typeof lesson.markdown).toBe('string');
    expect(lesson.markdown).toMatch(/^---\n/);
  });
});

describe('synthesizePostMerge — frontmatter fields', () => {
  it('includes the canonical fields', () => {
    const input = base();
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);

    expect(lesson.frontmatter['type']).toBe('feedback-proposal');
    expect(lesson.frontmatter['classifiedAs']).toBe('PrematureCompletion');
    expect(lesson.frontmatter['severity']).toBe('high');
    expect(lesson.frontmatter['generalizability']).toBe('systemic');
    expect(lesson.frontmatter['signal']).toBe('regression-after-merge');
    expect(lesson.frontmatter['originSessionId']).toBe('corr_test');
    expect(lesson.frontmatter['name']).toContain('PrematureCompletion');
  });

  it('falls back to event id when correlation_id is null', () => {
    const input = base();
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(
      row({ correlation_id: null, id: 'ev_no_corr' }),
      input,
      cls
    );
    expect(lesson.frontmatter['originSessionId']).toBe('ev_no_corr');
  });
});

describe('synthesizePostMerge — Why section structure', () => {
  it('lists PR #, branch, SHA, failed jobs', () => {
    const input = base();
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);

    expect(lesson.markdown).toContain('## Why');
    expect(lesson.markdown).toContain('PR**: #327');
    expect(lesson.markdown).toContain('Branch**: develop');
    expect(lesson.markdown).toContain('SHA**: `ea23ab0`');
    expect(lesson.markdown).toContain('`integration-tests`');
    expect(lesson.markdown).toContain('Author**: @campaign-coordinator');
  });

  it('renders postMergeAgeSec as minutes + seconds', () => {
    const input = base({ postMergeAgeSec: 480 });
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);
    expect(lesson.markdown).toMatch(/8 minute\(s\) \(480s\)/);
  });

  it('omits SHA line when sha is empty (pre-merge gate-failed case)', () => {
    const input = base({
      sha: '',
      signal: 'evidence-gate-failed',
      failedJobs: ['lint']
    });
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);
    expect(lesson.markdown).not.toMatch(/SHA\*\*: ``/);
  });

  it('truncates very long descriptions', () => {
    const longDesc = 'x'.repeat(500);
    const input = base({
      signal: 'post-merge-bug-report',
      description: longDesc
    });
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);
    // Description should be truncated to 197 chars + ellipsis
    expect(lesson.markdown).toMatch(/\.\.\./);
    expect(lesson.markdown.length).toBeLessThan(longDesc.length + 4_000);
  });
});

describe('synthesizePostMerge — How-to-apply template selection', () => {
  it('selects regression-after-merge template', () => {
    const input = base({ signal: 'regression-after-merge' });
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);
    expect(lesson.markdown).toMatch(/Stage-6 failure of the 6-stage DoD/);
  });

  it('selects evidence-gate-failed template', () => {
    const input = base({ signal: 'evidence-gate-failed', failedJobs: ['lint'] });
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);
    expect(lesson.markdown).toMatch(/Pre-merge gates are the cheapest/);
  });

  it('selects post-merge-bug-report template', () => {
    const input = base({
      signal: 'post-merge-bug-report',
      description: 'bug found post-merge'
    });
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);
    expect(lesson.markdown).toMatch(/test fixture matrix/);
  });
});

describe('synthesizePostMerge — slug determinism', () => {
  it('same PR + signal → same slug', () => {
    const input1 = base({ prNumber: 100, signal: 'regression-after-merge' });
    const input2 = base({
      prNumber: 100,
      signal: 'regression-after-merge',
      sha: 'different-sha',
      title: 'different title'
    });
    const lesson1 = synthesizePostMerge(
      row(),
      input1,
      classifyPostMerge(input1)
    );
    const lesson2 = synthesizePostMerge(
      row(),
      input2,
      classifyPostMerge(input2)
    );
    expect(lesson1.slug).toBe(lesson2.slug);
  });

  it('different signal → different slug for same PR', () => {
    const input1 = base({ prNumber: 100, signal: 'regression-after-merge' });
    const input2 = base({
      prNumber: 100,
      signal: 'evidence-gate-failed',
      failedJobs: ['lint']
    });
    const lesson1 = synthesizePostMerge(
      row(),
      input1,
      classifyPostMerge(input1)
    );
    const lesson2 = synthesizePostMerge(
      row(),
      input2,
      classifyPostMerge(input2)
    );
    expect(lesson1.slug).not.toBe(lesson2.slug);
  });
});

describe('synthesizePostMerge — title truncation', () => {
  it('truncates very long PR titles', () => {
    const longTitle = 'a really long pull request title '.repeat(10);
    const input = base({ title: longTitle });
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);
    // Title in frontmatter shouldn't be longer than ~150 chars
    expect(lesson.title.length).toBeLessThan(150);
    expect(lesson.title).toContain('...');
  });

  it('falls back to PR# when title is missing', () => {
    const input: PostMergeInput = {
      prNumber: 999,
      sha: 'abc',
      branch: 'develop',
      failedJobs: [],
      signal: 'regression-after-merge'
    };
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);
    expect(lesson.title).toContain('PR #999');
  });
});

describe('synthesizePostMerge — provenance section', () => {
  it('includes event id, type, emitted_at, hostname', () => {
    const input = base();
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);

    expect(lesson.markdown).toContain('## Provenance');
    expect(lesson.markdown).toContain('Event id: `ev_test_abc`');
    expect(lesson.markdown).toContain('Event type: PRMerged');
    expect(lesson.markdown).toContain('Hostname: mac.local');
    expect(lesson.markdown).toContain('Process: caia-postmerge-watcher');
  });

  it('renders process as (unknown) when null', () => {
    const input = base();
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(
      row({ process_name: null }),
      input,
      cls
    );
    expect(lesson.markdown).toContain('Process: (unknown)');
  });

  it('lists secondary tags when present', () => {
    const input = base({
      signal: 'regression-after-merge',
      failedJobs: ['lint', 'security']
    });
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);
    expect(lesson.markdown).toContain('Secondary tags:');
    expect(lesson.markdown).toContain('LackingInformation');
    expect(lesson.markdown).toContain('SecurityRegression');
  });

  it('omits secondary-tags line when empty', () => {
    const input = base({
      signal: 'regression-after-merge',
      failedJobs: []
    });
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);
    expect(lesson.markdown).not.toMatch(/Secondary tags:/);
  });
});

describe('synthesizePostMerge — operator-review reminder', () => {
  it('always includes the review reminder footer', () => {
    const input = base();
    const cls = classifyPostMerge(input);
    const lesson = synthesizePostMerge(row(), input, cls);
    expect(lesson.markdown).toMatch(/operator review is required/);
    expect(lesson.markdown).toMatch(/Mentor Phase-2/);
  });
});
