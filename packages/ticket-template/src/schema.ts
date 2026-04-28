/**
 * @chiefaia/ticket-template — TicketTemplateV1
 *
 * The canonical, Zod-validated shape of a Phase-1 pipeline ticket. Every agent
 * in the pipeline reads from and writes into this shape; the validator
 * enforces the contract before BA can hand a ticket to the Task Manager.
 *
 * Field-level rationale and counts are documented inline so the schema itself
 * is the spec — no parallel doc to drift from.
 */

import { z } from 'zod';

// ─── Constants ───────────────────────────────────────────────────────────────

export const TICKET_TEMPLATE_VERSION = 'v1' as const;

/** Minimum acceptance-criteria count for a valid ticket. */
export const MIN_ACCEPTANCE_CRITERIA = 3;
/** Maximum acceptance-criteria count for a valid ticket (avoid story bloat). */
export const MAX_ACCEPTANCE_CRITERIA = 10;

/**
 * Allowed values for the `nature` field — captures the kind of work the
 * ticket represents. Mirrors `@chiefaia/classifier` taxonomy.
 */
export const NATURE_VALUES = [
  'feature',
  'bug-fix',
  'refactor',
  'performance',
  'security',
  'content',
  'infra',
  'docs',
] as const;

/** Allowed values for the `complexity` field. */
export const COMPLEXITY_VALUES = ['low', 'medium', 'high', 'spike'] as const;

// ─── Required core sections ──────────────────────────────────────────────────

const Scope = z
  .object({
    summary: z.string().min(1, 'summary is required'),
    inScope: z.array(z.string().min(1)).min(1, 'inScope must list ≥1 item'),
    outOfScope: z.array(z.string()).default([]),
  })
  .strict();

const Context = z
  .object({
    rootPromptId: z.string().min(1),
    requirementId: z.string().min(1),
    parentEpic: z.string().optional(),
    domainPrimary: z.string().min(1),
    domainAll: z.array(z.string().min(1)).min(1),
    nature: z.enum(NATURE_VALUES),
    complexity: z.enum(COMPLEXITY_VALUES),
  })
  .strict();

const AcceptanceCriteria = z
  .array(z.string().min(1))
  .min(MIN_ACCEPTANCE_CRITERIA, `at least ${MIN_ACCEPTANCE_CRITERIA} acceptance criteria required`)
  .max(MAX_ACCEPTANCE_CRITERIA, `at most ${MAX_ACCEPTANCE_CRITERIA} acceptance criteria allowed`);

const VerificationPlan = z
  .array(z.string().min(1))
  .min(1, 'verificationPlan must list ≥1 step');

const Dependencies = z
  .object({
    upstream: z.array(z.string()).default([]),
    downstream: z.array(z.string()).default([]),
    files: z.array(z.string()).default([]),
  })
  .strict();

// ─── Per-agent sections (all optional, populated by BA collaboration) ────────

const ContributedFields = {
  contributedBy: z.string().min(1),
  contributedAt: z.number().int().nonnegative(),
};

const ArchitectureSection = z
  .object({
    ...ContributedFields,
    adrReferences: z.array(z.string()).default([]),
    constraints: z.array(z.string()).default([]),
    notes: z.string().default(''),
  })
  .strict();

const DatabaseSection = z
  .object({
    ...ContributedFields,
    schemaChanges: z.array(z.string()).default([]),
    migrationPath: z.string().optional(),
    reversibility: z.enum(['reversible', 'irreversible', 'partial']).default('reversible'),
    indexImpact: z.string().default(''),
  })
  .strict();

const ApiRoute = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: z.string().min(1),
    requestSchema: z.string().optional(),
    responseSchema: z.string().optional(),
  })
  .strict();

const ApiSection = z
  .object({
    ...ContributedFields,
    routes: z.array(ApiRoute).default([]),
    errorContract: z.string().default(''),
  })
  .strict();

const UISection = z
  .object({
    ...ContributedFields,
    components: z.array(z.string()).default([]),
    designSystemPattern: z.string().default(''),
    accessibilityRequirements: z.array(z.string()).default([]),
  })
  .strict();

const SecuritySection = z
  .object({
    ...ContributedFields,
    threatModel: z.array(z.string()).default([]),
    requiredHeaders: z.array(z.string()).default([]),
    authzNotes: z.string().default(''),
  })
  .strict();

const TestingSection = z
  .object({
    ...ContributedFields,
    unitTestPaths: z.array(z.string()).default([]),
    integrationTestPaths: z.array(z.string()).default([]),
    behaviorTestPath: z.string().optional(),
    coverageTarget: z.number().min(0).max(1).default(0.8),
  })
  .strict();

const ReleaseSection = z
  .object({
    ...ContributedFields,
    featureFlag: z.string().optional(),
    rolloutPlan: z.string().default(''),
    rollbackPlan: z.string().default(''),
  })
  .strict();

const ObservabilitySection = z
  .object({
    ...ContributedFields,
    metrics: z.array(z.string()).default([]),
    traces: z.array(z.string()).default([]),
    logs: z.array(z.string()).default([]),
    alertRules: z.array(z.string()).default([]),
  })
  .strict();

const AgentSections = z
  .object({
    architecture: ArchitectureSection.optional(),
    database: DatabaseSection.optional(),
    api: ApiSection.optional(),
    ui: UISection.optional(),
    security: SecuritySection.optional(),
    testing: TestingSection.optional(),
    release: ReleaseSection.optional(),
    observability: ObservabilitySection.optional(),
  })
  .strict()
  .default({});

// ─── BA enrichment metadata ──────────────────────────────────────────────────

const InputRequest = z
  .object({
    agent: z.string().min(1),
    correlationId: z.string().min(1),
    status: z.enum(['pending', 'replied', 'timed_out']),
    expectedReplyBy: z.number().int().nonnegative().optional(),
    repliedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

const BaEnrichment = z
  .object({
    enrichedBy: z.string().min(1),
    enrichedAt: z.number().int().nonnegative(),
    inputsRequested: z.array(InputRequest).default([]),
    completenessChecksPassed: z.boolean(),
    notes: z.string().default(''),
  })
  .strict();

// ─── Top-level template ──────────────────────────────────────────────────────

const Metadata = z
  .object({
    templateVersion: z.literal(TICKET_TEMPLATE_VERSION),
    poDecomposedAt: z.number().int().nonnegative().optional(),
    baEnrichedAt: z.number().int().nonnegative().optional(),
    lastUpdatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const TicketTemplateV1Schema = z
  .object({
    version: z.literal(TICKET_TEMPLATE_VERSION),
    scope: Scope,
    context: Context,
    acceptanceCriteria: AcceptanceCriteria,
    verificationPlan: VerificationPlan,
    dependencies: Dependencies,
    agentSections: AgentSections,
    baEnrichment: BaEnrichment.optional(),
    metadata: Metadata,
  })
  .strict();

export type TicketTemplateV1 = z.infer<typeof TicketTemplateV1Schema>;
export type AgentSectionKey = keyof TicketTemplateV1['agentSections'];

/** All section keys an agent can contribute to. Useful for iteration. */
export const AGENT_SECTION_KEYS = [
  'architecture',
  'database',
  'api',
  'ui',
  'security',
  'testing',
  'release',
  'observability',
] as const satisfies readonly AgentSectionKey[];
