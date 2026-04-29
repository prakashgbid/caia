/**
 * EA Agent contract — composition + per-scope behaviour tests (ACR-005).
 */

import { ContractRegistry, composeTemplate } from '@chiefaia/agent-contract-registry';
import type { StoryScope } from '@chiefaia/ticket-template';
import { eaAgentContract } from '../../src/agents/ea-agent.contract';

describe('eaAgentContract — registration', () => {
  it('registers without throwing', () => {
    const reg = new ContractRegistry();
    expect(() => reg.register(eaAgentContract)).not.toThrow();
  });

  it('owner is ea', () => {
    expect(eaAgentContract.ownerAgent).toBe('ea');
  });

  it('appliesTo module, story, task, subtask (not initiative or epic)', () => {
    expect(eaAgentContract.appliesTo).toEqual(['module', 'story', 'task', 'subtask']);
    expect(eaAgentContract.appliesTo).not.toContain('initiative');
    expect(eaAgentContract.appliesTo).not.toContain('epic');
  });

  it('owns agentSections.architecture (BA does not)', () => {
    expect(
      eaAgentContract.sections.find((s) => s.name === 'agentSections.architecture'),
    ).toBeDefined();
  });

  it('declares architecturalInstructions stub (for ARCH-006 wiring)', () => {
    const ai = eaAgentContract.sections.find((s) => s.name === 'architecturalInstructions');
    expect(ai).toBeDefined();
    // Stub: minItems rubric is set, but until ARCH-006 lands the schema, EA
    // populates an empty array. The contract's required rubric kicks in once
    // ARCH-006 ships.
    expect(ai!.rubric.minItems).toBe(1);
    expect(ai!.rubric.requiredEntityRefs?.[0]?.pattern).toContain('arch_');
  });

  it('owns taxonomy.techSubDomains, claims, effort, risk', () => {
    const names = eaAgentContract.sections.map((s) => s.name);
    expect(names).toContain('taxonomy.techSubDomains');
    expect(names).toContain('claims');
    expect(names).toContain('taxonomy.effort');
    expect(names).toContain('taxonomy.risk');
  });

  it('every section has fixHint + >=1 example', () => {
    for (const s of eaAgentContract.sections) {
      expect(s.rubric.fixHint.length).toBeGreaterThan(0);
      expect(s.examples.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('eaAgentContract — composition', () => {
  let reg: ContractRegistry;
  beforeEach(() => {
    reg = new ContractRegistry();
    reg.register(eaAgentContract);
  });

  function compose(scope: StoryScope) {
    return composeTemplate(scope, { registry: reg });
  }

  it('story scope: architecture + architecturalInstructions required + soft', () => {
    const t = compose('story');
    const arch = t.sections.get('agentSections.architecture')!;
    const ai = t.sections.get('architecturalInstructions')!;
    expect(arch.effectiveRequired).toBe(true);
    expect(arch.effectiveRubric.severityOnFail).toBe('soft');
    expect(ai.effectiveRequired).toBe(true);
    expect(ai.effectiveRubric.severityOnFail).toBe('soft');
  });

  it('story scope: techSubDomains hard required', () => {
    const t = compose('story');
    const tx = t.sections.get('taxonomy.techSubDomains')!;
    expect(tx.effectiveRequired).toBe(true);
    expect(tx.effectiveRubric.severityOnFail).toBe('hard');
  });

  it('subtask scope: architecturalInstructions optional + minItems=0', () => {
    const t = compose('subtask');
    const ai = t.sections.get('architecturalInstructions')!;
    expect(ai.effectiveRequired).toBe(false);
    expect(ai.effectiveRubric.minItems).toBe(0);
  });

  it('module scope: architecture + architecturalInstructions required', () => {
    const t = compose('module');
    expect(t.sections.get('agentSections.architecture')!.effectiveRequired).toBe(true);
    expect(t.sections.get('architecturalInstructions')!.effectiveRequired).toBe(true);
  });

  it('initiative scope: EA contract excluded entirely', () => {
    const t = compose('initiative');
    expect(t.sections.size).toBe(0);
  });

  it('epic scope: EA contract excluded entirely', () => {
    const t = compose('epic');
    expect(t.sections.size).toBe(0);
  });

  it('every section depends only on `scope`', () => {
    for (const s of eaAgentContract.sections) {
      if (s.dependencies) {
        expect(s.dependencies).toEqual(['scope']);
      }
    }
  });
});

describe('eaAgentContract — strict mode', () => {
  it('composes every applicable scope without conflict (warnings allowed for missing PO scope)', () => {
    const reg = new ContractRegistry();
    reg.register(eaAgentContract);
    for (const scope of ['module', 'story', 'task', 'subtask'] as const) {
      const t = composeTemplate(scope, { registry: reg });
      expect(t.sections.size).toBeGreaterThan(0);
      // Warnings allowed — `scope` dependency unresolved without PO.
    }
  });
});
