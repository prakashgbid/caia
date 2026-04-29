/**
 * EA Agent — Section Contract (ACR-005)
 *
 * The Enterprise-Architect agent's declaration of which sections it
 * populates. EA owns the technical layer of the ticket — agentSections.
 * architecture, the per-domain `architecturalInstructions` array (when
 * ARCH-006 lands), the BUCKET-001 taxonomy block (techSubDomains, risk,
 * effort), and the resource claims block (BUCKET-009).
 *
 * Coordination with ARCH-### track:
 *   - `architecturalInstructions` is declared as a stub here. The actual
 *     field shape is added by ARCH-006 to TicketTemplateV1Schema. Until
 *     then, the contract uses z.array(z.unknown()) — the Validator's
 *     structural step skips structurally-empty sections, but the rubric
 *     (minItems, requiredEntityRefs) still applies once ARCH-006 lands.
 *   - When ARCH-006 lands, this contract bumps to v1.1.0 — the
 *     ComposedTemplate signature changes, the Validator's cached rubric
 *     invalidates, and the per-domain references kick in.
 *
 * EA does not apply to `initiative` or `epic` — those scopes are PO/BA
 * strategic territory; EA enters at `module` and below.
 */

import { z } from 'zod';
import {
  EFFORT_VALUES,
  RISK_VALUES,
  TECH_SUB_DOMAINS,
  UNIVERSAL_FORBIDDEN_SNIPPETS,
  type SectionContract,
  type SectionSpec,
} from '@chiefaia/ticket-template';

// ─── Section data shapes ────────────────────────────────────────────────────

const ArchitectureSectionSchema = z
  .object({
    contributedBy: z.string().min(1),
    contributedAt: z.number().int().nonnegative(),
    adrReferences: z.array(z.string()).default([]),
    constraints: z.array(z.string()).default([]),
    notes: z.string().default(''),
  })
  .strict();

/**
 * Stub for `architecturalInstructions` — ARCH-006 lands the real shape on
 * TicketTemplateV1. Until then, we accept any array shape so the rubric's
 * minItems + requiredEntityRefs apply without coupling to a future schema.
 */
const ArchitecturalInstructionsSchema = z.array(z.unknown()).default([]);

const TechSubDomainsSchema = z
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

const ClaimsSchema = z
  .object({
    files: z.array(z.string()).default([]),
    schemas: z.array(z.string()).default([]),
    apiRoutes: z.array(z.string()).default([]),
    domains: z.array(z.string()).default([]),
  })
  .strict();

const EffortSchema = z.enum(EFFORT_VALUES);
const RiskSchema = z.enum(RISK_VALUES);

// ─── Section specs ──────────────────────────────────────────────────────────

const architectureSpec: SectionSpec = {
  name: 'agentSections.architecture',
  description: 'Architecture decisions guiding the implementation: ADR refs, constraints, rationale.',
  purpose:
    'Captures EA\'s design choices so the coding agent doesn\'t reinvent them. References ADRs + concrete file paths / packages.',
  dataShape: ArchitectureSectionSchema,
  required: false,
  dependencies: ['scope'],
  rubric: {
    minWords: 40,
    minItemsPerSubField: { constraints: 1 },
    requiredEntityRefs: [
      {
        label: 'file path, ADR ref, or @chiefaia package',
        pattern: '(\\w+\\.(ts|tsx|js|jsx|sql|md|yaml))|ADR-\\d+|@chiefaia/[\\w-]+',
        flags: 'i',
      },
    ],
    severityOnFail: 'soft',
    forbiddenSnippets: [...UNIVERSAL_FORBIDDEN_SNIPPETS],
    fixHint:
      'Architecture section needs >=40 words and at least one concrete reference (file path, ADR-#, or @chiefaia/* package). Notes should explain why this approach over alternatives.',
  },
  examples: [
    {
      good: {
        contributedBy: 'ea-agent',
        contributedAt: 1730000000000,
        adrReferences: ['ADR-12'],
        constraints: ['No new third-party deps; reuse @chiefaia/secrets.'],
        notes:
          'Use @chiefaia/secrets-broker to fetch the Stripe webhook signing key — pattern matches packages/secrets-broker/README.md.',
      },
      bad: {
        contributedBy: 'ea-agent',
        contributedAt: 0,
        adrReferences: [],
        constraints: [],
        notes: 'TBD',
      },
      badRationale: 'Empty + TBD placeholder.',
    },
  ],
  scopeOverrides: {
    module: { required: true, severityOnFail: 'soft' },
    story: { required: true, severityOnFail: 'soft' },
    task: { required: true, severityOnFail: 'soft' },
    subtask: { required: false },
  },
};

const architecturalInstructionsSpec: SectionSpec = {
  name: 'architecturalInstructions',
  description:
    'Per-domain technical instructions referencing AKG (Architecture Knowledge Graph) entities — populated by EA Agent post-ARCH-006.',
  purpose:
    'Coding agent gets concrete instructions: which file, which API, which schema, with names — no architectural thinking required at coding time.',
  dataShape: ArchitecturalInstructionsSchema,
  required: false,
  dependencies: ['scope'],
  rubric: {
    minItems: 1,
    severityOnFail: 'soft',
    requiredEntityRefs: [
      {
        label: 'AKG entity reference',
        pattern:
          'arch_(services|apis|components|schemas|migrations|themes|plugins|packages|integrations|domain_modules|observability_signals)/[a-z0-9_-]+',
        flags: 'i',
      },
    ],
    fixHint:
      'Each instruction must reference a concrete AKG entity by ID (e.g. arch_apis/billing-checkout). Empty array fails the Validator.',
  },
  examples: [
    {
      good: [
        { domain: 'backend', instruction: 'Add POST /billing/checkout to arch_apis/billing — reuse arch_components/StripeButton.' },
      ],
      bad: [],
      badRationale: 'Empty defeats the AKG reference rubric.',
    },
  ],
  scopeOverrides: {
    module: { required: true, severityOnFail: 'soft' },
    story: { required: true, severityOnFail: 'soft' },
    task: { required: true, severityOnFail: 'soft' },
    subtask: { required: false, minItems: 0 },
  },
};

const techSubDomainsSpec: SectionSpec = {
  name: 'taxonomy.techSubDomains',
  description: 'Technology sub-domains the work touches; one is `primary` (bucket key).',
  purpose:
    'BUCKET-### track keys buckets on (project, techSubDomainPrimary). Multi-value tags also drive scheduler claims for resource non-overlap.',
  dataShape: TechSubDomainsSchema,
  required: true,
  rubric: {
    severityOnFail: 'hard',
    fixHint: 'Set primary + all from TECH_SUB_DOMAINS. primary must appear in all.',
  },
  examples: [
    {
      good: { primary: 'backend', all: ['backend', 'database', 'observability'] },
      bad: { primary: 'backend', all: ['frontend'] },
      badRationale: 'primary not in all — fails refinement.',
    },
  ],
  scopeOverrides: {
    subtask: { required: false, severityOnFail: 'warning' },
  },
};

const claimsSpec: SectionSpec = {
  name: 'claims',
  description: 'Resource claims for the BUCKET-### scheduler — files/schemas/apiRoutes/domains.',
  purpose:
    'Scheduler enforces no two in-flight stories intersect on any of files/schemas/apiRoutes — see BUCKET-009 ready-pool.',
  dataShape: ClaimsSchema,
  required: false,
  rubric: {
    severityOnFail: 'soft',
    fixHint:
      'Populate at least one of files/schemas/apiRoutes for stories that will modify code. Empty for spike/docs only.',
  },
  examples: [
    {
      good: {
        files: ['apps/orchestrator/src/agents/billing.ts'],
        schemas: ['stories'],
        apiRoutes: ['POST /billing/checkout'],
        domains: ['billing'],
      },
      bad: { files: [], schemas: [], apiRoutes: [], domains: [] },
      badRationale: 'Empty defeats the scheduler\'s claim system.',
    },
  ],
  scopeOverrides: {
    story: { required: true, severityOnFail: 'soft' },
    task: { required: true, severityOnFail: 'soft' },
    subtask: { required: false },
  },
};

const effortSpec: SectionSpec = {
  name: 'taxonomy.effort',
  description: 'Effort estimate XS through XL.',
  purpose:
    'Bucket scheduler uses effort for level-scheduling weight; XL is a guard rail — EA must split before BA finishes.',
  dataShape: EffortSchema,
  required: true,
  rubric: {
    severityOnFail: 'soft',
    forbiddenSnippets: ['XL'],
    fixHint: 'Pick XS / S / M / L. XL must be split into smaller stories before BA finishes.',
  },
  examples: [
    { good: 'M', bad: 'XL', badRationale: 'XL must be split.' },
  ],
  scopeOverrides: {
    epic: { required: true, severityOnFail: 'warning' },
    subtask: { required: false, severityOnFail: 'warning' },
  },
};

const riskSpec: SectionSpec = {
  name: 'taxonomy.risk',
  description: 'Technical risk level — low/medium/high/critical.',
  purpose:
    'Drives Validator section-required triggers (e.g. risk=critical requires release + observability sections).',
  dataShape: RiskSchema,
  required: true,
  rubric: {
    severityOnFail: 'soft',
    fixHint: 'Pick low / medium / high / critical. critical requires P0/P1 priority + release/observability sections.',
  },
  examples: [
    { good: 'high', bad: '', badRationale: 'Missing risk skips downstream Validator triggers.' },
  ],
  scopeOverrides: {
    epic: { required: true, severityOnFail: 'warning' },
    subtask: { required: false, severityOnFail: 'warning' },
  },
};

// ─── Contract export ────────────────────────────────────────────────────────

export const eaAgentContract: SectionContract = {
  ownerAgent: 'ea',
  contractId: 'ea-agent.v1',
  version: '1.0.0',
  appliesTo: ['module', 'story', 'task', 'subtask'],
  sections: [
    architectureSpec,
    architecturalInstructionsSpec,
    techSubDomainsSpec,
    claimsSpec,
    effortSpec,
    riskSpec,
  ],
};
