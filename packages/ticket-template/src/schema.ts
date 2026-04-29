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

// ─── BUCKET-001 taxonomy enums ───────────────────────────────────────────────
//
// First-class taxonomy fields populated by PO + EA before BA hands a ticket
// off to the Task Manager. All optional on v1 so existing tickets continue
// to validate; they become required at v2 once BUCKET-007 backfill ships.

/**
 * Canonical project slugs. New projects: add here + new migration row.
 * `unassigned` is the fallback only — must be replaced before BA finishes.
 */
export const PROJECT_SLUGS = [
  'caia',
  'pokerzeno',
  'roulettecommunity',
  'edisoncricket',
  'ankitatiwari',
  'prakash-tiwari',
  'chiefaia.com',
  'framework',
  'site-template',
  'image-provider',
  'cast-bridge',
  'dev-inspector',
  'backend-core',
  'content-engine',
  'integrity-check',
  'seo-program',
  'analytics',
  'unassigned',
] as const;

/** Lifecycle classification. Mirrors conventional-commits with hotfix + spike. */
export const LIFECYCLE_VALUES = [
  'new',
  'enhance',
  'bug',
  'refactor',
  'chore',
  'docs',
  'hotfix',
  'spike',
] as const;

/** Risk classification — drives review approach. */
export const RISK_VALUES = ['low', 'medium', 'high', 'critical'] as const;

/** Effort estimate. `XL` is a guard rail — EA must split before BA finishes. */
export const EFFORT_VALUES = ['XS', 'S', 'M', 'L', 'XL'] as const;

/** Priority bucket — mirrors orchestrator priority engine. */
export const PRIORITY_VALUES = ['P0', 'P1', 'P2', 'P3'] as const;

/** Quality tags — drive automatic policy gates (auto-AC injection, etc.). */
export const QUALITY_TAGS = [
  'seo',
  'accessibility',
  'performance',
  'security',
  'compliance',
  'observability',
  'internationalization',
] as const;

/**
 * Technology sub-domains — what layer/capability the code touches.
 * Multi-value; one is designated `primary` and used as the bucket-placement
 * key by the Task Manager.
 */
export const TECH_SUB_DOMAINS = [
  'frontend',
  'bff',
  'backend',
  'database',
  'event-driven',
  'observability',
  'web-analytics',
  'crm',
  'cms',
  'search',
  'auth',
  'payments',
  'email',
  'caching',
  'infra',
  'ci-cd',
  'ml-ai',
  'testing',
  'accessibility',
  'seo',
  'security',
  'localization-i18n',
  'design-system',
  'documentation',
  'api-gateway',
  'websockets',
  'file-storage',
  'rate-limiting',
  'feature-flags',
  'monitoring-alerting',
  'secrets-management',
  'dependency-management',
  'data-pipeline',
  'cron-scheduling',
  'agent-runtime',
  'prompt-engineering',
  'ticket-template',
  'data-migration',
  'compliance',
  'performance',
] as const;

export type ProjectSlug = (typeof PROJECT_SLUGS)[number];
export type LifecycleValue = (typeof LIFECYCLE_VALUES)[number];
export type RiskValue = (typeof RISK_VALUES)[number];
export type EffortValue = (typeof EFFORT_VALUES)[number];
export type PriorityValue = (typeof PRIORITY_VALUES)[number];
export type QualityTag = (typeof QUALITY_TAGS)[number];
export type TechSubDomain = (typeof TECH_SUB_DOMAINS)[number];

// ─── Migration 0025 — declarative input dependencies ───────────────────────
//
// Captures input requirements as structured metadata, separate from blocker
// relationships in `taxonomy.blockedBy`. Where `blockedBy` is "this story
// must not start until story X completes" (a hard, ID-keyed relationship),
// `inputDependencies` is "this story needs an input that may or may not
// have a producer yet". Surfaces BEFORE the producing story exists, so
// PO/BA can record it as soon as they realize the gap.

export const INPUT_DEPENDENCY_KINDS = [
  'capability',
  'data',
  'env',
  'flag',
  'route',
  'schema',
  'secret',
] as const;
export type InputDependencyKind = (typeof INPUT_DEPENDENCY_KINDS)[number];

export const INPUT_DEPENDENCY_DECLARERS = ['po', 'ba', 'ea', 'human'] as const;
export type InputDependencyDeclarer = (typeof INPUT_DEPENDENCY_DECLARERS)[number];

const InputDependencySchema = z
  .object({
    kind: z.enum(INPUT_DEPENDENCY_KINDS),
    name: z.string().min(1),
    description: z.string().default(''),
    required: z.boolean().default(true),
    satisfiedBy: z.string().optional(),
    declaredBy: z.enum(INPUT_DEPENDENCY_DECLARERS),
    declaredAt: z.number().int().nonnegative(),
  })
  .strict();

export type InputDependency = z.infer<typeof InputDependencySchema>;

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

// ─── BUCKET-001 / BUCKET-009 — Taxonomy + Claims blocks ─────────────────────

/**
 * Taxonomy block — populated by PO Agent (project, businessSubDomains,
 * lifecycle, priority) and extended by EA Agent (techSubDomains + primary,
 * qualityTags, risk, effort, blockedBy/conflictsWith/softDependsOn markers).
 *
 * On v1 the whole block is optional so existing tickets still validate.
 */
const TechSubDomains = z
  .object({
    primary: z.enum(TECH_SUB_DOMAINS),
    all: z.array(z.enum(TECH_SUB_DOMAINS)).min(1),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.all.includes(val.primary)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'techSubDomains.primary must appear in techSubDomains.all',
        path: ['primary'],
      });
    }
  });

const Taxonomy = z
  .object({
    project: z.enum(PROJECT_SLUGS).optional(),
    businessSubDomains: z.array(z.string().min(1)).default([]),
    techSubDomains: TechSubDomains.optional(),
    lifecycle: z.enum(LIFECYCLE_VALUES).optional(),
    qualityTags: z.array(z.enum(QUALITY_TAGS)).default([]),
    risk: z.enum(RISK_VALUES).optional(),
    effort: z.enum(EFFORT_VALUES).optional(),
    priorityBucket: z.enum(PRIORITY_VALUES).optional(),
    blockedBy: z.array(z.string()).default([]),
    softDependsOn: z.array(z.string()).default([]),
    conflictsWith: z.array(z.string()).default([]),
  })
  .strict();

/**
 * Resource-claim block — populated by EA Agent. Files / schemas / apiRoutes
 * are fine-grained; `domains` is the coarse fallback (= a coarsened union of
 * techSubDomains.all). The scheduler enforces no two in-flight stories
 * intersect on any of files/schemas/apiRoutes — see BUCKET-009.
 */
const Claims = z
  .object({
    files: z.array(z.string()).default([]),
    schemas: z.array(z.string()).default([]),
    apiRoutes: z.array(z.string()).default([]),
    domains: z.array(z.string()).default([]),
  })
  .strict();

// ─── Test cases (TEST-001 — story-driven testing framework) ─────────────────
//
// The Testing Agent generates an extensive `test_cases` array per story
// after BA enrichment completes. Each entry is a story-driven test case
// the future Test Runner Agent will translate into Playwright/vitest source.
//
// Categories cover the testing pyramid + cross-cutting non-functional axes.
// All entries default to `required: true` — required cases gate the story's
// `done` status (see Phase B / TEST-104).

/** Allowed values for the `category` field on a test case. */
export const TEST_CASE_CATEGORIES = [
  'happy',
  'edge',
  'error',
  'accessibility',
  'security',
  'performance',
  'visual',
] as const;

/** Lifecycle status of a single test case. */
export const TEST_CASE_STATUSES = [
  'pending',     // designed but not yet executed
  'running',     // in-flight
  'passed',
  'failed',
  'skipped',
  'flaky',
] as const;

/** Test layer — drives runner choice (vitest unit vs Playwright E2E etc.). */
export const TEST_CASE_LAYERS = [
  'unit',
  'integration',
  'e2e',
  'visual',
  'accessibility',
] as const;

export type TestCaseCategory = (typeof TEST_CASE_CATEGORIES)[number];
export type TestCaseStatus = (typeof TEST_CASE_STATUSES)[number];
export type TestCaseLayer = (typeof TEST_CASE_LAYERS)[number];

/** Bounds on test_cases per ticket — keeps runner cost predictable. */
export const MIN_TEST_CASES = 0;
export const MAX_TEST_CASES = 50;

/**
 * A single typed test case generated by the Testing Agent. The structure is
 * deliberately Gherkin-flavoured (given/when/then) so the Test Runner Agent
 * can deterministically translate to Playwright source code in Phase B.
 *
 * `selectorHints` — optional CSS / accessibility selectors the Testing Agent
 * extracts from the BA's UI section; the Test Runner uses them as a starting
 * point but is free to refine.
 *
 * `mocks` — request/response fixtures the Test Runner installs via
 * Playwright `page.route()` / MSW handlers before the test runs.
 */
const TestCase = z
  .object({
    id: z.string().min(1, 'test case id is required'),
    title: z.string().min(1, 'test case title is required'),
    category: z.enum(TEST_CASE_CATEGORIES),
    layer: z.enum(TEST_CASE_LAYERS),
    /** Free-form Gherkin "Given …" precondition. */
    given: z.string().min(1, 'given is required'),
    /** Free-form Gherkin "When …" action. */
    when: z.string().min(1, 'when is required'),
    /** Free-form Gherkin "Then …" expected outcome. */
    then: z.string().min(1, 'then is required'),
    /** ID of the acceptance criterion this case verifies (1-based index or AC id). */
    linkedAcceptanceCriterionIndex: z.number().int().min(0).optional(),
    /** Optional selector hints for the Test Runner Agent to use. */
    selectorHints: z.array(z.string()).default([]),
    /** Optional API mocks to install before the test runs. */
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
    /** If true, this case must pass for the story to transition to `done`. */
    required: z.boolean().default(true),
    /** Lifecycle status — defaults to 'pending' on creation. */
    status: z.enum(TEST_CASE_STATUSES).default('pending'),
    /** Author — typically 'testing-agent' on creation. */
    designedBy: z.string().min(1, 'designedBy is required'),
    /** Epoch ms when designed. */
    designedAt: z.number().int().nonnegative(),
  })
  .strict();

export type TestCase = z.infer<typeof TestCase>;

/**
 * The full `test_cases` array. Bounded to keep runner wallclock predictable
 * (50 cases × ~10s each = ~8 min full-suite, well within the Phase B budget).
 */
const TestCases = z
  .array(TestCase)
  .min(MIN_TEST_CASES, `at least ${MIN_TEST_CASES} test cases required`)
  .max(MAX_TEST_CASES, `at most ${MAX_TEST_CASES} test cases allowed`);

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
    /** TEST-001: epoch ms the Testing Agent populated `testCases`. */
    testDesignedAt: z.number().int().nonnegative().optional(),
    lastUpdatedAt: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Test-design metadata — written by the Testing Agent when it generates the
 * `testCases` array. Optional on v1 so legacy tickets continue to validate.
 */
const TestDesign = z
  .object({
    designedBy: z.string().min(1),
    designedAt: z.number().int().nonnegative(),
    /** Total cases produced (== testCases.length, kept here for fast SQL queries). */
    totalCases: z.number().int().nonnegative(),
    /** Per-category counts — useful for dashboard summary tiles. */
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
      .strict()
      .default({
        happy: 0,
        edge: 0,
        error: 0,
        accessibility: 0,
        security: 0,
        performance: 0,
        visual: 0,
      }),
    notes: z.string().default(''),
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
    /** BUCKET-001: 9-axis classification populated by PO + EA. */
    taxonomy: Taxonomy.optional(),
    /** BUCKET-009: scheduler resource claims populated by EA. */
    claims: Claims.optional(),
    /**
     * Migration 0025 — declarative input requirements. PO seeds during
     * decomposition; EA/BA fill `satisfiedBy` once a producing story is
     * identified. Empty array on legacy tickets.
     */
    inputDependencies: z.array(InputDependencySchema).default([]),
    agentSections: AgentSections,
    baEnrichment: BaEnrichment.optional(),
    /** TEST-001: story-driven test cases generated by the Testing Agent. */
    testCases: TestCases.default([]),
    /** TEST-001: metadata about the test-design pass. */
    testDesign: TestDesign.optional(),
    metadata: Metadata,
  })
  .strict()
  .superRefine((ticket, ctx) => {
    // TEST-001: testDesign + testCases consistency — when one is present,
    // the other must be too, and the counts must match.
    if (ticket.testDesign) {
      if (ticket.testDesign.totalCases !== ticket.testCases.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `testDesign.totalCases (${ticket.testDesign.totalCases}) must equal testCases.length (${ticket.testCases.length})`,
          path: ['testDesign', 'totalCases'],
        });
      }
      const counts: Record<TestCaseCategory, number> = {
        happy: 0,
        edge: 0,
        error: 0,
        accessibility: 0,
        security: 0,
        performance: 0,
        visual: 0,
      };
      for (const tc of ticket.testCases) counts[tc.category] += 1;
      for (const k of TEST_CASE_CATEGORIES) {
        const declared = ticket.testDesign.categoryCounts[k];
        const actual = counts[k];
        if (declared !== actual) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `testDesign.categoryCounts.${k} (${declared}) must equal actual count (${actual})`,
            path: ['testDesign', 'categoryCounts', k],
          });
        }
      }
    }

    // Test-case IDs must be unique within a ticket.
    if (ticket.testCases.length > 1) {
      const seen = new Set<string>();
      for (const tc of ticket.testCases) {
        if (seen.has(tc.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate testCases.id '${tc.id}'`,
            path: ['testCases'],
          });
        }
        seen.add(tc.id);
      }
    }

    // §4.2 mutual exclusions — only enforced when both fields are present,
    // so legacy tickets without the taxonomy block still validate.
    const tx = ticket.taxonomy;
    if (!tx) return;

    // docs lifecycle ⇒ techSubDomains.all should be ['documentation']
    if (
      tx.lifecycle === 'docs' &&
      tx.techSubDomains &&
      !tx.techSubDomains.all.every((d) => d === 'documentation')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "taxonomy.lifecycle='docs' requires techSubDomains.all to contain only 'documentation'",
        path: ['taxonomy', 'techSubDomains', 'all'],
      });
    }

    // spike lifecycle ⇒ effort ∈ {XS, S, M}
    if (tx.lifecycle === 'spike' && tx.effort && !['XS', 'S', 'M'].includes(tx.effort)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "taxonomy.lifecycle='spike' requires effort ∈ {XS, S, M}",
        path: ['taxonomy', 'effort'],
      });
    }

    // critical risk ⇒ priority ∈ {P0, P1}
    if (
      tx.risk === 'critical' &&
      tx.priorityBucket &&
      !['P0', 'P1'].includes(tx.priorityBucket)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "taxonomy.risk='critical' requires priorityBucket ∈ {P0, P1}",
        path: ['taxonomy', 'priorityBucket'],
      });
    }

    // new lifecycle + bug-fix nature ⇒ split into two stories
    if (tx.lifecycle === 'new' && ticket.context.nature === 'bug-fix') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "taxonomy.lifecycle='new' is incompatible with context.nature='bug-fix' — split into two stories",
        path: ['taxonomy', 'lifecycle'],
      });
    }

    // hotfix lifecycle ⇒ priority forced to P0
    if (tx.lifecycle === 'hotfix' && tx.priorityBucket && tx.priorityBucket !== 'P0') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "taxonomy.lifecycle='hotfix' requires priorityBucket='P0'",
        path: ['taxonomy', 'priorityBucket'],
      });
    }

    // unassigned project ⇒ this is a transient state; flag for EA/BA to fix.
    // (Allowed on v1 so legacy tickets validate, but loud for new pipeline runs.)
  });

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
