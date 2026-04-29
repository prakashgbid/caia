/**
 * EA Agent (Enterprise Architect) — Tier 2  (BUCKET-003).
 *
 * Runs after the PO Agent's decomposition completes; before the BA Agent
 * starts enrichment. The EA fills in the rest of the BUCKET-001 9-axis
 * taxonomy that PO didn't set:
 *   - tech_sub_domains_json + tech_sub_domain_primary
 *   - quality_tags_json
 *   - risk
 *   - effort
 *   - blocked_by_json (parsed from text refs like "after #STORY-X")
 *   - claims_json (BUCKET-009 staging — files / schemas / api routes / domains)
 *
 * The EA also enforces the proposal's §4.2 mutual exclusions before BA
 * picks the ticket up — it cannot fix every violation but flags the worst
 * (XL effort, critical risk + low priority, lifecycle-mismatch). When a
 * violation is unfixable, the EA marks the story's
 * `template_validation_status = 'invalid'` and writes a reason into
 * `template_validation_errors`.
 *
 * The EA is rule-based for MVP — keyword matching against
 * `TECH_SUB_DOMAINS` from `@chiefaia/ticket-template`. The regex / keyword
 * tables live local to this module so we don't pull `ticket-template` into
 * `@chiefaia/classifier`.
 */

import { eq } from 'drizzle-orm';
import { TECH_SUB_DOMAINS, QUALITY_TAGS } from '@chiefaia/ticket-template';
import { classifyKeyword } from '@chiefaia/classifier';
import { eventBus } from '../events/bus-adapter';
import { getDb } from '../db/connection';
import { stories } from '../db/schema';
import { advancePipelineStage } from './pipeline-stages';

// Logger shim — replaced at runtime by the real pino logger if available.
const logger = {
  warn: (obj: Record<string, unknown>, msg: string) => {
    console.warn('[ea-agent]', msg, obj);
  },
};

// ─── Inputs / outputs ────────────────────────────────────────────────────────

export interface EAAgentInput {
  promptId: string;
  correlationId: string;
}

export interface EAAgentOutput {
  promptId: string;
  storiesClassified: number;
  techSubDomainsAssigned: number;
  qualityTagsAssigned: number;
  blockedByMarkersFound: number;
  storiesWithCriticalRisk: number;
  storiesRequiringSplit: number;
}

// ─── Tech sub-domain inference ──────────────────────────────────────────────

/**
 * Keyword map from raw text to TECH_SUB_DOMAINS slugs. Most slugs match
 * themselves; the rest gain synonyms. The PO Agent's `primaryDomain`
 * (auth / ui-frontend / api-integration / data-storage / devops) is also
 * folded in via `mapPrimaryDomainToTech`.
 */
const TECH_KEYWORDS: Record<string, string[]> = {
  frontend: ['component', 'react', 'next.js', 'page', ' ui ', 'tsx', 'css', 'tailwind'],
  bff: ['route handler', 'api route', '/api/', 'hono', 'gateway'],
  backend: ['service', 'business logic', 'worker'],
  database: ['schema', 'migration', 'sqlite', 'postgres', 'drizzle', 'index'],
  'event-driven': ['event bus', 'pub/sub', 'queue', 'async messaging'],
  observability: ['log', 'metric', 'trace', 'pino', 'opentelemetry'],
  'web-analytics': ['ga4', 'mixpanel', 'analytics event', 'tracking'],
  crm: ['crm', 'customer relationship'],
  cms: ['sanity', 'contentful', 'cms'],
  search: ['elasticsearch', 'algolia', 'opensearch', 'embeddings'],
  auth: ['login', 'oauth', 'jwt', 'session', 'auth'],
  payments: ['stripe', 'checkout', 'invoice', 'subscription', 'payment'],
  email: ['sendgrid', 'resend', 'transactional email', 'marketing email'],
  caching: ['redis', 'cdn', 'cache'],
  infra: ['cloudflare', 'vercel', 'dns', 'hosting', 'infra'],
  'ci-cd': ['github actions', 'workflow', 'release pipeline'],
  'ml-ai': ['model', 'inference', 'training', 'prompt engineering'],
  testing: ['unit test', 'integration test', 'e2e test', 'playwright', 'vitest', 'behavior test'],
  accessibility: ['wcag', 'a11y', 'accessib', 'aria', 'keyboard nav'],
  seo: ['meta tag', 'sitemap', 'canonical', 'json-ld', 'og:'],
  security: ['threat model', 'vault', 'secret', 'csp', 'xss'],
  'localization-i18n': ['i18n', 'localization', 'translation', 'locale'],
  'design-system': ['design system', 'token', 'primitive'],
  documentation: ['readme', 'doc', 'adr', 'runbook'],
  'api-gateway': ['api gateway', 'edge router'],
  websockets: ['websocket', 'realtime push', ' ws '],
  'file-storage': ['r2', 's3', 'blob storage', 'file upload'],
  'rate-limiting': ['rate limit', 'throttle'],
  'feature-flags': ['feature flag', 'kill switch'],
  'monitoring-alerting': ['pagerduty', 'sentry', 'alert'],
  'secrets-management': ['vault', 'kms', 'env injection'],
  'dependency-management': ['renovate', 'dependabot', 'lockfile'],
  'data-pipeline': ['etl', 'batch job', 'warehouse'],
  'cron-scheduling': ['cron', 'scheduled task', 'recurring job'],
  'agent-runtime': ['agent', 'orchestrator', 'collab', 'po-agent', 'ba-agent', 'ea-agent'],
  'prompt-engineering': ['prompt template', 'prompt rule'],
  'ticket-template': ['ticket template', 'ticket-template'],
  'data-migration': ['backfill', 'data migration'],
  compliance: ['gdpr', 'aml', 'kyc', 'audit trail', 'compliance'],
  performance: ['lighthouse', 'profil', 'bundle size', 'load test'],
};

function mapPrimaryDomainToTech(primaryDomain: string): string[] {
  switch (primaryDomain) {
    case 'auth': return ['auth'];
    case 'ui-frontend': return ['frontend'];
    case 'api-integration': return ['bff', 'backend'];
    case 'data-storage': return ['database'];
    case 'devops': return ['infra', 'ci-cd'];
    default: return [];
  }
}

/** Score every TECH_SUB_DOMAIN against the text and return the top matches. */
export function inferTechSubDomains(text: string, primaryDomain: string): {
  primary: string;
  all: string[];
} {
  const lower = text.toLowerCase();
  const seedTech = mapPrimaryDomainToTech(primaryDomain);
  const scores: Record<string, number> = {};
  for (const seed of seedTech) scores[seed] = (scores[seed] ?? 0) + 2; // seeding bonus

  for (const [tech, kws] of Object.entries(TECH_KEYWORDS)) {
    const hits = kws.filter((k) => lower.includes(k)).length;
    if (hits > 0) scores[tech] = (scores[tech] ?? 0) + hits;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const valid = sorted.filter(([t]) => (TECH_SUB_DOMAINS as readonly string[]).includes(t));
  if (valid.length === 0) {
    return { primary: 'backend', all: ['backend'] };
  }
  const primary = valid[0]![0];
  // Cap total tech sub-domains at 5 to avoid noise.
  const all = valid.slice(0, 5).map(([t]) => t);
  return { primary, all };
}

// ─── Quality tags ───────────────────────────────────────────────────────────

const QUALITY_KEYWORDS: Record<string, string[]> = {
  accessibility: ['wcag', 'a11y', 'accessib', 'aria', 'keyboard nav', 'screen reader'],
  seo: ['seo', 'meta tag', 'sitemap', 'canonical', 'json-ld', 'og:', 'open graph'],
  performance: ['performance', 'lighthouse', 'bundle size', 'load test', 'profil'],
  security: ['security', 'threat', 'vault', 'csp', 'xss', 'csrf'],
  compliance: ['gdpr', 'aml', 'kyc', 'audit trail', 'compliance'],
  observability: ['observability', 'logging', 'tracing', 'metric', 'pino'],
  internationalization: ['i18n', 'localization', 'locale', 'translation'],
};

export function inferQualityTags(text: string): string[] {
  const lower = text.toLowerCase();
  const tags: string[] = [];
  for (const [tag, kws] of Object.entries(QUALITY_KEYWORDS)) {
    if (kws.some((k) => lower.includes(k))) tags.push(tag);
  }
  return tags.filter((t) => (QUALITY_TAGS as readonly string[]).includes(t));
}

// ─── Risk + effort ──────────────────────────────────────────────────────────

const HIGH_RISK_TECH = new Set(['auth', 'payments', 'database', 'compliance', 'secrets-management']);
const CRITICAL_RISK_TECH = new Set(['data-migration']);

export function inferRisk(
  techAll: string[],
  qualityTags: string[],
  lifecycle: string | null,
): 'low' | 'medium' | 'high' | 'critical' {
  if (techAll.some((t) => CRITICAL_RISK_TECH.has(t))) return 'critical';
  if (lifecycle === 'hotfix') return 'high';
  if (techAll.some((t) => HIGH_RISK_TECH.has(t))) return 'high';
  if (qualityTags.includes('compliance') || qualityTags.includes('security')) return 'high';
  if (lifecycle === 'docs' || lifecycle === 'chore') return 'low';
  return 'medium';
}

const COMPLEXITY_TO_EFFORT: Record<string, 'XS' | 'S' | 'M' | 'L' | 'XL'> = {
  trivial: 'XS',
  small: 'S',
  medium: 'M',
  large: 'L',
  xl: 'XL',
};

export function inferEffort(
  text: string,
  classifierComplexity: string,
): 'XS' | 'S' | 'M' | 'L' | 'XL' {
  const fromClassifier = COMPLEXITY_TO_EFFORT[classifierComplexity];
  if (fromClassifier) return fromClassifier;
  // Fallback: word count.
  const words = text.trim().split(/\s+/).length;
  if (words < 8) return 'XS';
  if (words < 24) return 'S';
  if (words < 80) return 'M';
  if (words < 200) return 'L';
  return 'XL';
}

// ─── Blocked-by parser ─────────────────────────────────────────────────────

const BLOCKED_BY_PATTERNS = [
  /\bafter\s+#?(story[-_][a-z0-9-]+)/gi,
  /\bdepends\s+on\s+#?(story[-_][a-z0-9-]+)/gi,
  /\bblocked\s+by\s+#?(story[-_][a-z0-9-]+)/gi,
];

export function inferBlockedBy(text: string): string[] {
  const found = new Set<string>();
  for (const re of BLOCKED_BY_PATTERNS) {
    const matches = [...text.matchAll(re)];
    for (const m of matches) {
      if (m[1]) found.add(m[1].toLowerCase());
    }
  }
  return Array.from(found);
}

// ─── Claims inference (BUCKET-009 staging) ─────────────────────────────────

export interface InferredClaims {
  files: string[];
  schemas: string[];
  apiRoutes: string[];
  domains: string[];
}

export function inferClaims(text: string, techAll: string[]): InferredClaims {
  // Files mentioned (very conservative — only obvious paths).
  const fileMatches = [
    ...text.matchAll(/[\w-]+\/[\w./-]+\.(?:ts|tsx|js|jsx|sql|md|json|yaml|yml|css)/g),
  ].map((m) => m[0]);

  // API routes mentioned.
  const routeMatches = [
    ...text.matchAll(/\b(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[\w/:-]+)/g),
  ].map((m) => `${m[0]}`);

  // Schema names mentioned (conservative — table.column or just SQL keywords).
  const schemaMatches = [...text.matchAll(/\b([a-z_][a-z0-9_]+)\.(\w+)/gi)]
    .map((m) => `${m[1]}.${m[2]}`)
    .filter((s) => s.includes('_') || s.endsWith('_json') || /(?:stories|requirements|tasks|prompts|task_buckets)\./.test(s));

  return {
    files: Array.from(new Set(fileMatches)),
    schemas: Array.from(new Set(schemaMatches)),
    apiRoutes: Array.from(new Set(routeMatches)),
    // Coarse fallback: union of techSubDomains.
    domains: Array.from(new Set(techAll)),
  };
}

// ─── Mutual-exclusion enforcement ──────────────────────────────────────────

export interface ValidationViolation {
  field: string;
  message: string;
}

export function validateTaxonomyInvariants(args: {
  effort: string;
  risk: string;
  priorityBucket: string | null;
  lifecycle: string | null;
}): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  if (args.effort === 'XL') {
    violations.push({ field: 'effort', message: 'effort=XL must be split into smaller stories' });
  }
  if (args.risk === 'critical' && args.priorityBucket && !['P0', 'P1'].includes(args.priorityBucket)) {
    violations.push({
      field: 'priorityBucket',
      message: 'risk=critical requires priorityBucket in {P0, P1}',
    });
  }
  if (args.lifecycle === 'spike' && !['XS', 'S', 'M'].includes(args.effort)) {
    violations.push({ field: 'effort', message: 'lifecycle=spike requires effort in {XS, S, M}' });
  }
  return violations;
}

// ─── Main agent runner ─────────────────────────────────────────────────────

export async function runEAAgent(
  input: EAAgentInput,
  db: ReturnType<typeof getDb>,
): Promise<EAAgentOutput> {
  const { promptId, correlationId } = input;

  const allStories = db
    .select()
    .from(stories)
    .where(eq(stories.rootPromptId, promptId))
    .all();

  let storiesClassified = 0;
  let techSubDomainsAssigned = 0;
  let qualityTagsAssigned = 0;
  let blockedByMarkersFound = 0;
  let storiesWithCriticalRisk = 0;
  let storiesRequiringSplit = 0;

  for (const story of allStories) {
    try {
      const storyText = `${story.title} ${story.description ?? ''}`;
      const classification = classifyKeyword(storyText);

      const tech = inferTechSubDomains(storyText, classification.primaryDomain);
      const quality = inferQualityTags(storyText);
      const risk = inferRisk(tech.all, quality, story.lifecycle ?? null);
      const effort = inferEffort(storyText, classification.complexity);
      const blockedBy = inferBlockedBy(storyText);
      const claims = inferClaims(storyText, tech.all);

      const violations = validateTaxonomyInvariants({
        effort,
        risk,
        priorityBucket: story.priorityBucket ?? null,
        lifecycle: story.lifecycle ?? null,
      });

      if (effort === 'XL') storiesRequiringSplit++;
      if (risk === 'critical') storiesWithCriticalRisk++;

      const validationStatus = violations.length > 0 ? 'invalid' : story.templateValidationStatus;
      const validationErrors =
        violations.length > 0 ? JSON.stringify(violations) : story.templateValidationErrors;

      db.update(stories)
        .set({
          techSubDomainsJson: JSON.stringify(tech.all),
          techSubDomainPrimary: tech.primary,
          qualityTagsJson: JSON.stringify(quality),
          risk,
          effort,
          blockedByJson: JSON.stringify(blockedBy),
          claimsJson: JSON.stringify(claims),
          templateValidationStatus: validationStatus,
          templateValidationErrors: validationErrors,
        })
        .where(eq(stories.id, story.id))
        .run();

      storiesClassified++;
      techSubDomainsAssigned += tech.all.length;
      qualityTagsAssigned += quality.length;
      blockedByMarkersFound += blockedBy.length;
    } catch (err) {
      logger.warn({ err, storyId: story.id }, 'EA Agent: story classification failed');
    }
  }

  // Advance pipeline to ea_classified (between po_decomposed and ba_enriched).
  advancePipelineStage(
    {
      promptId,
      stage: 'ea_classified',
      correlationId,
      metadata: {
        storiesClassified,
        techSubDomainsAssigned,
        qualityTagsAssigned,
        storiesWithCriticalRisk,
        storiesRequiringSplit,
      },
    },
    db,
  );

  eventBus.publish({
    type: 'ea-agent.classification.complete',
    actor: 'ea-agent',
    correlation_id: correlationId,
    entity_type: 'prompt',
    entity_id: promptId,
    payload: {
      promptId,
      correlationId,
      storiesClassified,
      techSubDomainsAssigned,
      qualityTagsAssigned,
      blockedByMarkersFound,
      storiesWithCriticalRisk,
      storiesRequiringSplit,
    },
  });

  return {
    promptId,
    storiesClassified,
    techSubDomainsAssigned,
    qualityTagsAssigned,
    blockedByMarkersFound,
    storiesWithCriticalRisk,
    storiesRequiringSplit,
  };
}
