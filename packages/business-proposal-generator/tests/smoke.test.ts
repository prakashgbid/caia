import { describe, expect, it } from 'vitest';

import * as Public from '../src/index.js';

describe('public surface', () => {
  it('exports the documented runtime + types', () => {
    const names = [
      'BUSINESS_PROPOSAL_GENERATOR_CONTRACT',
      'ProposalGenerator',
      'ProposalGeneratorError',
      'NotImplementedError',
      'PandocError',
      'PandocNotFoundError',
      'DefaultLlmCaller',
      'ScriptedLlmCaller',
      'TargetRegistry',
      'ClaudeDesignGenerator',
      'FigmaGenerator',
      'V0Generator',
      'LovableGenerator',
      'BoltGenerator',
      'BuilderioGenerator',
      'WebflowGenerator',
      'buildDefaultRegistry',
      'parseDesignAppPromptOutput',
      'buildDeepLink',
      'reviewPrompt',
      'computeComposite',
      'renderExecSummary',
      'renderFullProposal',
      'renderOnePager',
      'convertMarkdownToPdf',
      'convertMarkdownToDocx',
      'MemoryBlobStorage',
      'MemoryProposalPersistence',
      'PgProposalPersistence',
      'hashBusinessPlan',
      'canonicalJson',
      'diffBusinessPlans',
      'runStep5',
    ];
    for (const n of names) expect(n in Public).toBe(true);
  });

  it('contract is frozen and declares the FSM transition', () => {
    const c = Public.BUSINESS_PROPOSAL_GENERATOR_CONTRACT;
    expect(Object.isFrozen(c)).toBe(true);
    expect(c.agentId).toBe('@caia/business-proposal-generator');
    expect(c.fsmTransitions).toContainEqual({
      from: 'interview-complete',
      to: 'proposal-generated',
      reason: 'proposal-generated',
    });
  });
});
