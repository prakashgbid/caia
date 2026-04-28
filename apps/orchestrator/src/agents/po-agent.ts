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
import { classifyKeyword } from '@chiefaia/classifier';
import { decompose } from '@chiefaia/decomposer';
import { eventBus } from '../events/bus-adapter';
import { getDb } from '../db/connection';
import { requirements, stories } from '../db/schema';

// Logger shim — replaced at runtime by the real pino logger if available
const logger = {
  warn: (obj: Record<string, unknown>, msg: string) => {
    console.warn('[po-agent]', msg, obj);
  },
};

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
        logger.warn({ err, reqId }, 'PO Agent: requirement insert skipped (may already exist)');
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
        } catch (err) {
          logger.warn({ err, storyDbId }, 'PO Agent: story insert skipped (may already exist)');
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

  return {
    promptId,
    decomposition,
    classification,
    requirementsCreated,
    storiesCreated,
  };
}
