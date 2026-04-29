/**
 * Test-Design Agent — Section Contract (ACR-006)
 *
 * The Test-Design agent's declaration of which sections it populates
 * after the Validator passes the ticket. Wraps the existing TEST-001
 * `testCases` field on TicketTemplateV1; adds rubric so the Validator can
 * gate on test-design completeness once ACR-007 swaps the rubric source.
 *
 * `testDesign` metadata (totalCases, categoryCounts, designedBy, designedAt)
 * is also owned here — TEST-001 already validates internal consistency
 * via the schema's superRefine.
 */

import { z } from 'zod';
import {
  TEST_CASE_CATEGORIES,
  TEST_CASE_LAYERS,
  TEST_CASE_STATUSES,
  type SectionContract,
  type SectionSpec,
} from '@chiefaia/ticket-template';

// ─── Section data shapes (mirror TEST-001) ──────────────────────────────────

const TestCaseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    category: z.enum(TEST_CASE_CATEGORIES),
    layer: z.enum(TEST_CASE_LAYERS),
    given: z.string().min(1),
    when: z.string().min(1),
    then: z.string().min(1),
    linkedAcceptanceCriterionIndex: z.number().int().min(0).optional(),
    selectorHints: z.array(z.string()).default([]),
    mocks: z
      .array(
        z
          .object({
            method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
            url: z.string().min(1),
            status: z.number().int().min(100).max(599).default(200),
            body: z.string().default(''),
          })
          .strict(),
      )
      .default([]),
    required: z.boolean().default(true),
    status: z.enum(TEST_CASE_STATUSES).default('pending'),
    designedBy: z.string().min(1),
    designedAt: z.number().int().nonnegative(),
  })
  .strict();

const TestCasesSchema = z.array(TestCaseSchema);

const TestDesignSchema = z
  .object({
    designedBy: z.string().min(1),
    designedAt: z.number().int().nonnegative(),
    totalCases: z.number().int().nonnegative(),
    categoryCounts: z
      .object({
        happy: z.number().int().nonnegative().default(0),
        edge: z.number().int().nonnegative().default(0),
        error: z.number().int().nonnegative().default(0),
        accessibility: z.number().int().nonnegative().default(0),
        security: z.number().int().nonnegative().default(0),
        performance: z.number().int().nonnegative().default(0),
        visual: z.number().int().nonnegative().default(0),
      })
      .strict(),
    notes: z.string().default(''),
  })
  .strict();

// ─── Section specs ──────────────────────────────────────────────────────────

const testCasesSpec: SectionSpec = {
  name: 'testCases',
  description:
    'Story-driven test cases — each acceptance criterion becomes >=1 executable assertion.',
  purpose:
    'Test Runner Agent translates each test case into Playwright/vitest source. Required cases gate the story → done transition.',
  dataShape: TestCasesSchema,
  required: true,
  dependencies: ['acceptanceCriteria'],
  rubric: {
    minItems: 3,
    severityOnFail: 'hard',
    fixHint:
      'Each acceptance criterion must be covered by >=1 test case. Categories: happy/edge/error are required; a11y/security/perf/visual when story tags warrant.',
  },
  examples: [
    {
      good: [
        {
          id: 'TC-001',
          title: 'Happy: subscriber upgrades plan via Stripe Checkout',
          category: 'happy',
          layer: 'e2e',
          given: 'an authenticated subscriber on the billing page',
          when: 'they click Upgrade and complete Stripe Checkout',
          then: 'their plan is updated and a confirmation email is queued',
          designedBy: 'test-design-agent',
          designedAt: 1730000000000,
          required: true,
          status: 'pending',
          selectorHints: ['[data-test=upgrade-btn]'],
          mocks: [],
        },
      ],
      bad: [],
      badRationale: 'Empty array means no AC is gated — story can ship untested.',
    },
  ],
  scopeOverrides: {
    task: { minItems: 1, severityOnFail: 'soft' },
  },
};

const testDesignSpec: SectionSpec = {
  name: 'testDesign',
  description: 'Test-design metadata — totalCases, categoryCounts, designedBy, designedAt.',
  purpose:
    'Dashboard summary tiles + DoD-gating use this. TEST-001 schema enforces totalCases == testCases.length and categoryCounts == actual.',
  dataShape: TestDesignSchema,
  required: true,
  dependencies: ['testCases'],
  rubric: {
    severityOnFail: 'soft',
    fixHint:
      'When testCases is non-empty, testDesign must be present. totalCases must equal testCases.length and categoryCounts must match the actual breakdown.',
  },
  examples: [
    {
      good: {
        designedBy: 'test-design-agent',
        designedAt: 1730000000000,
        totalCases: 3,
        categoryCounts: {
          happy: 1,
          edge: 1,
          error: 1,
          accessibility: 0,
          security: 0,
          performance: 0,
          visual: 0,
        },
        notes: '',
      },
      bad: { designedBy: '', designedAt: 0, totalCases: 0, categoryCounts: {} },
      badRationale: 'Empty designer + zero counts conflict with non-empty testCases.',
    },
  ],
  scopeOverrides: {
    task: { required: false },
  },
};

// ─── Contract export ────────────────────────────────────────────────────────

export const testDesignAgentContract: SectionContract = {
  ownerAgent: 'test-design',
  contractId: 'test-design-agent.v1',
  version: '1.0.0',
  appliesTo: ['story', 'task'],
  sections: [testCasesSpec, testDesignSpec],
};
