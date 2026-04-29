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
import {
  classifyKeyword,
  classifyProject,
  classifyBusinessSubDomains,
  classifyLifecycle,
  classifyPriority,
} from '@chiefaia/classifier';
import { decompose } from '@chiefaia/decomposer';
import { eventBus } from '../events/bus-adapter';
import { getDb } from '../db/connection';
import { requirements, stories } from '../db/schema';
import { advancePipelineStage } from './pipeline-stages';

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
  /** BUCKET-002 — prompt-level taxonomy returned for callers + tests. */
  taxonomy: {
    project: string;
    projectConfidence: number;
    lifecycle: string;
    priorityBucket: string;
  };
}

// ─── Main Agent Runner ───────────────────────────────────────────────────────

export async function runPOAgent(
  input: POAgentInput,
  db: ReturnType<typeof getDb>,
): Promise<POAgentOutput> {
  const { promptId, promptText, projectId, correlationId } = input;
  const now = new Date().toISOString();

  // 1. Classify the prompt domain (legacy primaryDomain) plus the new
  //    BUCKET-002 9-axis taxonomy fields (project / lifecycle / priority on
  //    the prompt; per-story businessSubDomains computed below).
  const classification = classifyKeyword(promptText);
  const projectClassification = classifyProject(promptText);
  const promptLifecycle = classifyLifecycle(promptText);
  const promptPriority = classifyPriority(promptText);

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

        // BUCKET-002 — per-story taxonomy. project + priority are inherited
        // from the prompt-level classification; lifecycle is re-classified
        // on the story body so a "fix bug X" story under a "build feature Y"
        // prompt gets the correct lifecycle. business sub-domains are
        // computed against the prompt-pinned project.
        const storyText = `${story.title} ${story.description ?? ''}`;
        const storyLifecycle = classifyLifecycle(storyText) || promptLifecycle;
        const storyBusinessSubDomains = classifyBusinessSubDomains(
          storyText,
          projectClassification.slug,
        );

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
            // BUCKET-002 — 9-axis taxonomy fields populated by PO. EA fills
            // techSubDomains/qualityTags/risk/effort/blockedBy in BUCKET-003.
            projectSlug: projectClassification.slug,
            businessSubDomainsJson: JSON.stringify(storyBusinessSubDomains),
            lifecycle: storyLifecycle,
            priorityBucket: promptPriority,
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
          logger.warn({ err, storyDbId }, 'PO Agent: story insert skipped (may already exist)');
        }
      }
    }
  }

  // 4. Emit po-agent.decomposition.complete — payload now includes the
  //    BUCKET-002 prompt-level taxonomy so downstream agents (EA, BA,
  //    Validator, Testing) can read it without re-running the classifier.
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
      // BUCKET-002 prompt-level classification.
      project: projectClassification.slug,
      projectConfidence: projectClassification.confidence,
      lifecycle: promptLifecycle,
      priorityBucket: promptPriority,
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
    taxonomy: {
      project: projectClassification.slug,
      projectConfidence: projectClassification.confidence,
      lifecycle: promptLifecycle,
      priorityBucket: promptPriority,
    },
  };
}
