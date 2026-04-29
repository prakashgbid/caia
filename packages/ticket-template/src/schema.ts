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

// ─── Declarative input dependencies (migration 0025) ────────────────────────
//
// Captures input requirements as structured metadata, separate from blocker
// relationships in `taxonomy.blockedBy`. Where `blockedBy` is "this story
// must not start until story X completes" (a hard, ID-keyed relationship),
// `inputDependencies` is "this story needs an input that may or may not
// have a producer yet". Surfaces BEFORE the producing story exists, so
// PO/BA can record it as soon as they realize the gap.

/** What kind of input the story needs. */
export const INPUT_DEPENDENCY_KINDS = [
  'capability', // a behavior the system needs to expose, e.g. "login flow"
  'data',       // a dataset / fixture / seed
  'env',        // a build/runtime env var
  'flag',       // a feature flag toggle
  'route',      // an HTTP route / handler
  'schema',     // a DB schema / migration
  'secret',     // a vault secret
] as const;
export type InputDependencyKind = (typeof INPUT_DEPENDENCY_KINDS)[number];

/** Who declared the input requirement. */
export const INPUT_DEPENDENCY_DECLARERS = ['po', 'ba', 'ea', 'human'] as const;
export type InputDependencyDeclarer = (typeof INPUT_DEPENDENCY_DECLARERS)[number];

const InputDependency = z
  .object({
    kind: z.enum(INPUT_DEPENDENCY_KINDS),
    /** Human-readable label, e.g. "login flow". Required, ≥1 char. */
    name: z.string().min(1),
    /** Optional clarifier — what specifically is needed. */
    description: z.string().default(''),
    /** Hard requirement (default true). False ⇒ "nice-to-have, soft gate". */
    required: z.boolean().default(true),
    /**
     * Story ID that produces this input, once known. Set by EA or BA after
     * decomposition lands a sibling story that fulfils the requirement.
     * Until set, scheduler treats the dependency as un-satisfied.
     */
    satisfiedBy: z.string().optional(),
    /** Who put this on the ticket. */
    declaredBy: z.enum(INPUT_DEPENDENCY_DECLARERS),
    /** Unix ms — when the entry was first added. */
    declaredAt: z.number().int().nonnegative(),
  })
  .strict();

export type InputDependency = z.infer<typeof InputDependency>;

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
    /** BUCKET-001: 9-axis classification populated by PO + EA. */
    taxonomy: Taxonomy.optional(),
    /** BUCKET-009: scheduler resource claims populated by EA. */
    claims: Claims.optional(),
    /**
     * Migration 0025 — declarative input requirements. PO seeds during
     * decomposition; EA/BA fill `satisfiedBy` once a producing story is
     * identified. Empty array on legacy tickets.
     */
    inputDependencies: z.array(InputDependency).default([]),
    agentSections: AgentSections,
    baEnrichment: BaEnrichment.optional(),
    metadata: Metadata,
  })
  .strict()
  .superRefine((ticket, ctx) => {
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
