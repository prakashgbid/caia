import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { SectionContract, SectionSpec } from '@chiefaia/ticket-template';
import { ContractRegistry, composeTemplate } from '../src';
import { toValidationRubric } from '../src/validator-adapter';

function spec(name: string, overrides: Partial<SectionSpec> = {}): SectionSpec {
  return {
    name,
    description: `desc ${name}`,
    purpose: `purpose ${name}`,
    dataShape: z.object({}).passthrough(),
    required: true,
    rubric: {
      minWords: 20,
      severityOnFail: 'hard',
      fixHint: `fix ${name}`,
      forbiddenSnippets: ['TBD'],
    },
    examples: [{ good: {}, bad: {}, badRationale: 'r' }],
    ...overrides,
  };
}

function contract(
  contractId: string,
  ownerAgent: SectionContract['ownerAgent'],
  sections: readonly SectionSpec[],
): SectionContract {
  return {
    ownerAgent,
    contractId,
    version: '1.0.0',
    appliesTo: ['story'],
    sections,
  };
}

describe('toValidationRubric — partition by section path', () => {
  it('puts top-level paths into topLevelRules', () => {
    const reg = new ContractRegistry();
    reg.register(contract('po', 'po', [spec('scope'), spec('acceptanceCriteria')]));
    const out = toValidationRubric(composeTemplate('story', { registry: reg }));
    expect(out.topLevelRules.map((r) => r.path).sort()).toEqual([
      'acceptanceCriteria',
      'scope',
    ]);
    expect(out.agentSectionRules).toEqual([]);
    expect(out.otherSections).toEqual([]);
  });

  it('puts agentSections.* entries into agentSectionRules with stripped prefix', () => {
    const reg = new ContractRegistry();
    reg.register(
      contract('ba', 'ba', [
        spec('agentSections.api'),
        spec('agentSections.database'),
      ]),
    );
    const out = toValidationRubric(composeTemplate('story', { registry: reg }));
    expect(out.agentSectionRules.map((r) => r.section).sort()).toEqual([
      'api',
      'database',
    ]);
    expect(out.topLevelRules).toEqual([]);
    expect(out.otherSections).toEqual([]);
  });

  it('puts everything else into otherSections (with full name)', () => {
    const reg = new ContractRegistry();
    reg.register(
      contract('ea', 'ea', [
        spec('architecturalInstructions'),
        spec('taxonomy.lifecycle'),
        spec('claims'),
      ]),
    );
    const out = toValidationRubric(composeTemplate('story', { registry: reg }));
    expect(out.otherSections.map((r) => r.section).sort()).toEqual([
      'architecturalInstructions',
      'claims',
      'taxonomy.lifecycle',
    ]);
  });
});

describe('toValidationRubric — field mapping', () => {
  it('preserves severityOnFail, fixHint, ownerAgent, contractId', () => {
    const reg = new ContractRegistry();
    reg.register(contract('po', 'po', [spec('scope', {
      rubric: { severityOnFail: 'soft', fixHint: 'soften', minWords: 50 },
    })]));
    const out = toValidationRubric(composeTemplate('story', { registry: reg }));
    const top = out.topLevelRules[0]!;
    expect(top.severityOnFail).toBe('soft');
    expect(top.fixHint).toBe('soften');
    expect(top.minWords).toBe(50);
    expect(top.ownerAgent).toBe('po');
    expect(top.contractId).toBe('po');
  });

  it('forbidSnippets is true iff forbiddenSnippets has entries', () => {
    const reg = new ContractRegistry();
    reg.register(contract('po', 'po', [
      spec('scope'),
      spec('verificationPlan', {
        rubric: { severityOnFail: 'soft', fixHint: 'fix', forbiddenSnippets: [] },
      }),
    ]));
    const out = toValidationRubric(composeTemplate('story', { registry: reg }));
    const scope = out.topLevelRules.find((r) => r.path === 'scope')!;
    const vp = out.topLevelRules.find((r) => r.path === 'verificationPlan')!;
    expect(scope.forbidSnippets).toBe(true);
    expect(vp.forbidSnippets).toBe(false);
  });

  it('runContentRelevance is true iff relevancePromptSeed is set', () => {
    const reg = new ContractRegistry();
    reg.register(contract('po', 'po', [
      spec('scope', {
        rubric: { severityOnFail: 'hard', fixHint: 'fix', relevancePromptSeed: 'seed' },
      }),
      spec('context', {
        rubric: { severityOnFail: 'hard', fixHint: 'fix' },
      }),
    ]));
    const out = toValidationRubric(composeTemplate('story', { registry: reg }));
    expect(out.topLevelRules.find((r) => r.path === 'scope')!.runContentRelevance).toBe(true);
    expect(out.topLevelRules.find((r) => r.path === 'context')!.runContentRelevance).toBe(false);
  });

  it('preserves required flag from composition', () => {
    const reg = new ContractRegistry();
    reg.register(contract('po', 'po', [
      spec('scope', { required: true }),
      spec('agentSections.api', { required: false }),
    ]));
    const out = toValidationRubric(composeTemplate('story', { registry: reg }));
    expect(out.topLevelRules.find((r) => r.path === 'scope')!.required).toBe(true);
    expect(out.agentSectionRules.find((r) => r.section === 'api')!.required).toBe(false);
  });

  it('preserves minItemsPerSubField + requiredEntityRefs on agent sections', () => {
    const reg = new ContractRegistry();
    reg.register(contract('ba', 'ba', [spec('agentSections.api', {
      rubric: {
        severityOnFail: 'soft',
        fixHint: 'fix',
        minWords: 30,
        minItemsPerSubField: { routes: 1 },
        requiredEntityRefs: [{ label: 'route', pattern: '/api/' }],
      },
    })]));
    const out = toValidationRubric(composeTemplate('story', { registry: reg }));
    const api = out.agentSectionRules[0]!;
    expect(api.minItemsPerSubField).toEqual({ routes: 1 });
    expect(api.requiredEntityRefs).toEqual([{ label: 'route', pattern: '/api/' }]);
  });
});
