/**
 * Test-Design Agent contract — composition + per-scope behaviour tests
 * (ACR-006).
 */

import { ContractRegistry, composeTemplate } from '@chiefaia/agent-contract-registry';
import type { StoryScope } from '@chiefaia/ticket-template';
import { testDesignAgentContract } from '../../src/agents/test-design-agent.contract';

describe('testDesignAgentContract — registration', () => {
  it('registers without throwing', () => {
    const reg = new ContractRegistry();
    expect(() => reg.register(testDesignAgentContract)).not.toThrow();
  });

  it('owner is test-design', () => {
    expect(testDesignAgentContract.ownerAgent).toBe('test-design');
  });

  it('appliesTo only story + task', () => {
    expect(testDesignAgentContract.appliesTo).toEqual(['story', 'task']);
  });

  it('owns testCases + testDesign', () => {
    const names = testDesignAgentContract.sections.map((s) => s.name);
    expect(names.sort()).toEqual(['testCases', 'testDesign']);
  });

  it('testCases depends on acceptanceCriteria', () => {
    const tc = testDesignAgentContract.sections.find((s) => s.name === 'testCases')!;
    expect(tc.dependencies).toEqual(['acceptanceCriteria']);
  });

  it('testDesign depends on testCases', () => {
    const td = testDesignAgentContract.sections.find((s) => s.name === 'testDesign')!;
    expect(td.dependencies).toEqual(['testCases']);
  });

  it('every section has fixHint + >=1 example', () => {
    for (const s of testDesignAgentContract.sections) {
      expect(s.rubric.fixHint.length).toBeGreaterThan(0);
      expect(s.examples.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('testDesignAgentContract — composition', () => {
  let reg: ContractRegistry;
  beforeEach(() => {
    reg = new ContractRegistry();
    reg.register(testDesignAgentContract);
  });

  function compose(scope: StoryScope) {
    return composeTemplate(scope, { registry: reg });
  }

  it('story scope: testCases hard + minItems=3', () => {
    const t = compose('story');
    const tc = t.sections.get('testCases')!;
    expect(tc.effectiveRequired).toBe(true);
    expect(tc.effectiveRubric.severityOnFail).toBe('hard');
    expect(tc.effectiveRubric.minItems).toBe(3);
  });

  it('task scope: testCases relaxed (minItems=1, soft)', () => {
    const t = compose('task');
    const tc = t.sections.get('testCases')!;
    expect(tc.effectiveRubric.minItems).toBe(1);
    expect(tc.effectiveRubric.severityOnFail).toBe('soft');
  });

  it('story scope: testDesign required + soft', () => {
    const t = compose('story');
    const td = t.sections.get('testDesign')!;
    expect(td.effectiveRequired).toBe(true);
    expect(td.effectiveRubric.severityOnFail).toBe('soft');
  });

  it('task scope: testDesign optional', () => {
    const t = compose('task');
    const td = t.sections.get('testDesign')!;
    expect(td.effectiveRequired).toBe(false);
  });

  it('non-story-non-task scopes get nothing from this contract', () => {
    for (const scope of ['initiative', 'epic', 'module', 'subtask'] as const) {
      const t = compose(scope);
      expect(t.sections.size).toBe(0);
    }
  });

  it('warnings: testCases dep on acceptanceCriteria + testDesign dep on testCases', () => {
    // With only test-design contract registered, testCases.dependencies
    // (=> acceptanceCriteria) is unresolved — expect a warning. testDesign
    // depends on testCases which IS in the same composed template, so no
    // warning for that one.
    const t = compose('story');
    const acWarn = t.warnings.find((w) => w.includes("'acceptanceCriteria'"));
    expect(acWarn).toBeDefined();
    const tdWarn = t.warnings.find((w) => w.includes("'testDesign'") && w.includes("'testCases'"));
    expect(tdWarn).toBeUndefined();
  });
});

describe('testDesignAgentContract — strict mode', () => {
  it('strict mode throws on unresolved acceptanceCriteria dep', () => {
    const reg = new ContractRegistry();
    reg.register(testDesignAgentContract);
    expect(() => composeTemplate('story', { registry: reg, strict: true })).toThrow(
      /'acceptanceCriteria'/,
    );
  });
});
