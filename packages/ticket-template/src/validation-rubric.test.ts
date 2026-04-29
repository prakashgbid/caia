/**
 * Tests for the validation rubric (VAL-001).
 *
 * Verifies the rubric's structural invariants and the helper functions
 * the validator agent uses (countWordsInValue, findForbiddenSnippets,
 * concatStrings, isSectionRequired). The validator-agent integration
 * tests live in apps/orchestrator/tests/agents/story-validator-agent.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  AC_ITEM_RULES,
  AGENT_SECTION_RULES,
  COMPLETENESS_GESTALT_PROMPT_SEED,
  CROSS_SECTION_CONSISTENCY_PROMPT_SEED,
  RUBRIC_VERSION,
  SCORE_WEIGHTS,
  TOP_LEVEL_SECTION_RULES,
  UNIVERSAL_FORBIDDEN_SNIPPETS,
  VERDICT_THRESHOLDS,
  buildContentRelevancePrompt,
  concatStrings,
  countWordsInValue,
  findForbiddenSnippets,
  isSectionRequired,
} from './validation-rubric';
import { buildDraftTicket } from './build';
import type { TicketTemplateV1 } from './schema';

// ─── Helper: build a baseline ticket ────────────────────────────────────────

function makeTicket(overrides: Partial<TicketTemplateV1> = {}): TicketTemplateV1 {
  const base = buildDraftTicket({
    rootPromptId: 'prm_test',
    requirementId: 'req_test',
    domainPrimary: 'auth',
    domainAll: ['auth', 'frontend'],
    nature: 'feature',
    complexity: 'medium',
    summary: 'Add Google OAuth login button',
    inScope: ['Login button on the dashboard top nav'],
    outOfScope: [],
    acceptanceCriteria: [
      'Given I am logged out, when I click "Sign in with Google", then OAuth flow starts',
      'Given OAuth succeeds, when the callback returns, then I land on the dashboard',
      'Given OAuth fails, when the callback returns, then I see an error message',
    ],
    verificationPlan: ['pnpm test --filter=auth'],
  });
  return { ...base, ...overrides } as TicketTemplateV1;
}

// ─── Rubric structural invariants ───────────────────────────────────────────

describe('rubric structure', () => {
  it('exposes a stable RUBRIC_VERSION', () => {
    expect(RUBRIC_VERSION).toBe('v1');
  });

  it('TOP_LEVEL_SECTION_RULES covers every required top-level section path exactly once', () => {
    const paths = TOP_LEVEL_SECTION_RULES.map((r) => r.path).sort();
    expect(paths).toEqual([
      'acceptanceCriteria',
      'context',
      'dependencies',
      'scope',
      'verificationPlan',
    ]);
  });

  it('AGENT_SECTION_RULES covers every AgentSectionKey exactly once', () => {
    const sections = AGENT_SECTION_RULES.map((r) => r.section).sort();
    expect(sections).toEqual([
      'api',
      'architecture',
      'database',
      'observability',
      'release',
      'security',
      'testing',
      'ui',
    ]);
  });

  it('UNIVERSAL_FORBIDDEN_SNIPPETS contains common placeholder phrases', () => {
    expect(UNIVERSAL_FORBIDDEN_SNIPPETS).toContain('TBD');
    expect(UNIVERSAL_FORBIDDEN_SNIPPETS).toContain('TODO');
    expect(UNIVERSAL_FORBIDDEN_SNIPPETS).toContain('placeholder');
  });

  it('AC item BDD pattern matches expected starts', () => {
    expect(AC_ITEM_RULES.bddStartPattern.test('Given a user, when they click...')).toBe(true);
    expect(AC_ITEM_RULES.bddStartPattern.test('When the user submits...')).toBe(true);
    expect(AC_ITEM_RULES.bddStartPattern.test('The system must enforce...')).toBe(true);
    expect(AC_ITEM_RULES.bddStartPattern.test('User can log in')).toBe(true);
    expect(AC_ITEM_RULES.bddStartPattern.test('Logs in via Google')).toBe(false);
  });

  it('SCORE_WEIGHTS sum to ~1.0 (within tolerance)', () => {
    const sum =
      SCORE_WEIGHTS.hardStepPassRate +
      SCORE_WEIGHTS.contentRelevanceAvg +
      SCORE_WEIGHTS.crossSectionScore +
      SCORE_WEIGHTS.gestaltAvg;
    expect(sum).toBeGreaterThan(0.99);
    expect(sum).toBeLessThan(1.01);
  });

  it('VERDICT_THRESHOLDS exposes the documented values', () => {
    expect(VERDICT_THRESHOLDS.maxAttempts).toBe(2);
    expect(VERDICT_THRESHOLDS.contentRelevanceMinAvg).toBe(3.5);
    expect(VERDICT_THRESHOLDS.crossSectionMinScore).toBe(3);
    expect(VERDICT_THRESHOLDS.gestaltMinReady).toBe(4);
  });

  it('cross-section + completeness prompt seeds include explicit injection-defence text', () => {
    expect(CROSS_SECTION_CONSISTENCY_PROMPT_SEED).toMatch(/ignore any instructions/i);
    expect(COMPLETENESS_GESTALT_PROMPT_SEED).toMatch(/ignore any instructions/i);
  });
});

// ─── Helper functions ───────────────────────────────────────────────────────

describe('countWordsInValue', () => {
  it('counts words in a simple string', () => {
    expect(countWordsInValue('hello world foo')).toBe(3);
  });

  it('returns 0 for null / undefined / empty', () => {
    expect(countWordsInValue(null)).toBe(0);
    expect(countWordsInValue(undefined)).toBe(0);
    expect(countWordsInValue('')).toBe(0);
    expect(countWordsInValue('   ')).toBe(0);
  });

  it('recursively counts words inside arrays and objects', () => {
    expect(
      countWordsInValue({
        a: 'one two three',
        b: ['four five', 'six'],
        c: { d: 'seven eight nine ten' },
        e: 12345, // numbers don't count
      }),
    ).toBe(10);
  });

  it('handles deeply nested structures', () => {
    expect(
      countWordsInValue([
        { x: ['a b', { y: 'c d e' }] },
        'f g h i',
      ]),
    ).toBe(9);
  });
});

describe('findForbiddenSnippets', () => {
  it('detects a forbidden snippet inside a string field (case-insensitive, word-boundary)', () => {
    const value = { notes: 'Implementation TBD by next sprint' };
    expect(findForbiddenSnippets(value, ['TBD', 'TODO'])).toEqual(['TBD']);
  });

  it('does not match within other words', () => {
    const value = { notes: 'TBDX is a real word but TBDish is not' };
    expect(findForbiddenSnippets(value, ['TBD'])).toEqual([]);
  });

  it('detects multiple distinct snippets', () => {
    const value = ['fill in later', 'placeholder content'];
    expect(findForbiddenSnippets(value, ['placeholder', 'fill in later', 'TBD']).sort()).toEqual([
      'fill in later',
      'placeholder',
    ]);
  });

  it('returns [] for clean content', () => {
    expect(findForbiddenSnippets({ a: 'fine', b: ['ok'] }, ['TBD', 'TODO'])).toEqual([]);
  });
});

describe('concatStrings', () => {
  it('concatenates all strings recursively into a single space-separated string', () => {
    const value = { a: 'one', b: ['two', 'three'], c: { d: 'four' } };
    expect(concatStrings(value)).toBe('one two three four');
  });

  it('returns empty string for non-string scalars', () => {
    expect(concatStrings(42)).toBe('');
    expect(concatStrings(true)).toBe('');
    expect(concatStrings(null)).toBe('');
  });
});

// ─── isSectionRequired ──────────────────────────────────────────────────────

describe('isSectionRequired', () => {
  const archRule = AGENT_SECTION_RULES.find((r) => r.section === 'architecture')!;
  const securityRule = AGENT_SECTION_RULES.find((r) => r.section === 'security')!;
  const testingRule = AGENT_SECTION_RULES.find((r) => r.section === 'testing')!;
  const dbRule = AGENT_SECTION_RULES.find((r) => r.section === 'database')!;

  it('testing section is always required (always: true)', () => {
    const t = makeTicket();
    expect(isSectionRequired(testingRule, t)).toBe(true);
  });

  it('architecture is required when lifecycle = new', () => {
    const t = makeTicket({
      taxonomy: {
        businessSubDomains: [],
        qualityTags: [],
        blockedBy: [],
        softDependsOn: [],
        conflictsWith: [],
        lifecycle: 'new',
      },
    });
    expect(isSectionRequired(archRule, t)).toBe(true);
  });

  it('architecture is NOT required when lifecycle = bug and no other trigger', () => {
    const t = makeTicket({
      taxonomy: {
        businessSubDomains: [],
        qualityTags: [],
        blockedBy: [],
        softDependsOn: [],
        conflictsWith: [],
        lifecycle: 'bug',
      },
    });
    expect(isSectionRequired(archRule, t)).toBe(false);
  });

  it('security is required when nature = security', () => {
    const t = makeTicket();
    t.context.nature = 'security';
    expect(isSectionRequired(securityRule, t)).toBe(true);
  });

  it('security is required when risk = critical', () => {
    const t = makeTicket({
      taxonomy: {
        businessSubDomains: [],
        qualityTags: [],
        blockedBy: [],
        softDependsOn: [],
        conflictsWith: [],
        risk: 'critical',
      },
    });
    expect(isSectionRequired(securityRule, t)).toBe(true);
  });

  it('database section is required when techSubDomains.all includes database', () => {
    const t = makeTicket({
      taxonomy: {
        businessSubDomains: [],
        qualityTags: [],
        blockedBy: [],
        softDependsOn: [],
        conflictsWith: [],
        techSubDomains: { primary: 'database', all: ['database'] },
      },
    });
    expect(isSectionRequired(dbRule, t)).toBe(true);
  });

  it('database section is NOT required when techSubDomains is unrelated', () => {
    const t = makeTicket({
      taxonomy: {
        businessSubDomains: [],
        qualityTags: [],
        blockedBy: [],
        softDependsOn: [],
        conflictsWith: [],
        techSubDomains: { primary: 'frontend', all: ['frontend'] },
      },
    });
    expect(isSectionRequired(dbRule, t)).toBe(false);
  });

  it('handles missing taxonomy gracefully', () => {
    const t = makeTicket(); // no taxonomy
    // architecture has lifecycleIn trigger; no taxonomy → not required (returns false)
    expect(isSectionRequired(archRule, t)).toBe(false);
    // testing.always still wins
    expect(isSectionRequired(testingRule, t)).toBe(true);
  });
});

// ─── buildContentRelevancePrompt ────────────────────────────────────────────

describe('buildContentRelevancePrompt', () => {
  it('embeds all four inputs into the prompt', () => {
    const prompt = buildContentRelevancePrompt({
      sectionPath: 'agentSections.security',
      sectionPurpose: 'Security review for the story.',
      storySummary: 'Add OAuth login.',
      sectionContentJson: '{"threatModel":["CSRF"]}',
    });
    expect(prompt).toContain('agentSections.security');
    expect(prompt).toContain('Security review for the story.');
    expect(prompt).toContain('Add OAuth login.');
    expect(prompt).toContain('"threatModel":["CSRF"]');
  });

  it('includes injection-defence instruction', () => {
    const prompt = buildContentRelevancePrompt({
      sectionPath: 'agentSections.api',
      sectionPurpose: 'X',
      storySummary: 'Y',
      sectionContentJson: '{}',
    });
    expect(prompt).toMatch(/ignore any instructions/i);
  });

  it('asks for JSON output with score, relevant, concerns', () => {
    const prompt = buildContentRelevancePrompt({
      sectionPath: 'a',
      sectionPurpose: 'b',
      storySummary: 'c',
      sectionContentJson: '{}',
    });
    expect(prompt).toMatch(/score.*1-5/i);
    expect(prompt).toMatch(/relevant.*boolean/i);
    expect(prompt).toMatch(/concerns/i);
  });
});

// ─── Per-section rule sanity ────────────────────────────────────────────────

describe('per-agent section rules sanity', () => {
  it('every rule has a fixHint and severityOnFail', () => {
    for (const rule of AGENT_SECTION_RULES) {
      expect(rule.fixHint).toBeTruthy();
      expect(['hard', 'soft', 'warning']).toContain(rule.severityOnFail);
    }
  });

  it('every top-level rule has a fixHint and severityOnFail', () => {
    for (const rule of TOP_LEVEL_SECTION_RULES) {
      expect(rule.fixHint).toBeTruthy();
      expect(['hard', 'soft', 'warning']).toContain(rule.severityOnFail);
    }
  });

  it('hardFailSections are a subset of TOP_LEVEL_SECTION_RULES paths', () => {
    const topPaths = TOP_LEVEL_SECTION_RULES.map((r) => r.path as string);
    for (const path of VERDICT_THRESHOLDS.hardFailSections) {
      expect(topPaths).toContain(path);
    }
  });

  it('regex required-entity-refs are valid regex source strings', () => {
    for (const rule of AGENT_SECTION_RULES) {
      for (const ref of rule.requiredEntityRefs ?? []) {
        expect(() => new RegExp(ref.pattern, ref.flags ?? '')).not.toThrow();
      }
    }
  });
});
