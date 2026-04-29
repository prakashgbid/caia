/**
 * PO Agent — Section Contract (ACR-003)
 *
 * The Product-Owner agent's declaration of which sections it will populate
 * on every Phase-1 ticket, with descriptions and per-scope rubrics.
 * Registered with @chiefaia/agent-contract-registry on agent boot; the
 * Story Validator consumes the composed template at runtime per a story's
 * `story_scope`.
 *
 * Sections owned:
 *  - scope                 — summary + in/outOfScope
 *  - context.userPersona   — who the work is for
 *  - taxonomy.lifecycle    — new/enhance/bug/...
 *  - taxonomy.priority     — P0–P3
 *  - linkedFeatures        — FREG-006 matches (links_to_json)
 *  - context.parentEpic    — parent in the SAFe / Jira hierarchy
 *  - taxonomy.project      — project slug
 *  - taxonomy.businessSubDomains — multi-value functional grouping
 *  - businessOutcome       — KPI targets (initiative + epic only)
 *
 * Per-scope semantics: PO writes summary-level for initiative/epic, full
 * detail for story/task. See the per-section `scopeOverrides` for the
 * exact thresholds.
 */

import { z } from 'zod';
import {
  PROJECT_SLUGS,
  LIFECYCLE_VALUES,
  PRIORITY_VALUES,
  UNIVERSAL_FORBIDDEN_SNIPPETS,
  type SectionContract,
  type SectionSpec,
} from '@chiefaia/ticket-template';

// ─── Section data shapes ────────────────────────────────────────────────────

const ScopeSchema = z
  .object({
    summary: z.string().min(1, 'summary is required'),
    inScope: z.array(z.string().min(1)).min(1, 'inScope must list >=1 item'),
    outOfScope: z.array(z.string()).default([]),
  })
  .strict();

const UserPersonaSchema = z
  .object({
    role: z.string().min(1),
    intent: z.string().min(1),
  })
  .strict();

const LifecycleSchema = z.enum(LIFECYCLE_VALUES);
const PrioritySchema = z.enum(PRIORITY_VALUES);

const LinkedFeaturesSchema = z.array(z.string().min(1)).default([]);

const ParentEntitySchema = z.string().min(1).optional();

const ProjectSchema = z.enum(PROJECT_SLUGS);

const BusinessSubDomainsSchema = z.array(z.string().min(1)).default([]);

const BusinessOutcomeSchema = z
  .object({
    summary: z.string().min(1),
    kpis: z
      .array(
        z
          .object({
            name: z.string().min(1),
            targetValue: z.string().min(1),
            timeframe: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

// ─── Section specs ──────────────────────────────────────────────────────────

const scopeSpec: SectionSpec = {
  name: 'scope',
  description: 'What the work will and will not deliver — the contract for downstream agents.',
  purpose:
    'Defines the single observable outcome (summary), the deliverables (inScope), and the explicit exclusions (outOfScope). Anchors every later section.',
  dataShape: ScopeSchema,
  required: true,
  rubric: {
    minWords: 30,
    severityOnFail: 'hard',
    forbiddenSnippets: [...UNIVERSAL_FORBIDDEN_SNIPPETS],
    fixHint:
      'Expand the summary to >=10 words describing the observable outcome. Each inScope item should describe a concrete deliverable in >=5 words.',
  },
  examples: [
    {
      good: {
        summary: 'Add Stripe checkout to the billing page so monthly subscribers can self-serve plan upgrades.',
        inScope: [
          'Stripe Checkout Sessions API integration',
          'Success and cancel redirect handling',
          'Server-side webhook verification with idempotency',
        ],
        outOfScope: ['Refund flow', 'Subscription downgrades'],
      },
      bad: {
        summary: 'Billing improvements',
        inScope: ['stuff'],
        outOfScope: [],
      },
      badRationale:
        'Vague summary, single non-specific deliverable, no out-of-scope — downstream agents cannot tell what success looks like.',
    },
  ],
  scopeOverrides: {
    initiative: { minWords: 80 },
    epic: { minWords: 50 },
    subtask: { minWords: 10, severityOnFail: 'soft' },
  },
};

const userPersonaSpec: SectionSpec = {
  name: 'context.userPersona',
  description: 'Who the work is for — role + intent.',
  purpose:
    'Anchors the BA Agent\'s acceptance criteria in a real user. Without this, ACs drift to feature-list bullets.',
  dataShape: UserPersonaSchema,
  required: false,
  rubric: {
    minWords: 6,
    severityOnFail: 'soft',
    fixHint: 'Specify role (>=2 words) + intent (>=4 words).',
  },
  examples: [
    {
      good: { role: 'monthly subscriber', intent: 'upgrade my plan without contacting support' },
      bad: { role: 'user', intent: 'use the feature' },
      badRationale: 'Generic role + vague intent — does not constrain AC choice.',
    },
  ],
  scopeOverrides: {
    initiative: { required: true, minWords: 12 },
    epic: { required: true, minWords: 8 },
    story: { required: true },
    module: { required: false },
    task: { required: false },
    subtask: { required: false },
  },
};

const lifecycleSpec: SectionSpec = {
  name: 'taxonomy.lifecycle',
  description: 'Lifecycle classification — new/enhance/bug/refactor/chore/docs/hotfix/spike.',
  purpose:
    'Drives Validator triggers (e.g. lifecycle=new requires architecture section), bucket placement (BUCKET-### track), and FREG-006 enhance-vs-new override.',
  dataShape: LifecycleSchema,
  required: true,
  rubric: {
    severityOnFail: 'hard',
    fixHint: 'Pick exactly one of: new, enhance, bug, refactor, chore, docs, hotfix, spike.',
  },
  examples: [
    { good: 'enhance', bad: '', badRationale: 'Empty/missing lifecycle blocks bucket placement.' },
  ],
  scopeOverrides: {
    initiative: { required: false, severityOnFail: 'warning' },
  },
};

const prioritySpec: SectionSpec = {
  name: 'taxonomy.priorityBucket',
  description: 'Priority bucket — P0 through P3.',
  purpose: 'Drives orchestrator priority engine + ready-pool ordering inside each bucket.',
  dataShape: PrioritySchema,
  required: true,
  rubric: {
    severityOnFail: 'hard',
    fixHint: 'Pick exactly one of: P0, P1, P2, P3. P0 = drop-everything; P3 = nice-to-have.',
  },
  examples: [
    { good: 'P1', bad: '', badRationale: 'Missing priority blocks bucket placement.' },
  ],
  scopeOverrides: {
    subtask: { required: false, severityOnFail: 'warning' },
  },
};

const linkedFeaturesSpec: SectionSpec = {
  name: 'linksToJson',
  description: 'FREG-006 feature-registry matches — array of feature_registry.id strings.',
  purpose:
    'Connects the story to existing feature-registry entries when PO classifies lifecycle as `enhance`. Lets the EA Agent skip greenfield architecture for known features.',
  dataShape: LinkedFeaturesSchema,
  required: false,
  rubric: {
    severityOnFail: 'warning',
    fixHint:
      'When taxonomy.lifecycle=enhance, populate >=1 entry from feature_registry.id. Empty is acceptable for lifecycle=new.',
  },
  examples: [
    {
      good: ['feat_billing_checkout', 'feat_billing_webhooks'],
      bad: [],
      badRationale:
        'Empty when lifecycle=enhance defeats the FREG-006 classifier — bug-fix duplicates may slip through.',
    },
  ],
  scopeOverrides: {
    task: { required: false },
    subtask: { required: false },
  },
};

const parentEntitySpec: SectionSpec = {
  name: 'context.parentEpic',
  description: 'Parent entity ID — epic→initiative, story→epic, etc.',
  purpose:
    'Anchors the SAFe / Jira hierarchy. The Validator + dashboard /contracts page use this to roll-up scope coverage.',
  dataShape: ParentEntitySchema,
  required: false,
  rubric: {
    severityOnFail: 'warning',
    fixHint: 'Set to the parent entity ID (e.g. story under epic-42 has parentEpic=epic-42).',
  },
  examples: [
    { good: 'epic-42', bad: '', badRationale: 'Disconnected from the hierarchy — orphaned story.' },
  ],
  scopeOverrides: {
    initiative: { required: false },
    epic: { required: true, severityOnFail: 'soft' },
    module: { required: true, severityOnFail: 'soft' },
    story: { required: true, severityOnFail: 'soft' },
    task: { required: true, severityOnFail: 'soft' },
    subtask: { required: true, severityOnFail: 'hard' },
  },
};

const projectSpec: SectionSpec = {
  name: 'taxonomy.project',
  description: 'Owning project slug from PROJECT_SLUGS.',
  purpose:
    'Anchors bucket placement (BUCKET-### track keys buckets on (project, primary tech sub-domain)) + dashboard project filter.',
  dataShape: ProjectSchema,
  required: true,
  rubric: {
    severityOnFail: 'soft',
    forbiddenSnippets: ['unassigned'],
    fixHint:
      'Pick a concrete project slug from PROJECT_SLUGS. Avoid `unassigned` — it blocks bucket placement.',
  },
  examples: [
    { good: 'caia', bad: 'unassigned', badRationale: '`unassigned` blocks bucket placement.' },
  ],
  scopeOverrides: {
    initiative: { required: false, severityOnFail: 'warning' },
    subtask: { required: false, severityOnFail: 'warning' },
  },
};

const businessSubDomainsSpec: SectionSpec = {
  name: 'taxonomy.businessSubDomains',
  description: 'Multi-value business sub-domains — per-project functional grouping.',
  purpose:
    'Drives project-internal bucket fragmentation (e.g. pokerzeno > leaderboard vs gameplay vs billing).',
  dataShape: BusinessSubDomainsSchema,
  required: false,
  rubric: {
    minItems: 1,
    severityOnFail: 'soft',
    fixHint: 'Populate >=1 entry from the project\'s sub-domain set.',
  },
  examples: [
    {
      good: ['billing', 'engagement'],
      bad: [],
      badRationale: 'Empty defeats per-project bucket fragmentation.',
    },
  ],
  scopeOverrides: {
    initiative: { required: true },
    epic: { required: true },
    module: { required: true },
    story: { required: true },
    task: { required: false },
    subtask: { required: false },
  },
};

const businessOutcomeSpec: SectionSpec = {
  name: 'businessOutcome',
  description: 'Business KPI targets the initiative or epic will move.',
  purpose:
    'Lets EA select architecture investments aligned to outcomes rather than feature wishlist; surfaces in dashboard rollups.',
  dataShape: BusinessOutcomeSchema,
  required: false,
  rubric: {
    minWords: 40,
    severityOnFail: 'soft',
    fixHint: 'Specify >=1 KPI with target value and timeframe.',
  },
  examples: [
    {
      good: {
        summary: 'Cut paid-conversion churn from 4.2% to <2% by Q3.',
        kpis: [{ name: 'monthly_churn_rate', targetValue: '<2%', timeframe: 'Q3 2026' }],
      },
      bad: { summary: 'Make billing better', kpis: [] },
      badRationale: 'No measurable target.',
    },
  ],
  scopeOverrides: {
    initiative: { required: true, minWords: 60 },
    epic: { required: true, minWords: 30 },
    module: { required: false },
    story: { required: false },
    task: { required: false },
    subtask: { required: false },
  },
};

// ─── Contract export ────────────────────────────────────────────────────────

export const poAgentContract: SectionContract = {
  ownerAgent: 'po',
  contractId: 'po-agent.v1',
  version: '1.0.0',
  appliesTo: ['initiative', 'epic', 'module', 'story', 'task', 'subtask'],
  sections: [
    scopeSpec,
    userPersonaSpec,
    lifecycleSpec,
    prioritySpec,
    linkedFeaturesSpec,
    parentEntitySpec,
    projectSpec,
    businessSubDomainsSpec,
    businessOutcomeSpec,
  ],
};
