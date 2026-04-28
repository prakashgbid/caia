/**
 * BA Agent (Business Analyst Agent) — Tier 2
 *
 * Runs after the PO Agent completes story decomposition.
 * Enriches each story with:
 *  - Detailed, testable acceptance criteria (rule-based heuristics)
 *  - Implementation notes (technical approach, domain classification)
 *  - Timestamps for enrichedAt / updatedAt
 *
 * Claude enhancement can be plugged in later per the Living Library ADR.
 */

import { classifyKeyword } from '../../packages/classifier/src/index.js';
import { eventBus } from '../events/bus-adapter.js';
import { getDb } from '../db/connection.js';
import { stories } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface BAAgentInput {
  promptId: string;
  /** If provided, enriches only stories whose parentEntityId matches this requirement ID. */
  requirementId?: string;
  correlationId: string;
}

export interface BAAgentOutput {
  enrichedStories: number;
  storiesWithAcceptanceCriteria: number;
  averageAcceptanceCriteriaCount: number;
}

// ─── Acceptance Criteria ─────────────────────────────────────────────────────

/**
 * Generates deterministic, testable acceptance criteria from story text.
 * Max 6 criteria per story — base set (3) + domain-specific conditionals.
 */
function generateAcceptanceCriteria(story: { title: string; description: string }): string[] {
  const criteria: string[] = [];
  const lower = (story.title + ' ' + story.description).toLowerCase();

  // Always-present base criteria
  criteria.push(
    `Given the "${story.title}" feature exists, when a user interacts with it, then it behaves as described`,
  );
  criteria.push('All associated unit tests pass with no regressions');
  criteria.push('No TypeScript compilation errors introduced');

  // UI / frontend
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

  // API / backend routes
  if (
    lower.includes('api') ||
    lower.includes('endpoint') ||
    lower.includes('route') ||
    lower.includes('handler') ||
    lower.includes('rest') ||
    lower.includes('graphql')
  ) {
    criteria.push('API returns correct HTTP status codes (200, 201, 400, 401, 404, 500)');
    criteria.push('Request validation rejects malformed inputs with descriptive error messages');
    criteria.push('Response time is under 500 ms at the 95th percentile under normal load');
  }

  // Auth / permissions
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

  // Database / schema / migrations
  if (
    lower.includes('database') ||
    lower.includes('schema') ||
    lower.includes('migration') ||
    lower.includes('drizzle') ||
    lower.includes('sqlite') ||
    lower.includes('table')
  ) {
    criteria.push('Migration runs cleanly against a fresh database with no errors');
    criteria.push('Migration is reversible or ships with an explicit down-migration');
    criteria.push('No data loss occurs for existing rows after migration is applied');
  }

  // Search / filtering
  if (
    lower.includes('search') ||
    lower.includes('filter') ||
    lower.includes('query') ||
    lower.includes('sort') ||
    lower.includes('paginate')
  ) {
    criteria.push('Search returns results within 200 ms for standard queries');
    criteria.push('Empty result sets display a helpful "no results" state');
    criteria.push('Search handles special characters and edge-case inputs without throwing');
  }

  // Payments / billing
  if (
    lower.includes('payment') ||
    lower.includes('billing') ||
    lower.includes('subscription') ||
    lower.includes('invoice') ||
    lower.includes('stripe')
  ) {
    criteria.push('Payment failure surfaces a clear error without exposing sensitive card data');
    criteria.push('Successful payment triggers a confirmation email within 30 seconds');
    criteria.push('All payment operations are idempotent and safe to retry on transient failure');
  }

  // Cap at 6 — keeps stories actionable, not overwhelming
  return criteria.slice(0, 6);
}

// ─── Implementation Notes ────────────────────────────────────────────────────

/**
 * Generates terse implementation notes using the @chiefaia/classifier taxonomy.
 * Includes domain classification metadata so engineers know the technical layer
 * before opening a file.
 */
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

// ─── Main Agent Runner ───────────────────────────────────────────────────────

export async function runBAAgent(
  input: BAAgentInput,
  db: ReturnType<typeof getDb>,
): Promise<BAAgentOutput> {
  const { promptId, requirementId, correlationId } = input;
  const now = Date.now();

  // Query stories — either scoped to one requirement (by parentEntityId) or all
  // stories that share the same rootPromptId.
  let storiesToEnrich: Array<typeof stories.$inferSelect>;

  if (requirementId) {
    storiesToEnrich = await db
      .select()
      .from(stories)
      .where(eq(stories.parentEntityId, requirementId));
  } else {
    storiesToEnrich = await db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId));
  }

  let enrichedCount = 0;
  let withCriteriaCount = 0;
  let totalCriteria = 0;

  for (const story of storiesToEnrich) {
    try {
      const criteria = generateAcceptanceCriteria({
        title: story.title,
        description: story.description ?? '',
      });
      const implNotes = generateImplementationNotes({
        title: story.title,
        description: story.description ?? '',
      });

      await db
        .update(stories)
        .set({
          acceptanceCriteriaJson: JSON.stringify(criteria),
          implementationNotes: implNotes,
          updatedAt: now,
          enrichedAt: now,
        })
        .where(eq(stories.id, story.id));

      enrichedCount++;
      if (criteria.length > 0) {
        withCriteriaCount++;
        totalCriteria += criteria.length;
      }
    } catch {
      // Non-fatal — continue enriching remaining stories
    }
  }

  // Emit completion event onto the in-process bus (also persisted to DB outbox)
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
    },
  });

  return {
    enrichedStories: enrichedCount,
    storiesWithAcceptanceCriteria: withCriteriaCount,
    averageAcceptanceCriteriaCount:
      enrichedCount > 0 ? totalCriteria / enrichedCount : 0,
  };
}
