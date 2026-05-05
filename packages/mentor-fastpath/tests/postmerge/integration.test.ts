/**
 * Integration test for the Phase-2 postmerge data layer.
 *
 * Exercises the full classify → synthesize → write-proposal pipeline
 * using the (already-tested) Phase-1 memory-writer. This is the test
 * that gives the most confidence that PR-2's consumer can wire these
 * pieces together with no surprises.
 *
 * Uses a tmpdir for the proposal file output.
 */

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classifyPostMerge,
  synthesizePostMerge
} from '../../src/postmerge/index.js';
import type { PostMergeEventRow } from '../../src/postmerge/index.js';
import { writeProposal } from '../../src/memory-writer.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mentor-postmerge-int-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const baseRow: PostMergeEventRow = {
  id: 'ev_int_xyz',
  event_type: 'RegressionDetected',
  schema_version: 1,
  correlation_id: 'corr_int',
  parent_event_id: null,
  emitted_at: '2026-05-05T15:30:00.000Z',
  hostname: 'mac.local',
  process_name: 'caia-postmerge-watcher',
  payload_json: '{}',
  validation_failed: 0,
  ingest_offset: 99
};

describe('integration: postmerge classify → synthesize → write-proposal', () => {
  it('writes a regression-after-merge proposal to <memoryDir>/proposals/', () => {
    const input = {
      prNumber: 327,
      sha: 'ea23ab0',
      branch: 'develop',
      failedJobs: ['integration-tests'],
      title: 'feat(curator-phase1-001): scan loop infrastructure',
      author: 'campaign-coordinator',
      postMergeAgeSec: 240,
      signal: 'regression-after-merge' as const
    };

    const cls = classifyPostMerge(input);
    expect(cls.primary).toBe('PrematureCompletion');
    expect(cls.severity).toBe('high');

    const lesson = synthesizePostMerge(baseRow, input, cls);
    const written = writeProposal(lesson, {
      memoryDir: tmp,
      now: new Date('2026-05-05T15:30:30.000Z')
    });

    expect(written.created).toBe(true);
    expect(statSync(written.path).isFile()).toBe(true);

    const content = readFileSync(written.path, 'utf-8');
    expect(content).toMatch(/classifiedAs: PrematureCompletion/);
    expect(content).toMatch(/severity: high/);
    expect(content).toMatch(/signal: regression-after-merge/);
    expect(content).toMatch(/PR\*\*: #327/);
    expect(content).toMatch(/Stage-6 failure of the 6-stage DoD/);
  });

  it('writes an evidence-gate-failed proposal with LackingInformation tag', () => {
    const input = {
      prNumber: 311,
      sha: '',
      branch: 'feat/observability-001-pino-rollout-worker-coding',
      failedJobs: ['lint', 'typecheck'],
      title: 'feat(observability): pino logger rollout to worker-coding',
      signal: 'evidence-gate-failed' as const
    };

    const cls = classifyPostMerge(input);
    expect(cls.primary).toBe('Incompleteness');
    expect(cls.secondary).toContain('LackingInformation');

    const lesson = synthesizePostMerge(baseRow, input, cls);
    const written = writeProposal(lesson, {
      memoryDir: tmp,
      now: new Date('2026-05-05T15:30:30.000Z')
    });

    const content = readFileSync(written.path, 'utf-8');
    expect(content).toMatch(/classifiedAs: Incompleteness/);
    expect(content).toMatch(/Pre-merge gates are the cheapest/);
    expect(content).toContain('LackingInformation');
    expect(content).not.toMatch(/SHA\*\*: ``/);
  });

  it('skips Unclassified pr-merged-only signals (consumer-side decision)', () => {
    const input = {
      prNumber: 999,
      sha: 'cafebabe',
      branch: 'develop',
      failedJobs: [],
      signal: 'pr-merged-only' as const
    };

    const cls = classifyPostMerge(input);
    expect(cls.primary).toBe('Unclassified');
    expect(cls.confidence).toBe(0);

    // The consumer (PR-2) is expected to skip this case entirely. We
    // *can* still synthesize a proposal — useful proof that the
    // synthesizer is signal-agnostic — but in production the
    // pr-merged-only path returns early before this point.
    const lesson = synthesizePostMerge(baseRow, input, cls);
    expect(lesson.markdown).toMatch(/Unclassified/);
  });
});
