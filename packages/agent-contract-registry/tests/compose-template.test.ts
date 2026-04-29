import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { SectionContract, SectionSpec, StoryScope } from '@chiefaia/ticket-template';
import { ContractRegistry, composeTemplate, composeAllScopes } from '../src';

function spec(name: string, overrides: Partial<SectionSpec> = {}): SectionSpec {
  return {
    name,
    description: `desc ${name}`,
    purpose: `purpose ${name}`,
    dataShape: z.object({}).passthrough(),
    required: true,
    rubric: { severityOnFail: 'hard', fixHint: `fix ${name}` },
    examples: [{ good: {}, bad: {}, badRationale: 'r' }],
    ...overrides,
  };
}

function contract(
  contractId: string,
  ownerAgent: SectionContract['ownerAgent'],
  appliesTo: readonly StoryScope[],
  sections: readonly SectionSpec[],
): SectionContract {
  return { ownerAgent, contractId, version: '1.0.0', appliesTo, sections };
}

describe('composeTemplate — basic union', () => {
  it('returns empty composed template when registry is empty', () => {
    const reg = new ContractRegistry();
    const t = composeTemplate('story', { registry: reg });
    expect(t.scope).toBe('story');
    expect(t.sections.size).toBe(0);
    expect(t.warnings).toEqual([]);
    expect(t.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('includes only contracts whose appliesTo contains the scope', () => {
    const reg = new ContractRegistry();
    reg.register(contract('po', 'po', ['initiative', 'story'], [spec('scope')]));
    reg.register(contract('ba', 'ba', ['story', 'task'], [spec('acceptanceCriteria')]));
    reg.register(contract('td', 'test-design', ['story'], [spec('testCases')]));

    const init = composeTemplate('initiative', { registry: reg });
    expect([...init.sections.keys()]).toEqual(['scope']);

    const story = composeTemplate('story', { registry: reg });
    expect([...story.sections.keys()].sort()).toEqual([
      'acceptanceCriteria',
      'scope',
      'testCases',
    ]);

    const task = composeTemplate('task', { registry: reg });
    expect([...task.sections.keys()]).toEqual(['acceptanceCriteria']);
  });

  it('orders sections by agent-pipeline order then contractId', () => {
    const reg = new ContractRegistry();
    // Register out-of-order on purpose.
    reg.register(contract('td', 'test-design', ['story'], [spec('testCases')]));
    reg.register(contract('ea', 'ea', ['story'], [spec('architecturalInstructions')]));
    reg.register(contract('ba', 'ba', ['story'], [spec('acceptanceCriteria')]));
    reg.register(contract('po', 'po', ['story'], [spec('scope')]));

    const t = composeTemplate('story', { registry: reg });
    // Insertion order in the Map matches the sort: PO -> BA -> EA -> Test-Design.
    expect([...t.sections.keys()]).toEqual([
      'scope',
      'acceptanceCriteria',
      'architecturalInstructions',
      'testCases',
    ]);
  });
});

describe('composeTemplate — scope overrides', () => {
  it('applies scopeOverrides[scope] to rubric and required', () => {
    const reg = new ContractRegistry();
    reg.register(
      contract('po', 'po', ['initiative', 'story', 'subtask'], [
        spec('scope', {
          required: true,
          rubric: { minWords: 30, severityOnFail: 'hard', fixHint: 'fix' },
          scopeOverrides: {
            initiative: { minWords: 80 },
            subtask: { required: false, minWords: 10 },
          },
        }),
      ]),
    );

    const init = composeTemplate('initiative', { registry: reg }).sections.get('scope')!;
    expect(init.effectiveRubric.minWords).toBe(80);
    expect(init.effectiveRequired).toBe(true);

    const sub = composeTemplate('subtask', { registry: reg }).sections.get('scope')!;
    expect(sub.effectiveRubric.minWords).toBe(10);
    expect(sub.effectiveRequired).toBe(false);

    const story = composeTemplate('story', { registry: reg }).sections.get('scope')!;
    expect(story.effectiveRubric.minWords).toBe(30);
    expect(story.effectiveRequired).toBe(true);
  });
});

describe('composeTemplate — conflict resolution', () => {
  it('first contract by agent-pipeline order wins; later one warns', () => {
    const reg = new ContractRegistry();
    // Both BA and EA claim 'taxonomy' — pipeline order says BA wins.
    reg.register(contract('ba', 'ba', ['story'], [spec('taxonomy')]));
    reg.register(contract('ea', 'ea', ['story'], [spec('taxonomy')]));

    const t = composeTemplate('story', { registry: reg });
    expect(t.sections.get('taxonomy')!.ownerAgent).toBe('ba');
    expect(t.warnings).toHaveLength(1);
    expect(t.warnings[0]).toContain("section 'taxonomy' claimed by both ba");
    expect(t.warnings[0]).toContain('kept ba');
  });

  it('strict mode throws on conflict', () => {
    const reg = new ContractRegistry();
    reg.register(contract('ba', 'ba', ['story'], [spec('taxonomy')]));
    reg.register(contract('ea', 'ea', ['story'], [spec('taxonomy')]));
    expect(() => composeTemplate('story', { registry: reg, strict: true })).toThrow(
      /claimed by both/,
    );
  });

  it('contractId tie-break is alphabetical for stable output within same agent', () => {
    const reg = new ContractRegistry();
    reg.register(contract('po-z', 'po', ['story'], [spec('alpha')]));
    reg.register(contract('po-a', 'po', ['story'], [spec('beta')]));

    const t = composeTemplate('story', { registry: reg });
    // po-a comes before po-z; both have unique sections so both included.
    const order = [...t.sections.keys()];
    expect(order).toEqual(['beta', 'alpha']);
  });
});

describe('composeTemplate — dependencies', () => {
  it('warns when a section depends on a missing one', () => {
    const reg = new ContractRegistry();
    reg.register(
      contract('td', 'test-design', ['story'], [
        spec('testCases', { dependencies: ['acceptanceCriteria'] }),
      ]),
    );
    const t = composeTemplate('story', { registry: reg });
    expect(t.warnings.some((w) => w.includes("'testCases'"))).toBe(true);
    expect(t.warnings.some((w) => w.includes("'acceptanceCriteria'"))).toBe(true);
  });

  it('does not warn when the dependency is present', () => {
    const reg = new ContractRegistry();
    reg.register(contract('ba', 'ba', ['story'], [spec('acceptanceCriteria')]));
    reg.register(
      contract('td', 'test-design', ['story'], [
        spec('testCases', { dependencies: ['acceptanceCriteria'] }),
      ]),
    );
    const t = composeTemplate('story', { registry: reg });
    expect(t.warnings).toEqual([]);
  });

  it('strict mode throws on unresolved dependency', () => {
    const reg = new ContractRegistry();
    reg.register(
      contract('td', 'test-design', ['story'], [
        spec('testCases', { dependencies: ['acceptanceCriteria'] }),
      ]),
    );
    expect(() => composeTemplate('story', { registry: reg, strict: true })).toThrow(
      /depends on/,
    );
  });
});

describe('composeTemplate — signature stability', () => {
  it('identical inputs produce identical signatures', () => {
    const buildReg = () => {
      const r = new ContractRegistry();
      r.register(contract('po', 'po', ['story'], [spec('scope')]));
      r.register(contract('ba', 'ba', ['story'], [spec('acceptanceCriteria')]));
      return r;
    };
    const a = composeTemplate('story', { registry: buildReg() });
    const b = composeTemplate('story', { registry: buildReg() });
    expect(a.signature).toBe(b.signature);
  });

  it('signature changes when a rubric field changes', () => {
    const r1 = new ContractRegistry();
    r1.register(contract('po', 'po', ['story'], [
      spec('scope', { rubric: { severityOnFail: 'hard', fixHint: 'fix', minWords: 30 } }),
    ]));
    const r2 = new ContractRegistry();
    r2.register(contract('po', 'po', ['story'], [
      spec('scope', { rubric: { severityOnFail: 'hard', fixHint: 'fix', minWords: 60 } }),
    ]));
    const a = composeTemplate('story', { registry: r1 });
    const b = composeTemplate('story', { registry: r2 });
    expect(a.signature).not.toBe(b.signature);
  });

  it('signature is sensitive to scope', () => {
    const r = new ContractRegistry();
    r.register(contract('po', 'po', ['story', 'epic'], [spec('scope')]));
    const a = composeTemplate('story', { registry: r });
    const b = composeTemplate('epic', { registry: r });
    expect(a.signature).not.toBe(b.signature);
  });
});

describe('composeAllScopes', () => {
  it('returns a composed template per canonical scope', () => {
    const reg = new ContractRegistry();
    reg.register(contract('po', 'po', ['initiative', 'epic', 'module', 'story', 'task', 'subtask'], [spec('scope')]));
    const all = composeAllScopes({ registry: reg });
    expect(Object.keys(all).sort()).toEqual(
      ['initiative', 'epic', 'module', 'story', 'task', 'subtask'].sort(),
    );
    for (const t of Object.values(all)) {
      expect(t.sections.has('scope')).toBe(true);
    }
  });
});
