import { describe, expect, it } from 'vitest';
import {
  noCalendarTimeEstimatesPolicy,
  findCalendarTimeMatches
} from '../../src/policies/no-calendar-time-estimates.js';
import { makeCtx } from '../fixtures.js';

describe('no-calendar-time-estimates policy', () => {
  describe('pass cases', () => {
    it('passes on a brief with no calendar tokens', async () => {
      const v = await noCalendarTimeEstimatesPolicy.check(
        makeCtx({ briefMd: 'Pure prose. Nothing about time.' })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when ISO date headers are present (historical, not future)', async () => {
      const md = '## 2026-05-25 — events\n\nNothing scheduled.';
      const v = await noCalendarTimeEstimatesPolicy.check(makeCtx({ briefMd: md }));
      expect(v.ok).toBe(true);
    });

    it('passes when frontmatter contains submittedAt timestamp', async () => {
      const md = 'submittedAt: 2026-05-25T00:00:00Z\n\nBody text.';
      const v = await noCalendarTimeEstimatesPolicy.check(makeCtx({ briefMd: md }));
      expect(v.ok).toBe(true);
    });

    it('does not match identifiers like daysOfWeek (word boundary)', async () => {
      const md = 'Use the daysOfWeek constant from the lib.';
      const v = await noCalendarTimeEstimatesPolicy.check(makeCtx({ briefMd: md }));
      expect(v.ok).toBe(true);
    });
  });

  describe('fail cases', () => {
    it('fails on "by Friday" phrasing', async () => {
      const v = await noCalendarTimeEstimatesPolicy.check(
        makeCtx({ briefMd: 'Land this by Friday.' })
      );
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.mode).toBe('soft-fail');
        expect(v.evidence?.length).toBeGreaterThan(0);
      }
    });

    it('fails on "3 days" numeric estimate', async () => {
      const v = await noCalendarTimeEstimatesPolicy.check(
        makeCtx({ briefMd: 'Should take 3 days.' })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on "2-3 weeks" range estimate', async () => {
      const v = await noCalendarTimeEstimatesPolicy.check(
        makeCtx({ briefMd: 'Plan: 2-3 weeks of effort.' })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on "next sprint" phrasing', async () => {
      const v = await noCalendarTimeEstimatesPolicy.check(
        makeCtx({ briefMd: 'Defer to next sprint.' })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on "Q3 2026" quarter reference', async () => {
      const v = await noCalendarTimeEstimatesPolicy.check(
        makeCtx({ briefMd: 'Ship in Q3 2026.' })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on "in 4 hours" duration', async () => {
      const v = await noCalendarTimeEstimatesPolicy.check(
        makeCtx({ briefMd: 'Complete in 4 hours please.' })
      );
      expect(v.ok).toBe(false);
    });
  });

  describe('remediation', () => {
    it('provides suggestedFix referencing dependency ordering', async () => {
      const v = await noCalendarTimeEstimatesPolicy.check(
        makeCtx({ briefMd: 'Land by Monday.' })
      );
      if (v.ok) throw new Error('expected fail');
      expect(v.suggestedFix).toBeDefined();
      expect(v.suggestedFix).toMatch(/dependency ordering/i);
    });

    it('reports evidence with line numbers', async () => {
      const md = 'Line one.\nLine two: by Friday.\nLine three.';
      const v = await noCalendarTimeEstimatesPolicy.check(makeCtx({ briefMd: md }));
      if (v.ok) throw new Error('expected fail');
      expect(v.evidence?.[0]?.line).toBe(2);
    });

    it('caps evidence at 20 entries even when many matches present', () => {
      const md = Array.from({ length: 40 }, () => 'by Monday.').join('\n');
      const matches = findCalendarTimeMatches(md);
      expect(matches.length).toBeLessThanOrEqual(20);
    });
  });
});
