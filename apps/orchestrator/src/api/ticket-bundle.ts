/**
 * Ticket bundle assembler — returns the self-contained payload an executor
 * needs to pick up a story without further DB queries.
 *
 * Bundle = story row + parsed TicketTemplateV1 (validated) + linked
 * requirement row + bucket row + entity_label set + dependency / dependent
 * id lists.
 *
 * Used by `GET /stories/:id/bundle` (see api/routes/stories.ts) and by the
 * Phase 1 E2E test to assert the pipeline produced a valid, complete
 * ticket end-to-end.
 */

import { eq, and } from 'drizzle-orm';
import {
  TicketTemplateV1Schema,
  type TicketTemplateV1,
} from '@chiefaia/ticket-template';
import type { Db } from '../db/connection';
import {
  entityLabels,
  prompts,
  requirements,
  stories,
  taskBuckets,
} from '../db/schema';

export interface TicketBundle {
  story: {
    id: string;
    title: string;
    description: string;
    status: string;
    rootPromptId: string | null;
    parentEntityId: string | null;
    parentEntityType: string | null;
    bucketId: string | null;
    templateVersion: string;
    templateValidationStatus: string;
    templateValidationErrors: unknown[] | null;
    enrichedAt: number | null;
    updatedAt: number | null;
  };
  ticket: TicketTemplateV1 | null;
  ticketParseError: string | null;
  prompt: {
    id: string;
    body: string;
    receivedAt: string;
    correlationId: string;
    status: string;
  } | null;
  requirement: {
    id: string;
    title: string;
    description: string;
    state: string;
  } | null;
  bucket: {
    id: string;
    kind: 'sequential' | 'parallel';
    domainSlug: string | null;
    sequenceIndex: number | null;
    status: string;
  } | null;
  labels: Array<{
    labelSlug: string;
    labelType: string;
    confidence: number;
    source: string;
  }>;
  dependencies: {
    upstream: string[];
    downstream: string[];
  };
}

function safeParseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((d): d is string => typeof d === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseTicket(raw: string | null | undefined): {
  ticket: TicketTemplateV1 | null;
  parseError: string | null;
} {
  if (!raw) return { ticket: null, parseError: 'agent_contributions_json is empty' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ticket: null, parseError: `JSON.parse failed: ${(err as Error).message}` };
  }
  // Empty `{}` is a valid stub and not an error — return null without an error.
  if (
    json &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    Object.keys(json as Record<string, unknown>).length === 0
  ) {
    return { ticket: null, parseError: null };
  }
  const result = TicketTemplateV1Schema.safeParse(json);
  if (result.success) return { ticket: result.data, parseError: null };
  const summary = result.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
  return { ticket: null, parseError: `schema validation failed: ${summary}` };
}

function parseValidationErrors(raw: string | null | undefined): unknown[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Assemble the full bundle for a story id. Returns null if the story does
 * not exist.
 */
export function getTicketBundle(
  db: Db,
  storyId: string,
): TicketBundle | null {
  const story = db.select().from(stories).where(eq(stories.id, storyId)).get();
  if (!story) return null;

  const promptRow = story.rootPromptId
    ? db.select().from(prompts).where(eq(prompts.id, story.rootPromptId)).get()
    : undefined;

  const requirementRow =
    story.parentEntityType === 'requirement' && story.parentEntityId
      ? db
          .select()
          .from(requirements)
          .where(eq(requirements.id, story.parentEntityId))
          .get()
      : undefined;

  const bucketRow = story.bucketId
    ? db.select().from(taskBuckets).where(eq(taskBuckets.id, story.bucketId)).get()
    : undefined;

  const labels = db
    .select({
      labelSlug: entityLabels.labelSlug,
      labelType: entityLabels.labelType,
      confidence: entityLabels.confidence,
      source: entityLabels.source,
    })
    .from(entityLabels)
    .where(
      and(
        eq(entityLabels.entityKind, 'story'),
        eq(entityLabels.entityId, storyId),
      ),
    )
    .all();

  // Compute downstream stories (reverse dependency lookup).
  const upstream = safeParseStringArray(story.dependsOnJson);
  const downstream: string[] = [];
  if (story.rootPromptId) {
    const sibling = db
      .select({ id: stories.id, dependsOnJson: stories.dependsOnJson })
      .from(stories)
      .where(eq(stories.rootPromptId, story.rootPromptId))
      .all();
    for (const s of sibling) {
      if (s.id === storyId) continue;
      const sUp = safeParseStringArray(s.dependsOnJson);
      if (sUp.includes(storyId)) downstream.push(s.id);
    }
  }

  const { ticket, parseError } = parseTicket(story.agentContributionsJson);

  return {
    story: {
      id: story.id,
      title: story.title,
      description: story.description ?? '',
      status: story.status,
      rootPromptId: story.rootPromptId,
      parentEntityId: story.parentEntityId,
      parentEntityType: story.parentEntityType,
      bucketId: story.bucketId,
      templateVersion: story.templateVersion,
      templateValidationStatus: story.templateValidationStatus,
      templateValidationErrors: parseValidationErrors(story.templateValidationErrors),
      enrichedAt: story.enrichedAt,
      updatedAt: story.updatedAt,
    },
    ticket,
    ticketParseError: parseError,
    prompt: promptRow
      ? {
          id: promptRow.id,
          body: promptRow.body,
          receivedAt: promptRow.receivedAt,
          correlationId: promptRow.correlationId,
          status: promptRow.status,
        }
      : null,
    requirement: requirementRow
      ? {
          id: requirementRow.id,
          title: requirementRow.title,
          description: requirementRow.description,
          state: requirementRow.state,
        }
      : null,
    bucket: bucketRow
      ? {
          id: bucketRow.id,
          kind: bucketRow.kind as 'sequential' | 'parallel',
          domainSlug: bucketRow.domainSlug,
          sequenceIndex: bucketRow.sequenceIndex,
          status: bucketRow.status,
        }
      : null,
    labels,
    dependencies: { upstream, downstream },
  };
}
