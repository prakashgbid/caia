/**
 * Domain Triage Classifier (EA Multi-Domain Decomposition PR 2).
 *
 * Takes a ticket's title + description and determines which of 6 macro-domains
 * are in scope for the EA specialist mesh:
 * - ui: frontend / design / accessibility / UX
 * - backend: services / APIs / orchestration / async processing
 * - data: storage / schemas / migrations / ETL
 * - platform: infrastructure / deployment / observability / CI-CD
 * - quality-security: testing / a11y / security / performance
 * - integrations: external services / webhooks / SDKs
 *
 * Runs as Stage 1 of the mesh pipeline, before domain-specialists.ts.
 * Output: the set of inScopeDomains that will be parallelized in Stage 2.
 */

import { z } from 'zod';
import type { TechSubDomain } from '@chiefaia/ticket-template';
import { route } from '@chiefaia/local-llm-router';
import { classifyKeyword } from '@chiefaia/classifier';
import { inferTechSubDomains } from './ea-agent';
import type { TicketBundle } from '../api/ticket-bundle';

// ─── Macro-domain definitions ──────────────────────────────────────────────────

export const MACRO_DOMAINS = ['ui', 'backend', 'data', 'platform', 'quality-security', 'integrations'] as const;

export type MacroDomain = (typeof MACRO_DOMAINS)[number];

/**
 * Map from TECH_SUB_DOMAINS to macro-categories per proposal §5.1.
 * This is the breadth routing: which specialists should be activated.
 *
 * MUST cover every member of TECH_SUB_DOMAINS — the Record<TechSubDomain,...>
 * type guarantees this at compile-time.
 */
const TECH_TO_MACRO: Record<TechSubDomain, MacroDomain> = {
  // UI domain
  'frontend': 'ui',
  'design-system': 'ui',
  'accessibility': 'ui',
  'web-analytics': 'ui',
  'seo': 'ui',
  'localization-i18n': 'ui',

  // Backend domain
  'bff': 'backend',
  'backend': 'backend',
  'api-gateway': 'backend',
  'agent-runtime': 'backend',
  'event-driven': 'backend',
  'auth': 'backend',
  'caching': 'backend',
  'rate-limiting': 'backend',
  'file-storage': 'backend',
  'feature-flags': 'backend',
  'websockets': 'backend',

  // Data domain
  'database': 'data',
  'data-migration': 'data',
  'data-pipeline': 'data',

  // Platform domain
  'observability': 'platform',
  'monitoring-alerting': 'platform',
  'infra': 'platform',
  'ci-cd': 'platform',
  'cron-scheduling': 'platform',
  'secrets-management': 'platform',
  'dependency-management': 'platform',

  // Quality-security domain
  'testing': 'quality-security',
  'security': 'quality-security',
  'performance': 'quality-security',
  'compliance': 'quality-security',

  // Integrations domain
  'crm': 'integrations',
  'cms': 'integrations',
  'search': 'integrations',
  'payments': 'integrations',
  'email': 'integrations',
  'ml-ai': 'integrations',

  // Cross-cutting (default to backend; specialists handle nuance in Stage 2)
  'documentation': 'backend',
  'prompt-engineering': 'backend',
  'ticket-template': 'backend',
};

// ─── Output schema (Zod for LLM response parsing) ────────────────────────────

const TriageResultSchema = z.object({
  inScopeDomains: z.array(z.enum(MACRO_DOMAINS)).describe('Macro-domains in scope for specialist mesh'),
  reasoning: z.string().optional().describe('Why these domains were chosen'),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;

// ─── Triage logic ──────────────────────────────────────────────────────────────

/**
 * Run keyword-based triage as the first pass (fast, deterministic).
 * Returns the set of macro-domains inferred from tech sub-domains.
 */
function keywordTriage(text: string, primaryDomain: string): Set<MacroDomain> {
  const { all: techDomains } = inferTechSubDomains(text, primaryDomain);
  const macros = new Set<MacroDomain>();
  for (const tech of techDomains) {
    // inferTechSubDomains returns string[]; widen the Record lookup safely.
    const macro = (TECH_TO_MACRO as Record<string, MacroDomain | undefined>)[tech];
    if (macro) macros.add(macro);
  }
  // Always include backend as a baseline — most stories touch some service logic
  if (macros.size === 0) macros.add('backend');
  return macros;
}

/**
 * Run LLM-based triage to refine the keyword pass (validates hypothesis).
 * Uses the local router with Ollama-first, Claude fallback.
 */
async function llmTriage(
  text: string,
  keywordDomains: Set<MacroDomain>,
): Promise<Set<MacroDomain>> {
  const domainsList = Array.from(keywordDomains).join(', ');
  const prompt = `
You are a domain classification assistant for a code generation system.

Given the following ticket:
---
${text}
---

The keyword classifier identified these macro-domains as likely in scope:
${domainsList}

For each domain below, answer YES or NO (briefly):
1. UI (frontend / design / accessibility / UX) — does this ticket involve UI work?
2. Backend (services / APIs / orchestration / async) — does this ticket involve backend work?
3. Data (storage / schemas / migrations / ETL) — does this ticket involve data modeling or migration?
4. Platform (infra / observability / CI-CD) — does this ticket involve platform/operational work?
5. Quality-Security (testing / a11y / security / performance) — does this ticket primarily focus on QA/security/perf?
6. Integrations (external services / webhooks) — does this ticket involve external service integrations?

Return a JSON object with field inScopeDomains containing the list of domain IDs that are definitely in scope.
Only include domains where the answer is YES.
`;

  try {
    const response = await route('domain-triage', prompt, { forceLocal: true });
    const parsed = JSON.parse(response.response) as { inScopeDomains?: unknown };
    const refined = new Set<MacroDomain>();
    const list = Array.isArray(parsed.inScopeDomains) ? parsed.inScopeDomains : [];
    for (const domain of list) {
      if (typeof domain === 'string' && (MACRO_DOMAINS as readonly string[]).includes(domain)) {
        refined.add(domain as MacroDomain);
      }
    }
    // If LLM excluded everything, fall back to keywords
    return refined.size > 0 ? refined : keywordDomains;
  } catch (err) {
    // If LLM fails, fall back gracefully to keyword pass
    console.warn('[domain-triage] LLM call failed, using keyword domains:', err);
    return keywordDomains;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export interface DomainTriageOptions {
  /** Force local Ollama (no Claude fallback). Defaults true for triage. */
  forceLocal?: boolean;
  /** Skip LLM pass, use keywords only. Useful for testing. */
  keywordOnly?: boolean;
}

/**
 * Run domain triage to determine which macro-domains are in scope for specialists.
 *
 * @param ticketData The ticket to classify (title + description).
 * @param options Routing overrides.
 * @returns The set of inScopeDomains for Stage 2 specialists.
 */
export async function runDomainTriage(
  ticketData: { title: string; description: string; primaryDomain?: string },
  options: DomainTriageOptions = {},
): Promise<TriageResult> {
  const text = `${ticketData.title}\n${ticketData.description || ''}`;
  const primaryDomain = ticketData.primaryDomain || 'backend';

  // Stage 1: Keyword triage (fast)
  const keywordDomains = keywordTriage(text, primaryDomain);

  // Stage 2: LLM refinement (optional, validation)
  let refinedDomains: Set<MacroDomain>;
  if (options.keywordOnly) {
    refinedDomains = keywordDomains;
  } else {
    refinedDomains = await llmTriage(text, keywordDomains);
  }

  return {
    inScopeDomains: Array.from(refinedDomains).sort() as MacroDomain[],
    reasoning: `Keyword pass: ${Array.from(keywordDomains).join(', ')}. LLM refined to: ${Array.from(refinedDomains).join(', ')}`,
  };
}

/**
 * Bundle-friendly variant: pulls title/description from a TicketBundle and
 * derives primaryDomain via classifyKeyword (mirroring ba-agent + ea-agent).
 */
export async function runDomainTriageFromBundle(
  bundle: TicketBundle,
  options: DomainTriageOptions = {},
): Promise<TriageResult> {
  const title = bundle.story.title;
  const description = bundle.story.description || '';
  const classification = classifyKeyword(`${title} ${description}`);
  return runDomainTriage(
    {
      title,
      description,
      primaryDomain: classification.primaryDomain,
    },
    options,
  );
}
