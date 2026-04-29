/**
 * Integration test — every PO/BA/EA/Test-Design contract registered
 * together composes cleanly across every canonical scope (ACR-006).
 *
 * This proves the cross-contract behaviour the architecture report
 * promised: per-scope union of sections, no conflicts under strict mode,
 * dependencies resolved when contracts are co-registered, signatures
 * stable + scope-distinct.
 */

import { ContractRegistry, composeTemplate, composeAllScopes } from '@chiefaia/agent-contract-registry';
import { STORY_SCOPES } from '@chiefaia/ticket-template';
import { poAgentContract } from '../../src/agents/po-agent.contract';
import { baAgentContract } from '../../src/agents/ba-agent.contract';
import { eaAgentContract } from '../../src/agents/ea-agent.contract';
import { testDesignAgentContract } from '../../src/agents/test-design-agent.contract';

function buildFullRegistry(): ContractRegistry {
  const reg = new ContractRegistry();
  reg.register(poAgentContract);
  reg.register(baAgentContract);
  reg.register(eaAgentContract);
  reg.register(testDesignAgentContract);
  return reg;
}

describe('all 4 contracts — integration', () => {
  it('every canonical scope composes without throwing', () => {
    const reg = buildFullRegistry();
    for (const scope of STORY_SCOPES) {
      expect(() => composeTemplate(scope, { registry: reg })).not.toThrow();
    }
  });

  it('every canonical scope composes WITHOUT warnings (no unresolved deps, no conflicts)', () => {
    const reg = buildFullRegistry();
    for (const scope of STORY_SCOPES) {
      const t = composeTemplate(scope, { registry: reg });
      expect(t.warnings).toEqual([]);
    }
  });

  it('strict mode passes on every canonical scope', () => {
    const reg = buildFullRegistry();
    for (const scope of STORY_SCOPES) {
      expect(() => composeTemplate(scope, { registry: reg, strict: true })).not.toThrow();
    }
  });

  it('story scope has the union of all 4 contracts', () => {
    const reg = buildFullRegistry();
    const t = composeTemplate('story', { registry: reg });
    // Sample sections from each agent.
    expect(t.sections.has('scope')).toBe(true);                              // PO
    expect(t.sections.has('taxonomy.lifecycle')).toBe(true);                  // PO
    expect(t.sections.has('acceptanceCriteria')).toBe(true);                  // BA
    expect(t.sections.has('agentSections.api')).toBe(true);                   // BA
    expect(t.sections.has('agentSections.architecture')).toBe(true);          // EA
    expect(t.sections.has('architecturalInstructions')).toBe(true);           // EA
    expect(t.sections.has('claims')).toBe(true);                              // EA
    expect(t.sections.has('testCases')).toBe(true);                           // Test-Design
    expect(t.sections.has('testDesign')).toBe(true);                          // Test-Design
  });

  it('initiative scope is purely PO (BA/EA/Test-Design excluded)', () => {
    const reg = buildFullRegistry();
    const t = composeTemplate('initiative', { registry: reg });
    const owners = new Set(
      [...t.sections.values()].map((e) => e.ownerAgent),
    );
    expect(owners).toEqual(new Set(['po']));
  });

  it('subtask scope contributors: PO + EA only (BA + Test-Design excluded)', () => {
    const reg = buildFullRegistry();
    const t = composeTemplate('subtask', { registry: reg });
    const owners = new Set([...t.sections.values()].map((e) => e.ownerAgent));
    expect(owners).toContain('po');
    expect(owners).toContain('ea');
    expect(owners).not.toContain('ba');
    expect(owners).not.toContain('test-design');
  });

  it('section ownership: agentSections.architecture -> EA, agentSections.api -> BA', () => {
    const reg = buildFullRegistry();
    const t = composeTemplate('story', { registry: reg });
    expect(t.sections.get('agentSections.architecture')!.ownerAgent).toBe('ea');
    expect(t.sections.get('agentSections.api')!.ownerAgent).toBe('ba');
  });

  it('signatures differ across all 6 scopes', () => {
    const reg = buildFullRegistry();
    const sigs = new Set(STORY_SCOPES.map((s) => composeTemplate(s, { registry: reg }).signature));
    expect(sigs.size).toBe(6);
  });

  it('composeAllScopes returns a per-scope template; story has the largest section count', () => {
    const reg = buildFullRegistry();
    const all = composeAllScopes({ registry: reg });
    expect(Object.keys(all).sort()).toEqual([...STORY_SCOPES].sort());
    // Story scope is the canonical "everyone contributes" scope.
    const sizes = Object.fromEntries(
      Object.entries(all).map(([k, v]) => [k, v.sections.size]),
    );
    expect(sizes.story).toBeGreaterThan(sizes.initiative);
    expect(sizes.story).toBeGreaterThan(sizes.subtask);
  });

  it('composition is deterministic across runs', () => {
    const a = composeTemplate('story', { registry: buildFullRegistry() });
    const b = composeTemplate('story', { registry: buildFullRegistry() });
    expect(a.signature).toBe(b.signature);
  });
});
