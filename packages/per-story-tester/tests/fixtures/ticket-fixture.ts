/**
 * Test fixtures — typed shapes consumed by the parser / runner / api tests.
 */

import type { TestCase } from '@chiefaia/ticket-template';
import type { LoadedTicket } from '../../src/types.js';

const NOW = 1_700_000_000_000;

export function makeTestCase(overrides: Partial<TestCase> & Pick<TestCase, 'id' | 'title' | 'category' | 'layer'>): TestCase {
  return {
    id: overrides.id,
    title: overrides.title,
    category: overrides.category,
    layer: overrides.layer,
    given: overrides.given ?? 'a precondition',
    when: overrides.when ?? 'an action',
    then: overrides.then ?? 'an outcome',
    selectorHints: overrides.selectorHints ?? [],
    mocks: overrides.mocks ?? [],
    required: overrides.required ?? true,
    status: overrides.status ?? 'pending',
    designedBy: overrides.designedBy ?? 'testing-agent',
    designedAt: overrides.designedAt ?? NOW,
    ...(overrides.linkedAcceptanceCriterionIndex !== undefined
      ? { linkedAcceptanceCriterionIndex: overrides.linkedAcceptanceCriterionIndex }
      : {}),
  };
}

export function makeLoadedTicket(overrides: Partial<LoadedTicket> = {}): LoadedTicket {
  return {
    ticketId: overrides.ticketId ?? 'TKT-001',
    projectId: overrides.projectId ?? 'proj-001',
    repoPath: overrides.repoPath ?? '/tmp/repo',
    testCases:
      overrides.testCases ??
      [
        makeTestCase({ id: 'TC-1', title: 'unit happy', category: 'happy', layer: 'unit' }),
        makeTestCase({
          id: 'TC-2',
          title: 'e2e happy',
          category: 'happy',
          layer: 'e2e',
        }),
      ],
    baseUrl: overrides.baseUrl ?? 'http://localhost:3000',
    unitTestPaths: overrides.unitTestPaths ?? ['tests/unit/foo.test.ts'],
    integrationTestPaths: overrides.integrationTestPaths ?? [],
    behaviorTestPath: overrides.behaviorTestPath ?? 'tests/e2e/foo.spec.ts',
    ...(overrides.performanceBudget !== undefined
      ? { performanceBudget: overrides.performanceBudget }
      : {}),
  };
}
