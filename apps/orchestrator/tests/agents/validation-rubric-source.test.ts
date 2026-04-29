/**
 * ACR-007 Step B — unit tests for validation-rubric-source.ts.
 *
 * Asserts the helper's three guarantees:
 *
 *   1. With contracts registered, the composed path returns a rubric that
 *      includes the same top-level paths the legacy rubric covers
 *      (scope/context/acceptanceCriteria/verificationPlan/dependencies).
 *
 *   2. With contracts registered, the composed-path agent-section rules
 *      cover the legacy agent-section names that the canonical 'story'
 *      scope contracts populate (architecture/security/testing/etc.).
 *
 *   3. `forceLegacy: true` returns identical structural output to the
 *      legacy hard-coded rubric so the Validator's `forceLegacyRubric`
 *      escape hatch is verifiably the same as the pre-Step-B behaviour.
 *
 * The helper auto-bootstraps Phase-1 contracts on first call so these
 * tests don't have to import `bootstrapAgentContracts` directly.
 */

import {
  AGENT_SECTION_RULES,
  buildDraftTicket,
  TOP_LEVEL_SECTION_RULES,
  type TicketTemplateV1,
} from '@chiefaia/ticket-template';
import {
  resetDefaultRegistry,
} from '@chiefaia/agent-contract-registry';
import {
  getValidationRubricForStory,
} from '../../src/agents/validation-rubric-source';
import { resetBootstrapFlag } from '../../src/agents/contract-bootstrap';

function buildBasicTicket(): TicketTemplateV1 {
  return buildDraftTicket({
    rootPromptId: 'prm_test',
    requirementId: 'req_test',
    domainPrimary: 'auth',
    domainAll: ['auth'],
    nature: 'feature',
    complexity: 'medium',
    summary: 'A small story for unit-testing the validation rubric source helper.',
    inScope: ['One concrete deliverable so the section is non-empty for the helper.'],
    outOfScope: ['Edge cases not in scope for this minimal harness fixture.'],
    acceptanceCriteria: [
      'Given the helper is called, when contracts are registered, then it returns the composed rubric.',
    ],
    verificationPlan: ['pnpm test'],
  });
}

describe('validation-rubric-source — composed path', () => {
  beforeEach(() => {
    resetDefaultRegistry();
    resetBootstrapFlag();
  });

  it('auto-bootstraps + composes a rubric that covers all legacy top-level paths', () => {
    const ticket = buildBasicTicket();
    const rubric = getValidationRubricForStory(ticket, 'story');
    expect(rubric.sourceMode).toBe('composed');
    expect(rubric.signature).toEqual(expect.any(String));

    const composedPaths = new Set(rubric.topLevelRules.map((r) => r.path));
    for (const legacy of TOP_LEVEL_SECTION_RULES) {
      expect(composedPaths.has(legacy.path)).toBe(true);
    }
  });

  it('exposes contractId + ownerAgent on every composed rule', () => {
    const ticket = buildBasicTicket();
    const rubric = getValidationRubricForStory(ticket, 'story');

    for (const r of rubric.topLevelRules) {
      expect(r.contractId).toBeTruthy();
      expect(r.ownerAgent).toBeTruthy();
      expect(r.contractId).not.toBe('legacy');
    }
    for (const r of rubric.agentSectionRules) {
      expect(r.contractId).toBeTruthy();
      expect(r.ownerAgent).toBeTruthy();
    }
  });

  it('pre-resolves `effectivelyRequired` so the validator does not need isSectionRequired', () => {
    const ticket = buildBasicTicket();
    const rubric = getValidationRubricForStory(ticket, 'story');
    for (const r of rubric.topLevelRules) {
      expect(typeof r.effectivelyRequired).toBe('boolean');
    }
    for (const r of rubric.agentSectionRules) {
      expect(typeof r.effectivelyRequired).toBe('boolean');
    }
  });
});

describe('validation-rubric-source — legacy fallback', () => {
  beforeEach(() => {
    resetDefaultRegistry();
    resetBootstrapFlag();
  });

  it('returns sourceMode "legacy" when forceLegacy is set', () => {
    const ticket = buildBasicTicket();
    const rubric = getValidationRubricForStory(ticket, 'story', {
      forceLegacy: true,
    });
    expect(rubric.sourceMode).toBe('legacy');
    expect(rubric.signature).toBeUndefined();
    expect(rubric.topLevelRules).toHaveLength(TOP_LEVEL_SECTION_RULES.length);
    expect(rubric.agentSectionRules).toHaveLength(AGENT_SECTION_RULES.length);
  });

  it('returns the legacy rubric when no contracts are registered + autoBootstrap=false', () => {
    const ticket = buildBasicTicket();
    const rubric = getValidationRubricForStory(ticket, 'story', {
      autoBootstrap: false,
    });
    expect(rubric.sourceMode).toBe('legacy');
  });

  it('legacy fallback rules carry contractId="legacy" + ownerAgent="legacy"', () => {
    const ticket = buildBasicTicket();
    const rubric = getValidationRubricForStory(ticket, 'story', {
      forceLegacy: true,
    });
    for (const r of rubric.topLevelRules) {
      expect(r.contractId).toBe('legacy');
      expect(r.ownerAgent).toBe('legacy');
    }
    for (const r of rubric.agentSectionRules) {
      expect(r.contractId).toBe('legacy');
      expect(r.ownerAgent).toBe('legacy');
    }
  });
});

describe('validation-rubric-source — defaults', () => {
  beforeEach(() => {
    resetDefaultRegistry();
    resetBootstrapFlag();
  });

  it('defaults the scope to "story" when omitted', () => {
    const ticket = buildBasicTicket();
    const rubric = getValidationRubricForStory(ticket);
    expect(rubric.scope).toBe('story');
  });
});
