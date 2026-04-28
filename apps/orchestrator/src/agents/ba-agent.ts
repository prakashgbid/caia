/**
 * BA Agent (Business Analyst Agent) — Tier 2
 *
 * Runs after the PO Agent completes story decomposition.
 *
 * Phase-1 responsibilities:
 *  1. Generate deterministic, testable acceptance criteria per story.
 *  2. Generate implementation notes (technical layer + approach).
 *  3. Collaborate with N domain consultants via the agent_messages
 *     request/response protocol — request architecture, database, api, ui,
 *     security, testing, release, observability sections.
 *  4. Aggregate replies into the strict TicketTemplateV1 payload, validate,
 *     and persist into stories.agent_contributions_json /
 *     template_validation_status / template_validation_errors.
 *  5. Emit ba-agent.enrichment.complete.
 *
 * Domain consultants currently respond synchronously via the rule-based
 * `domain-responders` registry (see {@link runDomainConsultants}). Future
 * LLM-backed agents can subscribe to `ba-agent.input-requested` and reply via
 * {@link replyToRequest} — the protocol works the same either way.
 */

import { classifyKeyword } from '@chiefaia/classifier';
import {
  AGENT_SECTION_KEYS,
  COMPLEXITY_VALUES,
  NATURE_VALUES,
  TICKET_TEMPLATE_VERSION,
  TicketTemplateV1,
  buildDraftTicket,
  validateTicket,
} from '@chiefaia/ticket-template';
import { eq } from 'drizzle-orm';
import { eventBus } from '../events/bus-adapter';
import { getDb } from '../db/connection';
import { stories } from '../db/schema';
import {
  awaitReplies,
  emitInputReceived,
  replyToRequest,
  sendInputRequest,
} from './agent-collab';
import {
  DOMAIN_RESPONDERS,
  type DomainResponderName,
  type ResponderInput,
  selectConsultants,
} from './domain-responders';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BAAgentInput {
  promptId: string;
  /** If provided, enriches only stories whose parentEntityId matches this requirement ID. */
  requirementId?: string;
  correlationId: string;
  /** Override the default consultant set (used in tests). */
  consultants?: DomainResponderName[];
  /** Per-round wait budget for awaitReplies (ms). Default 2_000. */
  collabTimeoutMs?: number;
}

export interface BAAgentOutput {
  enrichedStories: number;
  storiesWithAcceptanceCriteria: number;
  averageAcceptanceCriteriaCount: number;
  ticketsValid: number;
  ticketsInvalid: number;
}

// ─── Acceptance Criteria (rule-based heuristics) ─────────────────────────────

function generateAcceptanceCriteria(story: { title: string; description: string }): string[] {
  const criteria: string[] = [];
  const lower = (story.title + ' ' + story.description).toLowerCase();

  criteria.push(
    `Given the "${story.title}" feature exists, when a user interacts with it, then it behaves as described`,
  );
  criteria.push('All associated unit tests pass with no regressions');
  criteria.push('No TypeScript compilation errors introduced');

  if (
    lower.includes('ui') ||
    lower.includes('component') ||
    lower.includes('page') ||
    lower.includes('form') ||
    lower.includes('dashboard') ||
    lower.includes('modal') ||
    lower.includes('button')
  ) {
    criteria.push('Component renders correctly on mobile (375 px) and desktop (1280 px)');
    criteria.push('Meets WCAG 2.1 AA accessibility requirements');
    criteria.push('Loading and error states are handled gracefully with user-friendly messaging');
  }

  if (
    lower.includes('api') ||
    lower.includes('endpoint') ||
    lower.includes('route') ||
    lower.includes('handler')
  ) {
    criteria.push('API returns correct HTTP status codes (200, 201, 400, 401, 404, 500)');
    criteria.push('Request validation rejects malformed inputs with descriptive error messages');
    criteria.push('Response time is under 500 ms at the 95th percentile under normal load');
  }

  if (
    lower.includes('auth') ||
    lower.includes('login') ||
    lower.includes('permission') ||
    lower.includes('role') ||
    lower.includes('session') ||
    lower.includes('token')
  ) {
    criteria.push('Unauthorised users receive 401; forbidden users receive 403');
    criteria.push('Authentication tokens are validated on every protected request');
    criteria.push('Session handling is secure (httpOnly cookies or Bearer tokens only)');
  }

  if (
    lower.includes('database') ||
    lower.includes('schema') ||
    lower.includes('migration') ||
    lower.includes('drizzle') ||
    lower.includes('table')
  ) {
    criteria.push('Migration runs cleanly against a fresh database with no errors');
    criteria.push('Migration is reversible or ships with an explicit down-migration');
    criteria.push('No data loss occurs for existing rows after migration is applied');
  }

  // Cap at 6 — keeps stories actionable, not overwhelming.
  return criteria.slice(0, 6);
}

// ─── Implementation notes ───────────────────────────────────────────────────

function generateImplementationNotes(story: { title: string; description: string }): string {
  const text = story.title + ' ' + story.description;
  const classification = classifyKeyword(text);

  const lines: string[] = [
    `Domain: ${classification.primaryDomain} | Layer: ${classification.layer}`,
    `Complexity: ${classification.complexity} | Nature: ${classification.nature}`,
  ];

  switch (classification.primaryDomain) {
    case 'ui-frontend':
      lines.push(
        'Approach: Create/extend React component following the existing design system. ' +
          'Match dashboard dark-theme styles. Use SWR for any data-fetching; avoid prop-drilling.',
      );
      break;
    case 'api-integration':
      lines.push(
        'Approach: Add Hono route following existing route patterns. ' +
          'Validate input with Zod. Return consistent { data, error } JSON shape.',
      );
      break;
    case 'data-storage':
      lines.push(
        'Approach: Write a Drizzle migration SQL file, update schema.ts, ' +
          'run pnpm drizzle-kit generate, then test on a fresh DB before committing.',
      );
      break;
    case 'auth':
      lines.push(
        'Approach: Extend existing auth middleware. Never log credentials. ' +
          'Reuse current session-management helpers — do not invent new patterns.',
      );
      break;
    case 'devops':
      lines.push(
        'Approach: Update CI/CD config files. Validate with a dry-run before ' +
          'merging. Ensure environment secrets are stored in the secrets broker.',
      );
      break;
    default:
      lines.push(
        'Approach: Scan existing codebase for similar patterns before writing new code. ' +
          'Prefer extension over duplication.',
      );
  }

  lines.push(
    'Testing: Write unit tests using Vitest. Add ≥1 integration test. ' +
      'Run pnpm test locally before opening a PR.',
  );

  return lines.join('\n');
}

// ─── Cross-agent collaboration round ─────────────────────────────────────────

interface CollaborationOutcome {
  agentSections: TicketTemplateV1['agentSections'];
  inputsRequested: NonNullable<TicketTemplateV1['baEnrichment']>['inputsRequested'];
  repliesReceived: string[];
  repliesTimedOut: string[];
}

/**
 * Run a full BA collaboration round for one story:
 *  1. Send `input-requested` to each consultant via the protocol.
 *  2. For consultants in {@link DOMAIN_RESPONDERS}, synthesise an immediate
 *     reply via the rule-based responder. Future LLM-backed agents can
 *     subscribe to the request event and reply asynchronously.
 *  3. `awaitReplies` until every consultant has answered or the budget elapses.
 *  4. Build the `agentSections` payload from the replies.
 */
async function runDomainConsultants(params: {
  promptId: string;
  storyId: string;
  correlationId: string;
  consultants: DomainResponderName[];
  responderInput: ResponderInput;
  collabTimeoutMs: number;
  db: ReturnType<typeof getDb>;
}): Promise<CollaborationOutcome> {
  const {
    promptId,
    storyId,
    correlationId,
    consultants,
    responderInput,
    collabTimeoutMs,
    db,
  } = params;

  const requestIds = new Map<DomainResponderName, string>();
  const expectedReplyBy = Date.now() + collabTimeoutMs;

  // 1. Send requests.
  for (const consultant of consultants) {
    const reqId = sendInputRequest(
      {
        fromAgent: 'ba-agent',
        toAgent: consultant,
        correlationId,
        expectedReplyBy,
        payload: { storyId, promptId, responderInput },
      },
      db,
    );
    requestIds.set(consultant, reqId);
  }

  // 2. Synthesise replies via the rule-based responders. Wrapped in a
  //    fire-and-forget Promise so awaitReplies has something to observe; in
  //    a real LLM-backed setup these would be replaced by async subscribers.
  for (const consultant of consultants) {
    const reqId = requestIds.get(consultant)!;
    const entry = DOMAIN_RESPONDERS[consultant];
    if (!entry) continue;
    const sectionPayload = entry.responder(responderInput);
    replyToRequest(
      {
        requestMessageId: reqId,
        fromAgent: consultant,
        payload: { sectionKey: entry.sectionKey, section: sectionPayload },
      },
      db,
    );
  }

  // 3. Aggregate.
  const result = await awaitReplies(
    {
      fromAgent: 'ba-agent',
      correlationId,
      expectedAgents: consultants,
    },
    db,
    { timeoutMs: collabTimeoutMs, pollIntervalMs: 5 },
  );

  emitInputReceived({ promptId, storyId, correlationId, result });

  // 4. Build agentSections from replies.
  const agentSections: TicketTemplateV1['agentSections'] = {};
  const ts = Date.now();
  for (const reply of result.replies) {
    const payload = reply.payload as
      | { sectionKey?: string; section?: Record<string, unknown> }
      | null;
    if (!payload?.sectionKey || !payload.section) continue;
    if (!(AGENT_SECTION_KEYS as readonly string[]).includes(payload.sectionKey)) continue;
    const sectionKey = payload.sectionKey as keyof TicketTemplateV1['agentSections'];
    // Each section requires `contributedBy` + `contributedAt`; the BA stamps them.
    (agentSections as Record<string, unknown>)[sectionKey] = {
      ...payload.section,
      contributedBy: reply.fromAgent,
      contributedAt: reply.repliedAt || ts,
    };
  }

  const inputsRequested = consultants.map((agent) => {
    const reply = result.replies.find((r) => r.fromAgent === agent);
    return {
      agent,
      correlationId: requestIds.get(agent)!,
      status: (reply ? 'replied' : 'timed_out') as 'replied' | 'timed_out',
      expectedReplyBy,
      repliedAt: reply?.repliedAt,
    };
  });

  return {
    agentSections,
    inputsRequested,
    repliesReceived: result.replies.map((r) => r.fromAgent),
    repliesTimedOut: result.timedOutAgents,
  };
}

// ─── Coerce classifier values to template enums ─────────────────────────────

function coerceNature(value: string): (typeof NATURE_VALUES)[number] {
  const v = value as (typeof NATURE_VALUES)[number];
  return (NATURE_VALUES as readonly string[]).includes(v) ? v : 'feature';
}

function coerceComplexity(value: string): (typeof COMPLEXITY_VALUES)[number] {
  const v = value as (typeof COMPLEXITY_VALUES)[number];
  return (COMPLEXITY_VALUES as readonly string[]).includes(v) ? v : 'medium';
}

// ─── Main Agent Runner ───────────────────────────────────────────────────────

export async function runBAAgent(
  input: BAAgentInput,
  db: ReturnType<typeof getDb>,
): Promise<BAAgentOutput> {
  const {
    promptId,
    requirementId,
    correlationId,
    collabTimeoutMs = 2_000,
  } = input;
  const now = Date.now();

  const storiesToEnrich = requirementId
    ? await db.select().from(stories).where(eq(stories.parentEntityId, requirementId))
    : await db.select().from(stories).where(eq(stories.rootPromptId, promptId));

  let enrichedCount = 0;
  let withCriteriaCount = 0;
  let totalCriteria = 0;
  let ticketsValid = 0;
  let ticketsInvalid = 0;

  for (const story of storiesToEnrich) {
    try {
      const title = story.title;
      const description = story.description ?? '';
      const acceptanceCriteria = generateAcceptanceCriteria({ title, description });
      const implNotes = generateImplementationNotes({ title, description });
      const classification = classifyKeyword(`${title} ${description}`);

      // Run cross-agent collaboration to populate the per-agent sections.
      const consultants =
        input.consultants ?? selectConsultants(classification.primaryDomain);

      const responderInput: ResponderInput = {
        title,
        description,
        primaryDomain: classification.primaryDomain,
        layer: classification.layer,
        complexity: classification.complexity,
        nature: classification.nature,
        acceptanceCriteria,
      };

      const collab = await runDomainConsultants({
        promptId,
        storyId: story.id,
        correlationId: `${correlationId}::${story.id}`,
        consultants,
        responderInput,
        collabTimeoutMs,
        db,
      });

      // Build the ticket-template payload.
      let dependsOn: string[] = [];
      try {
        const parsed = JSON.parse(story.dependsOnJson ?? '[]');
        if (Array.isArray(parsed)) dependsOn = parsed.filter((d): d is string => typeof d === 'string');
      } catch {
        /* malformed JSON treated as no deps */
      }

      const draft = buildDraftTicket({
        rootPromptId: promptId,
        requirementId: story.parentEntityId ?? '',
        domainPrimary: classification.primaryDomain,
        domainAll: [classification.primaryDomain, classification.layer].filter(Boolean),
        nature: coerceNature(classification.nature),
        complexity: coerceComplexity(classification.complexity),
        summary: title,
        inScope: [title],
        outOfScope: [],
        acceptanceCriteria,
        verificationPlan: ['pnpm test', 'manual smoke test'],
        upstream: dependsOn,
        files: [],
        poDecomposedAt: now,
      });

      const ticket: TicketTemplateV1 = {
        ...draft,
        agentSections: collab.agentSections,
        baEnrichment: {
          enrichedBy: 'ba-agent',
          enrichedAt: now,
          inputsRequested: collab.inputsRequested,
          completenessChecksPassed: collab.repliesTimedOut.length === 0,
          notes:
            collab.repliesTimedOut.length === 0
              ? 'All consultants replied within the budget.'
              : `Consultants that timed out: ${collab.repliesTimedOut.join(', ')}.`,
        },
        metadata: {
          templateVersion: TICKET_TEMPLATE_VERSION,
          poDecomposedAt: draft.metadata.poDecomposedAt,
          baEnrichedAt: now,
          lastUpdatedAt: now,
        },
      };

      const validation = validateTicket(ticket);
      const status = validation.ok ? 'valid' : 'invalid';
      if (validation.ok) ticketsValid++;
      else ticketsInvalid++;

      await db
        .update(stories)
        .set({
          acceptanceCriteriaJson: JSON.stringify(acceptanceCriteria),
          implementationNotes: implNotes,
          updatedAt: now,
          enrichedAt: now,
          agentContributionsJson: JSON.stringify(ticket),
          templateVersion: TICKET_TEMPLATE_VERSION,
          templateValidationStatus: status,
          templateValidationErrors: validation.ok
            ? null
            : JSON.stringify(validation.errors),
        })
        .where(eq(stories.id, story.id));

      enrichedCount++;
      if (acceptanceCriteria.length > 0) {
        withCriteriaCount++;
        totalCriteria += acceptanceCriteria.length;
      }
    } catch {
      // Non-fatal — continue enriching remaining stories.
    }
  }

  eventBus.publish({
    type: 'ba-agent.enrichment.complete',
    actor: 'ba-agent',
    correlation_id: correlationId,
    entity_type: 'prompt',
    entity_id: promptId,
    payload: {
      promptId,
      correlationId,
      enrichedStories: enrichedCount,
      storiesWithAcceptanceCriteria: withCriteriaCount,
      ticketsValid,
      ticketsInvalid,
    },
  });

  return {
    enrichedStories: enrichedCount,
    storiesWithAcceptanceCriteria: withCriteriaCount,
    averageAcceptanceCriteriaCount: enrichedCount > 0 ? totalCriteria / enrichedCount : 0,
    ticketsValid,
    ticketsInvalid,
  };
}
