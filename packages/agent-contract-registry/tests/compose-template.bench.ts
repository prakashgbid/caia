/**
 * Benchmark — composeTemplate must stay << 1ms cold-cache for the full
 * 4-agent registry. This guards against regressions in the composition
 * algorithm or signature hashing as the contract count grows.
 */

import { bench, describe } from 'vitest';
import { z } from 'zod';
import type { SectionContract, SectionSpec, StoryScope } from '@chiefaia/ticket-template';
import { ContractRegistry, composeTemplate } from '../src';

function spec(name: string): SectionSpec {
  return {
    name,
    description: 'd',
    purpose: 'p',
    dataShape: z.object({}).passthrough(),
    required: true,
    rubric: { severityOnFail: 'hard', fixHint: 'fix', minWords: 20 },
    examples: [{ good: {}, bad: {}, badRationale: 'r' }],
  };
}

function contract(
  contractId: string,
  ownerAgent: SectionContract['ownerAgent'],
  scopes: readonly StoryScope[],
  sectionNames: readonly string[],
): SectionContract {
  return {
    ownerAgent,
    contractId,
    version: '1.0.0',
    appliesTo: scopes,
    sections: sectionNames.map(spec),
  };
}

const reg = new ContractRegistry();
reg.register(contract('po-agent.v1', 'po', ['initiative', 'epic', 'module', 'story', 'task', 'subtask'],
  ['scope', 'userPersona', 'lifecycle', 'priority', 'linkedFeatures', 'parentEntity', 'domain', 'businessSubDomains']));
reg.register(contract('ba-agent.v1', 'ba', ['epic', 'module', 'story', 'task'],
  ['acceptanceCriteria', 'agentSections.architecture', 'agentSections.database', 'agentSections.api',
   'agentSections.ui', 'agentSections.security', 'agentSections.testing', 'agentSections.release',
   'agentSections.observability', 'dependencies', 'risks', 'assumptions', 'clarifyingQuestions']));
reg.register(contract('ea-agent.v1', 'ea', ['module', 'story', 'task', 'subtask'],
  ['architecturalInstructions', 'taxonomy', 'claims', 'effort', 'risk']));
reg.register(contract('test-design-agent.v1', 'test-design', ['story', 'task'],
  ['testCases', 'testDataSamples', 'edgeCases', 'errorPaths', 'surface']));

describe('composeTemplate — full registry', () => {
  bench('story scope', () => {
    composeTemplate('story', { registry: reg });
  });

  bench('initiative scope', () => {
    composeTemplate('initiative', { registry: reg });
  });

  bench('subtask scope', () => {
    composeTemplate('subtask', { registry: reg });
  });
});
