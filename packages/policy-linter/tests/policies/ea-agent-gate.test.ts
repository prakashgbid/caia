import { describe, expect, it } from 'vitest';
import {
  eaAgentGatePolicy,
  findSubmissionEvidence,
  looksLikeArchitectureSignificant
} from '../../src/policies/ea-agent-gate.js';
import { makeCtx } from '../fixtures.js';

describe('ea-agent-gate policy', () => {
  describe('looksLikeArchitectureSignificant', () => {
    it('flags caia-ea/** paths', () => {
      expect(looksLikeArchitectureSignificant(['caia-ea/decisions/ADR-061.md'])).toBe(true);
    });
    it('flags packages/<x>/package.json', () => {
      expect(looksLikeArchitectureSignificant(['packages/foo/package.json'])).toBe(true);
    });
    it('flags ADR file paths', () => {
      expect(looksLikeArchitectureSignificant(['some/dir/decisions/ADR-001.md'])).toBe(true);
    });
    it('does not flag generic src files', () => {
      expect(looksLikeArchitectureSignificant(['src/index.ts'])).toBe(false);
    });
  });

  describe('pass cases', () => {
    it('passes when intent is ops (gate does not apply)', async () => {
      const v = await eaAgentGatePolicy.check(makeCtx({ intent: 'ops', eaPlanSubmissionId: undefined }));
      expect(v.ok).toBe(true);
    });

    it('passes when eaPlanSubmissionId is provided for research intent', async () => {
      const v = await eaAgentGatePolicy.check(
        makeCtx({ intent: 'research', eaPlanSubmissionId: 'sub-123' })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when brief mentions EA_REVIEW_QUEUE.md (deferred mode)', async () => {
      const v = await eaAgentGatePolicy.check(
        makeCtx({
          intent: 'research',
          eaPlanSubmissionId: undefined,
          briefMd: 'Plan logged to EA_REVIEW_QUEUE.md per spec line 639.'
        })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when brief contains submitPlan( call', async () => {
      const v = await eaAgentGatePolicy.check(
        makeCtx({
          intent: 'spec',
          eaPlanSubmissionId: undefined,
          briefMd: 'Invoked ea-architect.submitPlan({planMd, planType, callerAgentId}).'
        })
      );
      expect(v.ok).toBe(true);
    });

    it('passes for build intent when not architecture-significant', async () => {
      const v = await eaAgentGatePolicy.check(
        makeCtx({
          intent: 'build',
          targetRepos: ['caia/apps/site-foo'],
          eaPlanSubmissionId: undefined
        })
      );
      expect(v.ok).toBe(true);
    });
  });

  describe('fail cases', () => {
    it('hard-fails research intent without submission evidence', async () => {
      const v = await eaAgentGatePolicy.check(
        makeCtx({ intent: 'research', briefMd: 'No evidence.', eaPlanSubmissionId: undefined })
      );
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.mode).toBe('hard-fail');
    });

    it('soft-fails when grace period is active', async () => {
      const v = await eaAgentGatePolicy.check(
        makeCtx({
          intent: 'spec',
          briefMd: 'No evidence.',
          eaPlanSubmissionId: undefined,
          metadata: { eaGateGracePeriod: true }
        })
      );
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.mode).toBe('soft-fail');
    });

    it('fails build intent when architecture-significant', async () => {
      const v = await eaAgentGatePolicy.check(
        makeCtx({
          intent: 'build',
          targetRepos: ['caia-ea/decisions/ADR-099.md'],
          eaPlanSubmissionId: undefined,
          briefMd: 'No evidence.'
        })
      );
      expect(v.ok).toBe(false);
    });
  });

  describe('helper', () => {
    it('findSubmissionEvidence picks up frontmatter submissionId', () => {
      const md = 'submissionId: pl-2026-05-25-01\n\nBody.';
      const ev = findSubmissionEvidence(
        makeCtx({ briefMd: md, eaPlanSubmissionId: undefined })
      );
      expect(ev.length).toBeGreaterThan(0);
    });
  });
});
