/**
 * PO Agent contract — composition + per-scope behaviour tests (ACR-003).
 *
 * Asserts that:
 *   1. The contract registers cleanly with no internal conflicts.
 *   2. composeTemplate(scope) for each canonical scope produces the
 *      expected section ownership + required-set per the architecture
 *      report's per-scope matrix.
 *   3. The scope-override semantics are wired correctly.
 */

import { ContractRegistry, composeTemplate } from '@chiefaia/agent-contract-registry';
import type { StoryScope } from '@chiefaia/ticket-template';
import { poAgentContract } from '../../src/agents/po-agent.contract';

describe('poAgentContract — registration', () => {
  it('registers without throwing', () => {
    const reg = new ContractRegistry();
    expect(() => reg.register(poAgentContract)).not.toThrow();
  });

  it('owner is po', () => {
    expect(poAgentContract.ownerAgent).toBe('po');
  });

  it('appliesTo every canonical scope', () => {
    expect(poAgentContract.appliesTo).toEqual(
      expect.arrayContaining(['initiative', 'epic', 'module', 'story', 'task', 'subtask']),
    );
  });

  it('every section has a fixHint', () => {
    for (const s of poAgentContract.sections) {
      expect(s.rubric.fixHint.length).toBeGreaterThan(0);
    }
  });

  it('every section has at least one example', () => {
    for (const s of poAgentContract.sections) {
      expect(s.examples.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('poAgentContract — composition (no other contracts)', () => {
  let reg: ContractRegistry;
  beforeEach(() => {
    reg = new ContractRegistry();
    reg.register(poAgentContract);
  });

  function compose(scope: StoryScope) {
    return composeTemplate(scope, { registry: reg });
  }

  it('story scope: scope, lifecycle, priority, project required; userPersona required (override)', () => {
    const t = compose('story');
    expect(t.sections.get('scope')!.effectiveRequired).toBe(true);
    expect(t.sections.get('taxonomy.lifecycle')!.effectiveRequired).toBe(true);
    expect(t.sections.get('taxonomy.priorityBucket')!.effectiveRequired).toBe(true);
    expect(t.sections.get('taxonomy.project')!.effectiveRequired).toBe(true);
    expect(t.sections.get('context.userPersona')!.effectiveRequired).toBe(true);
  });

  it('initiative scope: businessOutcome required, minWords on scope >= 80, lifecycle relaxed', () => {
    const t = compose('initiative');
    expect(t.sections.get('businessOutcome')!.effectiveRequired).toBe(true);
    expect(t.sections.get('businessOutcome')!.effectiveRubric.minWords).toBeGreaterThanOrEqual(60);
    expect(t.sections.get('scope')!.effectiveRubric.minWords).toBe(80);
    expect(t.sections.get('taxonomy.lifecycle')!.effectiveRequired).toBe(false);
  });

  it('subtask scope: most PO fields relaxed; only structural required', () => {
    const t = compose('subtask');
    expect(t.sections.get('context.userPersona')!.effectiveRequired).toBe(false);
    expect(t.sections.get('taxonomy.businessSubDomains')!.effectiveRequired).toBe(false);
    expect(t.sections.get('businessOutcome')!.effectiveRequired).toBe(false);
    expect(t.sections.get('taxonomy.priorityBucket')!.effectiveRequired).toBe(false);
    // parentEpic hardens at subtask
    expect(t.sections.get('context.parentEpic')!.effectiveRequired).toBe(true);
    expect(t.sections.get('context.parentEpic')!.effectiveRubric.severityOnFail).toBe('hard');
  });

  it('every scope produces no warnings under the PO contract alone', () => {
    for (const scope of [
      'initiative',
      'epic',
      'module',
      'story',
      'task',
      'subtask',
    ] as const) {
      const t = compose(scope);
      expect(t.warnings).toEqual([]);
    }
  });

  it('signatures differ across scopes (scope-sensitive output)', () => {
    const sigs = new Set([
      compose('initiative').signature,
      compose('epic').signature,
      compose('module').signature,
      compose('story').signature,
      compose('task').signature,
      compose('subtask').signature,
    ]);
    expect(sigs.size).toBe(6);
  });
});

describe('poAgentContract — strict mode CI assertion', () => {
  it('composes every canonical scope without conflict (strict)', () => {
    const reg = new ContractRegistry();
    reg.register(poAgentContract);
    for (const scope of [
      'initiative',
      'epic',
      'module',
      'story',
      'task',
      'subtask',
    ] as const) {
      expect(() => composeTemplate(scope, { registry: reg, strict: true })).not.toThrow();
    }
  });
});
