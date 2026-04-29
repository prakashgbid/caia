/**
 * BA Agent — Section Contract (ACR-004)
 *
 * The Business-Analyst agent's declaration of which sections it will
 * populate after PO decomposition. BA owns the bulk of the ticket — the
 * functional contract (acceptance criteria) and the per-domain agent
 * sections (architecture, database, api, ui, security, testing, release,
 * observability) plus dependencies, risks, assumptions, clarifying
 * questions.
 *
 * BA does NOT apply to `initiative` or `subtask` — initiatives are too
 * abstract for AC, and subtasks inherit the parent's BA contract.
 *
 * The Validator's content-relevance prompts in validation-rubric.ts are
 * the source of truth for these sections; the contract here mirrors those
 * thresholds via the rubric so ACR-007 can swap the Validator over to
 * consume the composed template without behaviour drift.
 */

import { z } from 'zod';
import {
  AGENT_SECTION_KEYS,
  MIN_ACCEPTANCE_CRITERIA,
  MAX_ACCEPTANCE_CRITERIA,
  UNIVERSAL_FORBIDDEN_SNIPPETS,
  type AgentSectionKey,
  type SectionContract,
  type SectionSpec,
} from '@chiefaia/ticket-template';

// ─── Section data shapes ────────────────────────────────────────────────────

const AcceptanceCriteriaSchema = z
  .array(z.string().min(1))
  .min(MIN_ACCEPTANCE_CRITERIA)
  .max(MAX_ACCEPTANCE_CRITERIA);

const DependenciesSchema = z
  .object({
    upstream: z.array(z.string()).default([]),
    downstream: z.array(z.string()).default([]),
    files: z.array(z.string()).default([]),
  })
  .strict();

const RisksSchema = z.array(z.string().min(1));
const AssumptionsSchema = z.array(z.string().min(1));
const ClarifyingQuestionsSchema = z.array(
  z
    .object({
      question: z.string().min(1),
      askedTo: z.enum(['po', 'ea', 'test-design', 'human']),
      answer: z.string().optional(),
      resolvedAt: z.number().int().nonnegative().optional(),
    })
    .strict(),
);

// Per-agent-section data shapes are simply z.unknown() at this layer — the
// Validator runs the section-specific Zod schemas from `schema.ts` during
// the structural-validation step. The contract's job is the rubric.
const AgentSectionPlaceholder = z.unknown();

// ─── Section specs ──────────────────────────────────────────────────────────

const acceptanceCriteriaSpec: SectionSpec = {
  name: 'acceptanceCriteria',
  description: 'Testable behavioural contract — each item describes one observable behaviour.',
  purpose:
    'The Test-Design Agent translates each AC into >=1 concrete test case; the coding agent uses ACs as the implementation contract.',
  dataShape: AcceptanceCriteriaSchema,
  required: true,
  rubric: {
    minWords: 24,
    minItems: MIN_ACCEPTANCE_CRITERIA,
    severityOnFail: 'hard',
    forbiddenSnippets: [
      ...UNIVERSAL_FORBIDDEN_SNIPPETS,
      'works correctly',
      'works as expected',
      'looks good',
      'as expected',
      'should work',
    ],
    fixHint:
      'Provide 3-10 acceptance criteria. Each must describe an observable behaviour in >=8 words. Prefer Given/When/Then phrasing. Avoid implementation details.',
  },
  examples: [
    {
      good: [
        'Given an authenticated subscriber, when they click "Upgrade", then a Stripe Checkout Session is created and they redirect to the Stripe-hosted page.',
        'Given a successful payment, when the webhook fires, then the user\'s plan is updated and a confirmation email is queued.',
        'Given a cancelled checkout, when the user clicks "back", then they return to the billing page with no plan change.',
      ],
      bad: ['Billing works correctly', 'Stripe integration works as expected', 'No errors'],
      badRationale:
        'Untestable fluff — "works correctly" cannot be verified. No persona/action/outcome.',
    },
  ],
  scopeOverrides: {
    epic: { minItems: 2, minWords: 16, severityOnFail: 'soft' },
    module: { minItems: 2, minWords: 16, severityOnFail: 'soft' },
    task: { minItems: 1, minWords: 8 },
    subtask: { required: false, severityOnFail: 'warning' },
  },
};

const dependenciesSpec: SectionSpec = {
  name: 'dependencies',
  description: 'Story-to-story ordering hints + files this story is expected to touch.',
  purpose:
    'BUCKET-### track uses dependencies.files to enforce resource non-overlap; upstream/downstream drive level scheduling within each WCC.',
  dataShape: DependenciesSchema,
  required: false,
  rubric: {
    severityOnFail: 'warning',
    fixHint:
      'List upstream story IDs that must complete first, downstream story IDs this enables, and files the implementation will touch.',
  },
  examples: [
    {
      good: { upstream: ['story-42'], downstream: [], files: ['apps/orchestrator/src/agents/billing.ts'] },
      bad: { upstream: [], downstream: [], files: [] },
      badRationale: 'Empty dependencies block defeats the bucket scheduler\'s claim system.',
    },
  ],
  scopeOverrides: {
    initiative: { required: false },
    subtask: { required: false },
  },
};

const risksSpec: SectionSpec = {
  name: 'risks',
  description: 'Project risks BA identified during enrichment.',
  purpose:
    'Surfaces in the Validator\'s gestalt prompt; lets the Test-Design Agent target risk-driven test cases.',
  dataShape: RisksSchema,
  required: false,
  rubric: {
    minItems: 1,
    severityOnFail: 'soft',
    fixHint:
      'Add >=1 risk in concrete terms (e.g. "Stripe webhook ordering may cause double-charge"). Avoid generic OWASP boilerplate.',
  },
  examples: [
    {
      good: [
        'Stripe webhook arriving before the redirect can race the local plan update — must be idempotent.',
      ],
      bad: ['Things might break'],
      badRationale: 'Non-actionable.',
    },
  ],
  scopeOverrides: {
    initiative: { required: true, minItems: 2 },
    epic: { required: true },
    module: { required: true },
    story: { required: false },
    task: { required: false },
    subtask: { required: false },
  },
};

const assumptionsSpec: SectionSpec = {
  name: 'assumptions',
  description: 'Things BA assumed when filling in the ticket — must be verified by EA / coding agent.',
  purpose:
    'When the coding agent finds an assumption broken, the story bounces back to BA via the Validator\'s re-attempt loop.',
  dataShape: AssumptionsSchema,
  required: false,
  rubric: {
    minItems: 1,
    severityOnFail: 'warning',
    fixHint: 'List >=1 assumption — even "no assumptions" should be stated explicitly.',
  },
  examples: [
    {
      good: ['Existing /api/billing route handles auth — confirm with EA.'],
      bad: [],
      badRationale: 'Empty defeats the bounce-back-on-broken-assumption loop.',
    },
  ],
  scopeOverrides: {
    initiative: { required: true },
    epic: { required: true },
    module: { required: true },
    story: { required: false },
    task: { required: false },
    subtask: { required: false },
  },
};

const clarifyingQuestionsSpec: SectionSpec = {
  name: 'clarifyingQuestions',
  description: 'Open questions BA asked during cross-agent collaboration.',
  purpose:
    'Resolved questions become a record of the cross-agent collaboration; unresolved questions block the Validator hand-off.',
  dataShape: ClarifyingQuestionsSchema,
  required: false,
  rubric: {
    severityOnFail: 'warning',
    fixHint: 'Resolved questions should have a non-empty `answer`; unresolved questions block hand-off.',
  },
  examples: [
    {
      good: [
        {
          question: 'Should we cancel pending Stripe Sessions older than 24h?',
          askedTo: 'po',
          answer: 'Yes — cancel after 24h.',
          resolvedAt: 1730000000000,
        },
      ],
      bad: [{ question: 'Hmm', askedTo: 'po' }],
      badRationale: 'Vague + unresolved.',
    },
  ],
  scopeOverrides: {
    story: { required: false },
    task: { required: false },
    subtask: { required: false },
  },
};

// ─── Per-domain agentSections specs ────────────────────────────────────────
//
// The BA contract owns the rubric for every key in AGENT_SECTION_KEYS
// EXCEPT `architecture` which the EA contract (ACR-005) owns. We declare
// agentSections.* sections here; ACR-005 declares architecture and
// architecturalInstructions.

const AGENT_SECTIONS_OWNED_BY_BA: readonly AgentSectionKey[] = AGENT_SECTION_KEYS.filter(
  (k) => k !== 'architecture',
);

const AGENT_SECTION_RUBRICS: Record<
  AgentSectionKey,
  { minWords: number; fixHint: string }
> = {
  architecture: { minWords: 40, fixHint: 'EA owns this section.' },
  database: {
    minWords: 30,
    fixHint:
      'Database section needs >=1 schemaChange entry, a migrationPath, and concrete table/migration references.',
  },
  api: {
    minWords: 25,
    fixHint:
      'API section needs >=1 route entry (method, path, schemas) and an errorContract describing the error response shape.',
  },
  ui: {
    minWords: 25,
    fixHint:
      'UI section needs >=1 PascalCase component name. Stories tagged "accessibility" require concrete a11y requirements.',
  },
  security: {
    minWords: 30,
    fixHint:
      'Security section needs >=2 threatModel entries that address actual risks. For auth-touching stories, populate authzNotes (>=10 words).',
  },
  testing: {
    minWords: 20,
    fixHint:
      'Testing section requires either >=1 unitTestPath or >=1 integrationTestPath. coverageTarget should be >=0.5.',
  },
  release: {
    minWords: 20,
    fixHint:
      'Release section needs a rolloutPlan (>=10 words). For risk=critical: also specify a rollbackPlan and a featureFlag.',
  },
  observability: {
    minWords: 20,
    fixHint:
      'Observability section needs >=1 metric entry and either >=1 log or >=1 trace. risk=critical requires >=1 alertRule.',
  },
};

function makeAgentSectionSpec(key: AgentSectionKey): SectionSpec {
  const meta = AGENT_SECTION_RUBRICS[key];
  return {
    name: `agentSections.${key}`,
    description: `Per-domain BA contribution for ${key}.`,
    purpose: `Surfaces the ${key}-domain implementation specifics so the coding agent can implement without follow-up questions.`,
    dataShape: AgentSectionPlaceholder,
    required: false,
    dependencies: ['scope', 'acceptanceCriteria'],
    rubric: {
      minWords: meta.minWords,
      severityOnFail: 'soft',
      forbiddenSnippets: [...UNIVERSAL_FORBIDDEN_SNIPPETS],
      fixHint: meta.fixHint,
    },
    examples: [
      {
        good: { contributedBy: 'ba-agent', contributedAt: 0, notes: 'Concrete content here.' },
        bad: { contributedBy: 'ba-agent', contributedAt: 0 },
        badRationale: 'Empty content fails relevance + minWords.',
      },
    ],
    scopeOverrides: {
      module: { required: false },
      story: { required: false },
      task: { required: false },
      subtask: { required: false },
    },
  };
}

const agentSectionSpecs: readonly SectionSpec[] = AGENT_SECTIONS_OWNED_BY_BA.map(
  makeAgentSectionSpec,
);

// ─── Contract export ────────────────────────────────────────────────────────

export const baAgentContract: SectionContract = {
  ownerAgent: 'ba',
  contractId: 'ba-agent.v1',
  version: '1.0.0',
  appliesTo: ['epic', 'module', 'story', 'task'],
  sections: [
    acceptanceCriteriaSpec,
    dependenciesSpec,
    risksSpec,
    assumptionsSpec,
    clarifyingQuestionsSpec,
    ...agentSectionSpecs,
  ],
};
