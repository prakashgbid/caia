/**
 * @chiefaia/ticket-template — section-contract.test.ts (ACR-001)
 *
 * Unit coverage for SectionContract / StoryScope primitives. These types
 * underpin the Agent Section Contract Registry — the goal of these tests
 * is to prove the data shapes + helper functions behave as the Validator
 * (and `composeTemplate` in @chiefaia/agent-contract-registry) will rely
 * on them at runtime.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  STORY_SCOPES,
  STORY_SCOPE_ORDER,
  isStoryScope,
  DEFAULT_STORY_SCOPE,
  AGENT_ROLES,
  AGENT_ORDER,
  applyScopeOverride,
  compareScopes,
  isScopeAtLeastAsCoarseAs,
  type SectionSpec,
  type SectionContract,
  type StoryScope,
} from './section-contract';

describe('StoryScope', () => {
  it('exports the six canonical scopes in coarse-to-fine order', () => {
    expect(STORY_SCOPES).toEqual([
      'initiative',
      'epic',
      'module',
      'story',
      'task',
      'subtask',
    ]);
  });

  it('STORY_SCOPE_ORDER is a strict ordering with initiative coarsest, subtask finest', () => {
    const ordered = (STORY_SCOPES as readonly StoryScope[])
      .map((s) => STORY_SCOPE_ORDER[s])
      .every((n, i, arr) => i === 0 || arr[i - 1]! < n);
    expect(ordered).toBe(true);
    expect(STORY_SCOPE_ORDER.initiative).toBe(0);
    expect(STORY_SCOPE_ORDER.subtask).toBe(STORY_SCOPES.length - 1);
  });

  it('isStoryScope returns true for canonical values, false otherwise', () => {
    for (const s of STORY_SCOPES) expect(isStoryScope(s)).toBe(true);
    expect(isStoryScope('feature')).toBe(false);
    expect(isStoryScope('')).toBe(false);
    expect(isStoryScope(null)).toBe(false);
    expect(isStoryScope(undefined)).toBe(false);
    expect(isStoryScope(42)).toBe(false);
    expect(isStoryScope({ scope: 'story' })).toBe(false);
  });

  it("DEFAULT_STORY_SCOPE is 'story' — matches ACR-008 backfill default", () => {
    expect(DEFAULT_STORY_SCOPE).toBe('story');
    expect(isStoryScope(DEFAULT_STORY_SCOPE)).toBe(true);
  });
});

describe('AgentRole', () => {
  it('exports the four pipeline-canonical roles', () => {
    expect(AGENT_ROLES).toEqual(['po', 'ba', 'ea', 'test-design']);
  });

  it('AGENT_ORDER reflects pipeline order PO -> BA -> EA -> Test-Design', () => {
    expect(AGENT_ORDER.po).toBeLessThan(AGENT_ORDER.ba);
    expect(AGENT_ORDER.ba).toBeLessThan(AGENT_ORDER.ea);
    expect(AGENT_ORDER.ea).toBeLessThan(AGENT_ORDER['test-design']);
  });
});

describe('compareScopes / isScopeAtLeastAsCoarseAs', () => {
  it('compareScopes returns negative when first is coarser', () => {
    expect(compareScopes('initiative', 'story')).toBeLessThan(0);
    expect(compareScopes('story', 'initiative')).toBeGreaterThan(0);
    expect(compareScopes('story', 'story')).toBe(0);
  });

  it('isScopeAtLeastAsCoarseAs identifies coarser-or-equal correctly', () => {
    expect(isScopeAtLeastAsCoarseAs('initiative', 'story')).toBe(true);
    expect(isScopeAtLeastAsCoarseAs('story', 'story')).toBe(true);
    expect(isScopeAtLeastAsCoarseAs('task', 'story')).toBe(false);
    expect(isScopeAtLeastAsCoarseAs('subtask', 'task')).toBe(false);
    expect(isScopeAtLeastAsCoarseAs('module', 'task')).toBe(true);
  });
});

// ─── applyScopeOverride ────────────────────────────────────────────────────

const baseSpec: SectionSpec = {
  name: 'scope',
  description: 'What the work will and will not deliver.',
  purpose: 'Defines the observable outcome and prevents scope creep.',
  dataShape: z.object({}).passthrough(),
  required: true,
  rubric: {
    minWords: 30,
    severityOnFail: 'hard',
    fixHint: 'Expand to a one-sentence outcome + concrete in/out lists.',
  },
  examples: [
    {
      good: { summary: 'Add Stripe checkout' },
      bad: { summary: 'TBD' },
      badRationale: 'Placeholder summary.',
    },
  ],
};

describe('applyScopeOverride', () => {
  it('returns base rubric + required when no override exists for the scope', () => {
    const out = applyScopeOverride(baseSpec, 'story');
    expect(out.effectiveRubric).toBe(baseSpec.rubric);
    expect(out.effectiveRequired).toBe(true);
  });

  it('shallow-merges rubric override fields over the base rubric', () => {
    const spec: SectionSpec = {
      ...baseSpec,
      scopeOverrides: {
        initiative: { minWords: 80 },
        subtask: { minWords: 10, fixHint: 'Subtasks need only 10 words.' },
      },
    };
    const init = applyScopeOverride(spec, 'initiative');
    expect(init.effectiveRubric.minWords).toBe(80);
    expect(init.effectiveRubric.severityOnFail).toBe('hard');
    expect(init.effectiveRubric.fixHint).toBe(baseSpec.rubric.fixHint);
    expect(init.effectiveRequired).toBe(true);

    const sub = applyScopeOverride(spec, 'subtask');
    expect(sub.effectiveRubric.minWords).toBe(10);
    expect(sub.effectiveRubric.fixHint).toBe('Subtasks need only 10 words.');
  });

  it('overrides required when scopeOverrides specifies it', () => {
    const spec: SectionSpec = {
      ...baseSpec,
      required: false,
      scopeOverrides: {
        initiative: { required: true, minWords: 60 },
        story: { required: false },
      },
    };
    expect(applyScopeOverride(spec, 'initiative').effectiveRequired).toBe(true);
    expect(applyScopeOverride(spec, 'story').effectiveRequired).toBe(false);
    expect(applyScopeOverride(spec, 'task').effectiveRequired).toBe(false);
  });

  it('keeps base rubric reference intact (does not mutate)', () => {
    const spec: SectionSpec = {
      ...baseSpec,
      scopeOverrides: { initiative: { minWords: 80 } },
    };
    const before = { ...spec.rubric };
    applyScopeOverride(spec, 'initiative');
    expect(spec.rubric).toEqual(before);
  });
});

// ─── SectionContract structural tests ──────────────────────────────────────

describe('SectionContract structural', () => {
  it('a minimal contract type-checks with one section', () => {
    const contract: SectionContract = {
      ownerAgent: 'po',
      contractId: 'po-agent.v1',
      version: '1.0.0',
      appliesTo: ['initiative', 'story'],
      sections: [baseSpec],
    };
    expect(contract.ownerAgent).toBe('po');
    expect(contract.sections).toHaveLength(1);
    expect(contract.appliesTo).toContain('story');
  });

  it('contract appliesTo can be subset of all scopes', () => {
    const contract: SectionContract = {
      ownerAgent: 'test-design',
      contractId: 'test-design-agent.v1',
      version: '1.0.0',
      appliesTo: ['story', 'task'],
      sections: [],
    };
    expect(contract.appliesTo).not.toContain('initiative');
    expect(contract.appliesTo).toContain('story');
  });

  it('section dependencies field is optional', () => {
    const withoutDeps: SectionSpec = baseSpec;
    const withDeps: SectionSpec = { ...baseSpec, dependencies: ['acceptanceCriteria'] };
    expect(withoutDeps.dependencies).toBeUndefined();
    expect(withDeps.dependencies).toEqual(['acceptanceCriteria']);
  });
});
