/**
 * Regression suite — rule-based decomposer must emit ≥3 stories for
 * fix / refactor / audit / extract phrasings.
 *
 * Triggered by the live-pipeline validation on 2026-04-30 where 3/10
 * prompts (bug-fix, refactor, test-heavy) stalled at `test_designed`
 * with 0 stories because the decomposer's only verb template was
 * "Implement core / Add UI/UX / Write tests / Document". This file
 * keeps that gap closed.
 */

import { describe, it, expect } from 'vitest';
import { decomposeRuleBased } from './rule-based';
import type { DecompositionNode } from './types';

function flattenStories(nodes: DecompositionNode[]): DecompositionNode[] {
  const out: DecompositionNode[] = [];
  const walk = (n: DecompositionNode) => {
    if (n.level === 'story') out.push(n);
    n.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

function getInitiativeMeta(
  nodes: DecompositionNode[],
): Record<string, unknown> | undefined {
  return nodes[0]?.metadata;
}

describe('rule-based decomposer — verb-widened templates', () => {
  // ─── The 3 prompts that stalled in live-pipeline validation 2026-04-30 ─

  describe('regression: 2026-04-30 stalled prompts must produce ≥3 stories', () => {
    it('bug-fix: "fix the login button not responsive on mobile"', () => {
      const prompt = '[VAL-2026-04-30-051730-2-bug-fix] fix the login button not responsive on mobile';
      const result = decomposeRuleBased(prompt);
      const stories = flattenStories(result.hierarchy);
      expect(stories.length).toBeGreaterThanOrEqual(3);
      expect(getInitiativeMeta(result.hierarchy)?.['verbIntent']).toBe('fix');
      // Stories should follow the fix template (root-cause / repro / fix / verify).
      const titles = stories.map((s) => s.title.toLowerCase()).join(' | ');
      expect(titles).toContain('investigate root cause');
      expect(titles).toContain('reproducing test');
      expect(titles).toContain('apply the fix');
    });

    it('refactor: "extract the user-auth logic into a reusable @chiefaia/auth-core package"', () => {
      const prompt =
        '[VAL-2026-04-30-051730-5-refactor] extract the user-auth logic into a reusable @chiefaia/auth-core package - every app currently duplicates the JWT parsing and session validation; consolidate behind a typed API';
      const result = decomposeRuleBased(prompt);
      const stories = flattenStories(result.hierarchy);
      expect(stories.length).toBeGreaterThanOrEqual(3);
      // "extract" wins over "refactor" because it's more specific.
      expect(getInitiativeMeta(result.hierarchy)?.['verbIntent']).toBe('extract');
      const titles = stories.map((s) => s.title.toLowerCase()).join(' | ');
      expect(titles).toContain('extraction surface');
      expect(titles).toContain('move the unit');
      expect(titles).toContain('update consumers');
    });

    it('test-heavy: "add an accessibility audit pipeline + WCAG 2.1 AA conformance tests"', () => {
      const prompt =
        '[VAL-2026-04-30-051730-9-test-heavy] add an accessibility audit pipeline + WCAG 2.1 AA conformance tests for every public route';
      const result = decomposeRuleBased(prompt);
      const stories = flattenStories(result.hierarchy);
      expect(stories.length).toBeGreaterThanOrEqual(3);
      // "audit" wins because of the "audit pipeline" + "wcag" + "accessibility audit" signals.
      expect(getInitiativeMeta(result.hierarchy)?.['verbIntent']).toBe('audit');
      const titles = stories.map((s) => s.title.toLowerCase()).join(' | ');
      expect(titles).toContain('enumerate audit scope');
      expect(titles).toContain('automated checks');
      expect(titles).toContain('audit report');
    });
  });

  // ─── verb classification ──────────────────────────────────────────────

  describe('verb intent classification', () => {
    it('classifies "fix the X" as fix', () => {
      const r = decomposeRuleBased('fix the broken authentication flow');
      expect(getInitiativeMeta(r.hierarchy)?.['verbIntent']).toBe('fix');
    });

    it('classifies "refactor X" as refactor', () => {
      const r = decomposeRuleBased('refactor the monolithic UserService into smaller services');
      expect(getInitiativeMeta(r.hierarchy)?.['verbIntent']).toBe('refactor');
    });

    it('classifies "extract Y from Z" as extract (more specific than refactor)', () => {
      const r = decomposeRuleBased('extract the email-sending logic into its own package');
      expect(getInitiativeMeta(r.hierarchy)?.['verbIntent']).toBe('extract');
    });

    it('classifies "audit the X" as audit', () => {
      const r = decomposeRuleBased('audit the API surface for breaking-change risk');
      expect(getInitiativeMeta(r.hierarchy)?.['verbIntent']).toBe('audit');
    });

    it('classifies plain "add X" as add (default feature template)', () => {
      const r = decomposeRuleBased('add a logout button to the navbar');
      expect(getInitiativeMeta(r.hierarchy)?.['verbIntent']).toBe('add');
    });

    it('a "review for security issues" classifies as audit, not add', () => {
      const r = decomposeRuleBased('review the dependency tree for security issues');
      expect(getInitiativeMeta(r.hierarchy)?.['verbIntent']).toBe('audit');
    });
  });

  // ─── per-verb story shape ────────────────────────────────────────────

  describe('per-verb story templates', () => {
    it('fix produces investigate / repro / fix / verify steps', () => {
      const r = decomposeRuleBased('fix the slow dashboard render');
      const stories = flattenStories(r.hierarchy);
      expect(stories.length).toBe(4);
      const titles = stories.map((s) => s.title.toLowerCase());
      expect(titles[0]).toContain('investigate root cause');
      expect(titles[1]).toContain('reproducing test');
      expect(titles[2]).toContain('apply the fix');
      expect(titles[3]).toContain('verify');
    });

    it('refactor produces boundaries / characterisation / incremental / verify steps', () => {
      const r = decomposeRuleBased('refactor the legacy billing module');
      const stories = flattenStories(r.hierarchy);
      expect(stories.length).toBe(4);
      const titles = stories.map((s) => s.title.toLowerCase());
      expect(titles[0]).toContain('identify boundaries');
      expect(titles[1]).toContain('characterisation tests');
      expect(titles[2]).toContain('incremental commits');
      expect(titles[3]).toContain('behaviour unchanged');
    });

    it('extract produces map surface / move unit / update consumers / verify isolation steps', () => {
      const r = decomposeRuleBased('extract the JWT helpers into @chiefaia/auth-core');
      const stories = flattenStories(r.hierarchy);
      expect(stories.length).toBe(4);
      const titles = stories.map((s) => s.title.toLowerCase());
      expect(titles[0]).toContain('extraction surface');
      expect(titles[1]).toContain('move the unit');
      expect(titles[2]).toContain('update consumers');
      expect(titles[3]).toContain('isolation');
    });

    it('audit produces scope / automated / manual / report steps', () => {
      const r = decomposeRuleBased('audit the storage layer for PII handling');
      const stories = flattenStories(r.hierarchy);
      expect(stories.length).toBe(4);
      const titles = stories.map((s) => s.title.toLowerCase());
      expect(titles[0]).toContain('enumerate audit scope');
      expect(titles[1]).toContain('automated checks');
      expect(titles[2]).toContain('manual review');
      expect(titles[3]).toContain('audit report');
    });

    it('every fix/refactor/extract/audit story has acceptance criteria (≥2 each)', () => {
      const verbs = [
        'fix the login button',
        'refactor the user-auth module',
        'extract the cache layer',
        'audit the public API',
      ];
      for (const p of verbs) {
        const r = decomposeRuleBased(p);
        const stories = flattenStories(r.hierarchy);
        expect(stories.length).toBeGreaterThanOrEqual(3);
        for (const s of stories) {
          expect(s.acceptanceCriteria?.length ?? 0).toBeGreaterThanOrEqual(2);
        }
      }
    });
  });

  // ─── back-compat — the original "add" path still works ───────────────

  describe('back-compat: add-verb prompts unchanged in shape', () => {
    it('multi-section feature prompt still produces an epic per section', () => {
      const r = decomposeRuleBased(
        'add a user profile page with avatar upload and a display-name field',
      );
      // "and" splits into 3 sections → 3 epics, each with 2-4 stories
      expect(r.hierarchy[0]?.children?.length).toBeGreaterThanOrEqual(2);
      const stories = flattenStories(r.hierarchy);
      expect(stories.length).toBeGreaterThanOrEqual(4);
      expect(getInitiativeMeta(r.hierarchy)?.['verbIntent']).toBe('add');
    });
  });
});
