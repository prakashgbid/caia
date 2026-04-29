/**
 * PO Agent (Product Owner Agent) — Tier 2
 *
 * Runs after the Scaffolder assembles the team for 'new-project' or 'new-feature' requests.
 * Responsibilities:
 *  1. Classify the prompt domain via @chiefaia/classifier
 *  2. Decompose into Initiative → Epic → Story → Task via @chiefaia/decomposer
 *  3. Persist requirements (one per epic) and stories to the database
 *  4. Emit po-agent.decomposition.complete onto the event bus
 */

import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { classifyKeyword } from '@chiefaia/classifier';
import { decompose } from '@chiefaia/decomposer';
import { eventBus } from '../events/bus-adapter';
import { getDb } from '../db/connection';
import { requirements, stories } from '../db/schema';
import { advancePipelineStage } from './pipeline-stages';
import { logger as rootLogger } from '../observability/logger';

const logger = rootLogger.child({ component: 'po-agent' });

export interface POAgentInput {
  promptId: string;
  promptText: string;
  projectId: string | null;
  correlationId: string;
}

export interface POAgentOutput {
  promptId: string;
  decomposition: Awaited<ReturnType<typeof decompose>>;
  classification: ReturnType<typeof classifyKeyword>;
  requirementsCreated: number;
  storiesCreated: number;
}

// ─── Main Agent Runner ───────────────────────────────────────────────────────

export async function runPOAgent(
  input: POAgentInput,
  db: ReturnType<typeof getDb>,
): Promise<POAgentOutput> {
  const { promptId, promptText, projectId, correlationId } = input;
  const now = new Date().toISOString();

  // 1. Classify the prompt domain
  const classification = classifyKeyword(promptText);

  // 2. Decompose into hierarchy (Claude if API key present, rule-based otherwise)
  const decomposition = await decompose(promptText);

  // 3. Persist to database — one requirement per epic, stories for each story node
  let requirementsCreated = 0;
  let storiesCreated = 0;

  for (const initiative of decomposition.hierarchy) {
    for (const epic of (initiative.children ?? [])) {
      // Create a requirement for each epic
      const reqId = `req-${epic.id}-${nanoid(4)}`;

      try {
        db.insert(requirements).values({
          id: reqId,
          title: epic.title,
          description: epic.description ?? '',
          state: 'captured',
          priority: 3,
          labels: JSON.stringify([classification.primaryDomain]),
          projectId: projectId ?? undefined,
          rootPromptId: promptId,
          parentEntityType: 'initiative',
          parentEntityId: initiative.id,
          createdAt: now,
          updatedAt: now,
        }).run();
        requirementsCreated++;
      } catch (err) {
        logger.warn('requirement insert skipped (may already exist)', { err: err instanceof Error ? err.message : String(err), reqId });
      }

      // Create a story row for each story node under this epic
      for (const story of (epic.children ?? [])) {
        if (story.level !== 'story') continue;

        const storyDbId = `story-${story.id}-${nanoid(4)}`;

        try {
          db.insert(stories).values({
            id: storyDbId,
            kind: 'story',
            title: story.title,
            description: story.description ?? '',
            acceptanceCriteriaJson: JSON.stringify(story.acceptanceCriteria ?? []),
            dependsOnJson: JSON.stringify(story.dependencies ?? []),
            status: 'pending',
            rootPromptId: promptId,
            parentEntityType: 'requirement',
            parentEntityId: reqId,
            createdAt: now,
          }).run();
          storiesCreated++;

          // Ticket state: draft (story exists, no enrichment yet).
          eventBus.publish({
            type: 'ticket.draft',
            actor: 'po-agent',
            correlation_id: correlationId,
            entity_type: 'story',
            entity_id: storyDbId,
            payload: { storyId: storyDbId, promptId, correlationId, requirementId: reqId },
          });
        } catch (err) {
          logger.warn('story insert skipped (may already exist)', { err: err instanceof Error ? err.message : String(err), storyDbId });
        }
      }
    }
  }

  // 4. Emit po-agent.decomposition.complete
  eventBus.publish({
    type: 'po-agent.decomposition.complete',
    actor: 'po-agent',
    correlation_id: correlationId,
    entity_type: 'prompt',
    entity_id: promptId,
    payload: {
      promptId,
      correlationId,
      requirementsCreated,
      storiesCreated,
      totalNodes: decomposition.totalNodes,
      summary: decomposition.summary,
      primaryDomain: classification.primaryDomain,
    },
  });

  // 5. Advance pipeline stage and emit per-story `ticket.po-decomposed`.
  advancePipelineStage(
    {
      promptId,
      stage: 'po_decomposed',
      correlationId,
      metadata: { requirementsCreated, storiesCreated, primaryDomain: classification.primaryDomain },
    },
    db,
  );

  // Emit ticket.po-decomposed for every story that exists under this prompt.
  try {
    const allStoriesForPrompt = db
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all();
    for (const s of allStoriesForPrompt) {
      eventBus.publish({
        type: 'ticket.po-decomposed',
        actor: 'po-agent',
        correlation_id: correlationId,
        entity_type: 'story',
        entity_id: s.id,
        payload: { storyId: s.id, promptId, correlationId, requirementsCreated },
      });
    }
  } catch {
    /* non-fatal — ticket events are observability */
  }

  return {
    promptId,
    decomposition,
    classification,
    requirementsCreated,
    storiesCreated,
  };
}
