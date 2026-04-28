/**
 * Agent-collaboration protocol primitives — request/response over the
 * `agent_messages` table.
 *
 * One agent (e.g. the BA agent) sends an `input-requested` row to N domain
 * consultants and `awaitReplies()` blocks until either every consultant has
 * inserted a reply row (with `parent_message_id` pointing back to the request)
 * or the deadline lapses, at which point unanswered requests are flipped to
 * `timed_out`.
 *
 * The replies are returned to the caller verbatim so the caller can merge
 * them into the ticket-template payload. Direct-call domain responders may
 * synthesise replies inline (see `domain-responders.ts`); future LLM-backed
 * agents can subscribe to `ba-agent.input-requested` events and reply via
 * {@link replyToRequest}.
 */

import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { agentMessages } from '../db/schema';
import type { Db } from '../db/connection';
import { eventBus } from '../events/bus-adapter';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InputRequest {
  /** Sender agent name (e.g. `ba-agent`). */
  fromAgent: string;
  /** Receiver agent name (e.g. `ea-agent`). */
  toAgent: string;
  /** Correlation id shared across all requests in this collaboration round. */
  correlationId: string;
  /** Soft deadline (epoch ms) — used by callers and timeout logic. */
  expectedReplyBy: number;
  /** Arbitrary JSON-serialisable payload — typically the question + story context. */
  payload: unknown;
  /** Optional emit-event flag (default true). Disable for unit tests that don't run the event bus. */
  emitEvent?: boolean;
}

export interface PendingRequest {
  messageId: string;
  toAgent: string;
}

export interface CollectedReply {
  fromAgent: string;
  payload: unknown;
  /** Epoch ms when the reply landed, taken from `replied_at` on the request row. */
  repliedAt: number;
  /** id of the original request row. */
  requestMessageId: string;
}

export interface AwaitRepliesOptions {
  /** Total wait budget in ms (overrides per-request `expectedReplyBy`). Default 5_000. */
  timeoutMs?: number;
  /** Polling interval in ms. Default 50. */
  pollIntervalMs?: number;
  /**
   * Returns the current epoch ms. Defaults to `Date.now`. Tests pass a
   * deterministic clock so timeouts are not wall-clock dependent.
   */
  now?: () => number;
  /**
   * Sleep helper. Defaults to `setTimeout`-backed promise. Tests pass a
   * fast-forwarding fake.
   */
  sleep?: (ms: number) => Promise<void>;
}

export interface AwaitRepliesResult {
  replies: CollectedReply[];
  /** Agents that did not reply within the budget. */
  timedOutAgents: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ─── sendInputRequest ────────────────────────────────────────────────────────

/**
 * Insert a single `input-requested` row into `agent_messages` and (by default)
 * publish a `ba-agent.input-requested` event. Returns the new row's id so the
 * caller can track it across awaitReplies / replyToRequest calls.
 */
export function sendInputRequest(req: InputRequest, db: Db): string {
  const id = `msg_req_${nanoid(12)}`;
  db.insert(agentMessages)
    .values({
      id,
      fromAgent: req.fromAgent,
      toAgent: req.toAgent,
      messageType: 'input-requested',
      correlationId: req.correlationId,
      payload: JSON.stringify(req.payload ?? {}),
      status: 'pending',
      createdAt: Date.now(),
      expectedReplyBy: req.expectedReplyBy,
    })
    .run();

  if (req.emitEvent !== false) {
    eventBus.publish({
      type: 'ba-agent.input-requested',
      // EventActor is a narrow literal union; the protocol carries a
      // dynamic agent name (BA today, any subscriber tomorrow). Cast
      // narrowly to the canonical sender for now.
      actor: req.fromAgent as 'ba-agent',
      correlation_id: req.correlationId,
      entity_type: 'agent_message',
      entity_id: id,
      payload: {
        correlationId: req.correlationId,
        requestingAgent: req.fromAgent,
        receivingAgent: req.toAgent,
        deadlineMs: req.expectedReplyBy,
      },
    });
  }

  return id;
}

// ─── replyToRequest ──────────────────────────────────────────────────────────

export interface ReplyParams {
  /** id of the request row this reply addresses. */
  requestMessageId: string;
  /** Reply sender (the consulted agent). */
  fromAgent: string;
  /** JSON-serialisable reply payload (e.g. an architecture section). */
  payload: unknown;
  /** Optional override for the timestamp; defaults to Date.now(). */
  repliedAt?: number;
}

/**
 * Persist a reply: stamps `replied_at` + `status='replied'` on the original
 * request row and inserts a new `input-received` row with `parent_message_id`
 * pointing back to the request.
 */
export function replyToRequest(params: ReplyParams, db: Db): string {
  const replyId = `msg_rep_${nanoid(12)}`;
  const ts = params.repliedAt ?? Date.now();

  // Look up the request row to capture metadata for the reply.
  const reqRow = db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.id, params.requestMessageId))
    .get();
  if (!reqRow) {
    throw new Error(`agent-collab: request ${params.requestMessageId} not found`);
  }

  // Mark the original request as replied.
  db.update(agentMessages)
    .set({ status: 'replied', repliedAt: ts, processedAt: ts })
    .where(eq(agentMessages.id, params.requestMessageId))
    .run();

  // Insert the reply row.
  db.insert(agentMessages)
    .values({
      id: replyId,
      fromAgent: params.fromAgent,
      toAgent: reqRow.fromAgent,
      messageType: 'input-received',
      correlationId: reqRow.correlationId,
      payload: JSON.stringify(params.payload ?? {}),
      status: 'delivered',
      createdAt: ts,
      processedAt: ts,
      parentMessageId: params.requestMessageId,
    })
    .run();

  return replyId;
}

// ─── awaitReplies ────────────────────────────────────────────────────────────

/**
 * Poll `agent_messages` until every requested agent has either replied or the
 * deadline lapses. Unanswered requests are flipped to `status='timed_out'`
 * before this returns.
 *
 * The function only considers requests with the supplied `correlationId` and
 * `fromAgent`, so independent collaborations on the same DB don't interfere.
 *
 * Returns an aggregated result with the parsed replies (in arrival order) and
 * the names of agents that timed out.
 */
export async function awaitReplies(
  params: {
    fromAgent: string;
    correlationId: string;
    expectedAgents: string[];
  },
  db: Db,
  options: AwaitRepliesOptions = {},
): Promise<AwaitRepliesResult> {
  const { fromAgent, correlationId, expectedAgents } = params;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  const startedAt = now();
  const expected = new Set(expectedAgents);
  const seen = new Map<string, CollectedReply>();

  while (seen.size < expected.size && now() - startedAt < timeoutMs) {
    const rows = db
      .select()
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.correlationId, correlationId),
          eq(agentMessages.fromAgent, fromAgent),
          eq(agentMessages.messageType, 'input-requested'),
        ),
      )
      .all();

    for (const row of rows) {
      if (row.status !== 'replied' || row.repliedAt == null) continue;
      if (!expected.has(row.toAgent)) continue;
      if (seen.has(row.toAgent)) continue;

      // Find the reply row whose parent points to this request.
      const replyRow = db
        .select()
        .from(agentMessages)
        .where(
          and(
            eq(agentMessages.parentMessageId, row.id),
            eq(agentMessages.messageType, 'input-received'),
          ),
        )
        .get();
      if (!replyRow) continue;

      seen.set(row.toAgent, {
        fromAgent: row.toAgent,
        payload: safeJsonParse(replyRow.payload),
        repliedAt: row.repliedAt,
        requestMessageId: row.id,
      });
    }

    if (seen.size >= expected.size) break;
    await sleep(pollIntervalMs);
  }

  // Anyone we haven't seen by now → timed out.
  const timedOutAgents: string[] = [];
  for (const agent of expected) {
    if (!seen.has(agent)) timedOutAgents.push(agent);
  }

  // Flip the still-pending request rows to 'timed_out' so the audit trail is honest.
  if (timedOutAgents.length > 0) {
    const ts = now();
    for (const agent of timedOutAgents) {
      const pendingRow = db
        .select()
        .from(agentMessages)
        .where(
          and(
            eq(agentMessages.correlationId, correlationId),
            eq(agentMessages.fromAgent, fromAgent),
            eq(agentMessages.toAgent, agent),
            eq(agentMessages.messageType, 'input-requested'),
            eq(agentMessages.status, 'pending'),
          ),
        )
        .get();
      if (pendingRow) {
        db.update(agentMessages)
          .set({ status: 'timed_out', processedAt: ts })
          .where(eq(agentMessages.id, pendingRow.id))
          .run();
      }
    }
  }

  return {
    replies: Array.from(seen.values()).sort((a, b) => a.repliedAt - b.repliedAt),
    timedOutAgents,
  };
}

// ─── Convenience: emit input-received aggregation event ─────────────────────

/**
 * Emit a `ba-agent.input-received` event summarising what the BA collected
 * during a round. Called once after `awaitReplies` resolves. Separate from
 * the per-reply persistence so the event is a single observable signal of
 * "the round is done."
 */
export function emitInputReceived(params: {
  promptId: string;
  storyId: string;
  correlationId: string;
  result: AwaitRepliesResult;
}): void {
  eventBus.publish({
    type: 'ba-agent.input-received',
    actor: 'ba-agent',
    correlation_id: params.correlationId,
    entity_type: 'story',
    entity_id: params.storyId,
    payload: {
      promptId: params.promptId,
      correlationId: params.correlationId,
      storyId: params.storyId,
      repliesReceived: params.result.replies.map((r) => r.fromAgent),
      repliesTimedOut: params.result.timedOutAgents,
    },
  });
}
