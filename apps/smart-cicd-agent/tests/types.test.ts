import { describe, it, expect } from 'vitest';
import {
  BucketName,
  Classification,
  FailureBucket,
  Observation,
  ProposedActionPayload,
  RootCause,
  SMART_CICD,
} from '../src/types.js';

describe('Smart CI/CD types', () => {
  it('exports a non-empty version string', () => {
    expect(SMART_CICD).toMatch(/^v\d/);
  });

  it('BucketName accepts known buckets and rejects unknown', () => {
    expect(() => BucketName.parse('lint_failures')).not.toThrow();
    expect(() => BucketName.parse('not-a-real-bucket')).toThrow();
  });

  it('FailureBucket validates count + exemplarRefs cap', () => {
    const ok = FailureBucket.parse({
      bucketName: 'lint_failures',
      count: 3,
      exemplarRefs: ['#1', '#2'],
    });
    expect(ok.count).toBe(3);
    expect(() =>
      FailureBucket.parse({
        bucketName: 'lint_failures',
        count: -1,
        exemplarRefs: [],
      })
    ).toThrow();
    expect(() =>
      FailureBucket.parse({
        bucketName: 'lint_failures',
        count: 1,
        exemplarRefs: Array.from({ length: 21 }, (_, i) => `#${i}`),
      })
    ).toThrow();
  });

  it('RootCause is a closed vocabulary', () => {
    expect(() => RootCause.parse('unknown')).not.toThrow();
    expect(() => RootCause.parse('made-up-cause')).toThrow();
  });

  it('Classification enforces 0-1 confidence', () => {
    expect(() =>
      Classification.parse({
        bucketName: 'lint_failures',
        rootCause: 'code-style-drift',
        confidence: 0.9,
        reasoning: 'Same rule across 12 PRs in last 24h.',
      })
    ).not.toThrow();
    expect(() =>
      Classification.parse({
        bucketName: 'lint_failures',
        rootCause: 'code-style-drift',
        confidence: 1.5,
        reasoning: 'invalid',
      })
    ).toThrow();
  });

  it('ProposedActionPayload discriminates by kind', () => {
    const silent = ProposedActionPayload.parse({
      kind: 'silent',
      note: 'observed but no action',
    });
    expect(silent.kind).toBe('silent');

    const fixPr = ProposedActionPayload.parse({
      kind: 'auto-fix-pr',
      branchName: 'smart-cicd/auto-fix-lint-2026-05-01',
      baseBranch: 'develop',
      title: 'fix(lint): widen no-unused-vars exemption to tests/**',
      body: '## Background\n…',
      files: [{ path: '.eslintrc.cjs', contents: '// updated config' }],
    });
    expect(fixPr.kind).toBe('auto-fix-pr');

    expect(() =>
      ProposedActionPayload.parse({
        kind: 'auto-fix-pr',
        // Missing required `files` and bad branchName prefix.
        branchName: 'feat/oops',
        baseBranch: 'develop',
        title: 't',
        body: 'b',
      })
    ).toThrow();
  });

  it('Observation round-trips a propose-only row', () => {
    const obs = Observation.parse({
      id: 'smart-cicd-abcdef123456',
      observationDate: Date.now(),
      bucketName: 'lint_failures',
      rootCause: 'code-style-drift',
      rootCauseConfidence: 0.82,
      proposedActionKind: 'silent',
      proposedActionPayload: {
        kind: 'silent',
        note: 'observed but no action',
      },
      actedAt: null,
      actedOutcome: null,
      feedbackLabel: 'pending',
      createdAt: Date.now(),
    });
    expect(obs.feedbackLabel).toBe('pending');
    expect(obs.actedAt).toBeNull();
  });
});
