/**
 * BA Agent contract — composition + per-scope behaviour tests (ACR-004).
 */

import { ContractRegistry, composeTemplate } from '@chiefaia/agent-contract-registry';
import type { StoryScope } from '@chiefaia/ticket-template';
import { baAgentContract } from '../../src/agents/ba-agent.contract';

describe('baAgentContract — registration', () => {
  it('registers without throwing', () => {
    const reg = new ContractRegistry();
    expect(() => reg.register(baAgentContract)).not.toThrow();
  });

  it('owner is ba', () => {
    expect(baAgentContract.ownerAgent).toBe('ba');
  });

  it('appliesTo epic, module, story, task (not initiative or subtask)', () => {
    expect(baAgentContract.appliesTo).toEqual(['epic', 'module', 'story', 'task']);
    expect(baAgentContract.appliesTo).not.toContain('initiative');
    expect(baAgentContract.appliesTo).not.toContain('subtask');
  });

  it('declares acceptanceCriteria as a hard section', () => {
    const ac = baAgentContract.sections.find((s) => s.name === 'acceptanceCriteria')!;
    expect(ac).toBeDefined();
    expect(ac.required).toBe(true);
    expect(ac.rubric.severityOnFail).toBe('hard');
  });

  it('does not own agentSections.architecture (EA territory)', () => {
    const arch = baAgentContract.sections.find((s) => s.name === 'agentSections.architecture');
    expect(arch).toBeUndefined();
  });

  it('owns the other 7 agentSections.* slots', () => {
    const owned = baAgentContract.sections
      .map((s) => s.name)
      .filter((n) => n.startsWith('agentSections.'));
    expect(owned.sort()).toEqual([
      'agentSections.api',
      'agentSections.database',
      'agentSections.observability',
      'agentSections.release',
      'agentSections.security',
      'agentSections.testing',
      'agentSections.ui',
    ]);
  });
});

describe('baAgentContract — composition', () => {
  let reg: ContractRegistry;
  beforeEach(() => {
    reg = new ContractRegistry();
    reg.register(baAgentContract);
  });

  function compose(scope: StoryScope) {
    return composeTemplate(scope, { registry: reg });
  }

  it('story scope: acceptanceCriteria required + hard', () => {
    const t = compose('story');
    const ac = t.sections.get('acceptanceCriteria')!;
    expect(ac.effectiveRequired).toBe(true);
    expect(ac.effectiveRubric.severityOnFail).toBe('hard');
    expect(ac.effectiveRubric.minItems).toBe(3);
  });

  it('epic scope: acceptanceCriteria relaxed (minItems 2, soft)', () => {
    const t = compose('epic');
    const ac = t.sections.get('acceptanceCriteria')!;
    expect(ac.effectiveRubric.minItems).toBe(2);
    expect(ac.effectiveRubric.severityOnFail).toBe('soft');
  });

  it('subtask scope: BA contract excluded entirely (subtask not in appliesTo)', () => {
    // subtask isn't in appliesTo, so the BA contract contributes zero sections.
    const t = compose('subtask');
    expect(t.sections.size).toBe(0);
  });

  it('initiative scope: BA contract excluded entirely (not in appliesTo)', () => {
    const t = compose('initiative');
    expect(t.sections.size).toBe(0);
  });

  it('story scope: agentSections.* are optional (BA fills as relevant)', () => {
    const t = compose('story');
    const ui = t.sections.get('agentSections.ui')!;
    expect(ui.effectiveRequired).toBe(false);
    expect(ui.effectiveRubric.severityOnFail).toBe('soft');
  });

  it('agentSections.* declare scope + acceptanceCriteria as dependencies', () => {
    for (const s of baAgentContract.sections) {
      if (s.name.startsWith('agentSections.')) {
        expect(s.dependencies).toEqual(['scope', 'acceptanceCriteria']);
      }
    }
  });

  it('every section has a fixHint and >=1 example', () => {
    for (const s of baAgentContract.sections) {
      expect(s.rubric.fixHint.length).toBeGreaterThan(0);
      expect(s.examples.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('baAgentContract — strict mode CI', () => {
  it('composes every applicable scope without conflict', () => {
    const reg = new ContractRegistry();
    reg.register(baAgentContract);
    for (const scope of ['epic', 'module', 'story', 'task'] as const) {
      // dependencies on scope/acceptanceCriteria are unresolved when only BA
      // is registered (scope is owned by PO). We expect warnings but no throw
      // unless strict mode is on AND deps are missing.
      const t = composeTemplate(scope, { registry: reg });
      // Warnings allowed — they will be resolved when PO contract joins.
      expect(t.sections.size).toBeGreaterThan(0);
    }
  });

  it('signatures differ across applicable scopes', () => {
    const reg = new ContractRegistry();
    reg.register(baAgentContract);
    const sigs = new Set([
      composeTemplate('epic', { registry: reg }).signature,
      composeTemplate('module', { registry: reg }).signature,
      composeTemplate('story', { registry: reg }).signature,
      composeTemplate('task', { registry: reg }).signature,
    ]);
    expect(sigs.size).toBe(4);
  });
});
