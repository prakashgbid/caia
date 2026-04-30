/**
 * Capsule Freezer (CAPSULE-FORMALIZE — third-party paper §C.5).
 *
 * Walks every story attached to a prompt, parses its ticket from
 * `stories.agent_contributions_json`, freezes the Context Capsule via
 * `freezeCapsule()` from `@chiefaia/ticket-template`, and persists the
 * frozen state in three places:
 *
 *   1. `stories.capsule_hash`        — separate column, indexed
 *   2. `stories.capsule_frozen_at`   — separate column, indexed
 *   3. `stories.capsule_version`     — separate column
 *   4. `stories.agent_contributions_json` — embedded into the ticket
 *
 * The four are kept in sync because the Coding Agent reads the bundle
 * and verifies the capsule against the embedded fields; the columns
 * exist for observability + dashboard rendering.
 *
 * Called by the Task Scheduler at the
 * `bucket_placed → ready_for_pickup` transition. The Coding Agent's
 * first action is `verifyCapsule(ticket)`; on hash mismatch it raises
 * a `capsule-drift` blocker rather than acting on stale context.
 */

import { eq } from 'drizzle-orm';
import {
  TicketTemplateV1Schema,
  freezeCapsule,
} from '@chiefaia/ticket-template';
import { eventBus } from '../events/bus-adapter';
import type { Db } from '../db/connection';
import { stories } from '../db/schema';

export interface FreezeStoryCapsuleResult {
  storyId: string;
  status: 'frozen' | 'skipped' | 'error';
  capsuleHash?: string;
  capsuleFrozenAt?: number;
  reason?: string;
}

/**
 * Freeze the capsule for a single story. Idempotent: re-running on a
 * story that already has a capsule overwrites with the current content's
 * hash — re-freeze is the right semantics when an upstream agent
 * legitimately edits a ticket pre-handoff (e.g., BA replays).
 */
export function freezeStoryCapsule(
  storyId: string,
  db: Db,
  options: { now?: number; correlationId?: string; promptId?: string } = {},
): FreezeStoryCapsuleResult {
  const story = db.select().from(stories).where(eq(stories.id, storyId)).get();
  if (!story) {
    return { storyId, status: 'error', reason: 'story-not-found' };
  }

  const raw = story.agentContributionsJson;
  if (!raw || raw === '{}') {
    emitFrozen(storyId, options, 'skipped', { reason: 'empty-ticket' });
    return { storyId, status: 'skipped', reason: 'empty-ticket' };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    const reason = `json-parse-error: ${(err as Error).message}`;
    emitFrozen(storyId, options, 'skipped', { reason });
    return { storyId, status: 'skipped', reason };
  }
  const parseResult = TicketTemplateV1Schema.safeParse(parsedJson);
  if (!parseResult.success) {
    const reason = `schema-error: ${parseResult.error.issues
      .slice(0, 1)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')}`;
    emitFrozen(storyId, options, 'skipped', { reason });
    return { storyId, status: 'skipped', reason };
  }

  const frozen = freezeCapsule(parseResult.data, { now: options.now });
  db.update(stories)
    .set({
      capsuleHash: frozen.capsuleHash,
      capsuleFrozenAt: frozen.capsuleFrozenAt,
      capsuleVersion: frozen.capsuleVersion,
      agentContributionsJson: JSON.stringify(frozen),
    })
    .where(eq(stories.id, storyId))
    .run();

  // RUN-MODES (migration 0038): surface the story's run_mode in the
  // capsule-frozen event so downstream consumers (capability broker,
  // dashboard) can apply mode-specific restrictions without re-reading
  // the row. The capsule's `tool_allowlist` is computed from
  // architecturalInstructions and is intentionally not mutated by run
  // mode (changing the capsule shape would be a v2 hash change). The
  // capability broker (Track 1) is responsible for restricting its own
  // per-run capability allowlist via run-modes/restrictAllowlistForMode
  // when it consumes this event.
  // TODO(track-1-broker): once the broker package lands, swap this
  // event-emission-only plumbing for a direct call into the broker's
  // allowlist API at story pickup.
  emitFrozen(storyId, options, 'frozen', {
    capsuleHash: frozen.capsuleHash,
    capsuleFrozenAt: frozen.capsuleFrozenAt,
    capsuleVersion: frozen.capsuleVersion,
    runMode: story.runMode ?? 'full',
  });

  return {
    storyId,
    status: 'frozen',
    capsuleHash: frozen.capsuleHash,
    capsuleFrozenAt: frozen.capsuleFrozenAt,
  };
}

/**
 * Freeze every story belonging to a prompt. Returns one result per
 * story; non-blocking on individual failures so a single bad ticket
 * does not stall the whole prompt's hand-off.
 */
export function freezePromptCapsules(
  promptId: string,
  db: Db,
  options: { now?: number; correlationId?: string } = {},
): FreezeStoryCapsuleResult[] {
  const rows = db
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.rootPromptId, promptId))
    .all();
  const results: FreezeStoryCapsuleResult[] = [];
  for (const row of rows) {
    results.push(freezeStoryCapsule(row.id, db, { ...options, promptId }));
  }
  return results;
}

function emitFrozen(
  storyId: string,
  options: { correlationId?: string; promptId?: string },
  status: 'frozen' | 'skipped',
  payload: Record<string, unknown>,
): void {
  eventBus.publish({
    type: 'ticket.capsule-frozen',
    actor: 'task-scheduler',
    correlation_id: options.correlationId ?? 'unknown',
    entity_type: 'story',
    entity_id: storyId,
    payload: {
      storyId,
      promptId: options.promptId,
      status,
      ...payload,
    },
  });
}
