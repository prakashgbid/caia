import { describe, expect, it } from 'vitest';
import { noIdleResearchPolicy } from '../../src/policies/no-idle-research.js';
import { makeCtx } from '../fixtures.js';

describe('no-idle-research policy', () => {
  describe('pass cases', () => {
    it('passes for non-report briefs (intent=build, no "## Status")', async () => {
      const v = await noIdleResearchPolicy.check(
        makeCtx({ intent: 'build', briefMd: 'Implement feature X.' })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when research brief has "## Next dispatch"', async () => {
      const v = await noIdleResearchPolicy.check(
        makeCtx({
          intent: 'research',
          briefMd: '# Report\n\nFindings.\n\n## Next dispatch\n\n- task A'
        })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when brief has "next dispatch:" inline', async () => {
      const v = await noIdleResearchPolicy.check(
        makeCtx({
          intent: 'research',
          briefMd: 'Done. next dispatch: wire policy-linter into chain-runner.'
        })
      );
      expect(v.ok).toBe(true);
    });

    it('passes with explicit "no follow-up because <reason>"', async () => {
      const v = await noIdleResearchPolicy.check(
        makeCtx({
          intent: 'research',
          briefMd: 'Completion report. no follow-up because the dispatched work is now self-contained.'
        })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when "operator decision needed" is present', async () => {
      const v = await noIdleResearchPolicy.check(
        makeCtx({
          intent: 'research',
          briefMd: '# Findings\n\nResults shown. operator decision needed on path A vs B.'
        })
      );
      expect(v.ok).toBe(true);
    });
  });

  describe('fail cases', () => {
    it('fails when research brief has no follow-up marker', async () => {
      const v = await noIdleResearchPolicy.check(
        makeCtx({
          intent: 'research',
          briefMd: '# Findings\n\nResults shown.\n\nThe end.'
        })
      );
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.mode).toBe('soft-fail');
    });

    it('fails when build brief looks like a completion report with no follow-up', async () => {
      const v = await noIdleResearchPolicy.check(
        makeCtx({
          intent: 'build',
          briefMd: '# Results\n\nTask completed. All tests passing.'
        })
      );
      expect(v.ok).toBe(false);
    });

    it('fails when brief has "## Status" with no next steps', async () => {
      const v = await noIdleResearchPolicy.check(
        makeCtx({
          intent: 'build',
          briefMd: '## Status\n\nWork completed. No further action.'
        })
      );
      expect(v.ok).toBe(false);
    });

    it('fails when brief mentions "completion report" with no marker', async () => {
      const v = await noIdleResearchPolicy.check(
        makeCtx({
          intent: 'build',
          briefMd: 'This is a completion report. Done.'
        })
      );
      expect(v.ok).toBe(false);
    });
  });

  describe('remediation', () => {
    it('suggestedFix recommends "## Next dispatch" section', async () => {
      const v = await noIdleResearchPolicy.check(
        makeCtx({
          intent: 'research',
          briefMd: '# Findings\n\nResults.'
        })
      );
      if (v.ok) throw new Error('expected fail');
      expect(v.suggestedFix).toMatch(/## Next dispatch/);
    });
  });
});
