import { describe, expect, it } from 'vitest';
import {
  autoMergePrsPolicy,
  isOperatorRepo
} from '../../src/policies/auto-merge-prs.js';
import { makeCtx } from '../fixtures.js';

describe('auto-merge-prs policy', () => {
  describe('isOperatorRepo helper', () => {
    it('detects caia/* repos', () => {
      expect(isOperatorRepo('caia/policy-linter')).toBe(true);
    });
    it('detects @caia/* package names', () => {
      expect(isOperatorRepo('@caia/ea-architect')).toBe(true);
    });
    it('detects chiefaia namespace', () => {
      expect(isOperatorRepo('chiefaia/events')).toBe(true);
    });
    it('rejects third-party repos', () => {
      expect(isOperatorRepo('octocat/hello-world')).toBe(false);
    });
    it('honours extra namespaces parameter', () => {
      expect(isOperatorRepo('orgX/foo', ['orgX'])).toBe(true);
    });
  });

  describe('pass cases', () => {
    it('passes on non-operator-owned repo even with passive phrasing', async () => {
      const v = await autoMergePrsPolicy.check(
        makeCtx({
          targetRepos: ['third-party/foo'],
          briefMd: 'Waiting on operator to merge.'
        })
      );
      expect(v.ok).toBe(true);
    });

    it('passes on operator repo with no passive phrasing', async () => {
      const v = await autoMergePrsPolicy.check(
        makeCtx({
          targetRepos: ['caia'],
          briefMd: 'PR opened. Admin-merging now per ADR-005.'
        })
      );
      expect(v.ok).toBe(true);
    });
  });

  describe('fail cases', () => {
    it('fails on "waiting on operator to merge"', async () => {
      const v = await autoMergePrsPolicy.check(
        makeCtx({
          targetRepos: ['caia'],
          briefMd: 'I will wait on operator to merge before proceeding.'
        })
      );
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.mode).toBe('hard-fail');
    });

    it('fails on "please merge"', async () => {
      const v = await autoMergePrsPolicy.check(
        makeCtx({
          targetRepos: ['caia'],
          briefMd: 'Please merge when you have a moment.'
        })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on "awaiting approval"', async () => {
      const v = await autoMergePrsPolicy.check(
        makeCtx({
          targetRepos: ['@caia/policy-linter'],
          briefMd: 'PR opened, awaiting approval.'
        })
      );
      expect(v.ok).toBe(false);
    });

    it('fails when phrasing is in PR body only', async () => {
      const v = await autoMergePrsPolicy.check(
        makeCtx({
          targetRepos: ['caia'],
          briefMd: 'Clean brief.',
          prBody: 'Waiting for operator merge.'
        })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on "needs operator review"', async () => {
      const v = await autoMergePrsPolicy.check(
        makeCtx({
          targetRepos: ['caia'],
          briefMd: 'This PR needs operator review.'
        })
      );
      expect(v.ok).toBe(false);
    });
  });

  describe('remediation', () => {
    it('suggestedFix references gh pr merge --admin', async () => {
      const v = await autoMergePrsPolicy.check(
        makeCtx({
          targetRepos: ['caia'],
          briefMd: 'Please merge.'
        })
      );
      if (v.ok) throw new Error('expected fail');
      expect(v.suggestedFix).toMatch(/gh pr merge --admin/);
    });
  });
});
