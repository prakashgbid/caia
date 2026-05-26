/**
 * Dead-letter handling.
 *
 * Wave 1a (2026-05-25): the bus now actively REPUBLISHES poison messages
 * to a DLQ subject (`chiefaia.events.dlq` by default) after retry
 * exhaustion. Previously the module only logged advisories; that
 * shipped with the v0.1 skeleton (PR #590) but never DLQ'd. The
 * consume loop in `NatsEventBus.startConsumer` now wraps each handler
 * invocation with a delivery-count check, naks with exponential
 * backoff on transient failures, and once `redeliveryCount` exceeds
 * `maxRetriesBeforeDlq` the original envelope is wrapped with a
 * `dlq` provenance block and republished. The original message is
 * then ack'd so JetStream stops redelivering.
 */

import { encodeEnvelope } from './envelope.js';
import type { EventEnvelope } from './types.js';

export interface DlqAdvisory {
  stream: string;
  consumer: string;
  deliveries: number;
  reason: string;
  rawSubject: string;
  rawPayload: Uint8Array;
}

export type DlqHandler = (advisory: DlqAdvisory) => void | Promise<void>;

/** Default handler — logs and drops. Kept for v0.1 compatibility tests. */
export const defaultDlqHandler: DlqHandler = (advisory) => {
  // Intentionally noisy; operator should grep for this.
  // eslint-disable-next-line no-console
  console.warn(
    `[event-bus-nats] DLQ advisory: stream=${advisory.stream} consumer=${advisory.consumer} deliveries=${advisory.deliveries} reason=${advisory.reason}`,
  );
};

/** Shape of the JetStream client surface the DLQ publisher uses. */
export interface DlqPublisher {
  publish(subject: string, data: Uint8Array, opts?: Record<string, unknown>): Promise<unknown>;
}

/** Compute the nak backoff for a given delivery attempt (exponential + jitter, capped). */
export function nakBackoffMs(deliveryAttempt: number, opts?: { baseMs?: number; capMs?: number; jitter?: number }): number {
  const base = opts?.baseMs ?? 500;
  const cap = opts?.capMs ?? 30_000;
  const jitter = opts?.jitter ?? 0.2;
  // deliveryAttempt is 1-indexed; first nak after attempt=1 → exp=0 → base
  const exp = Math.max(0, deliveryAttempt - 1);
  const raw = base * Math.pow(2, exp);
  const capped = Math.min(raw, cap);
  // ±jitter%
  const noise = (Math.random() * 2 - 1) * jitter * capped;
  return Math.max(0, Math.round(capped + noise));
}

/**
 * Republish an envelope to the DLQ subject. The envelope is wrapped with
 * a `dlq` provenance block recording where it came from, how many times
 * it was delivered, and the last error. The wrapper publishes with a
 * `msgID` derived from the original idempotency_key + retry count so
 * JetStream's at-least-once dedupe doesn't suppress retries-of-retries.
 */
export async function publishToDlq(
  publisher: DlqPublisher,
  dlqSubject: string,
  envelope: EventEnvelope,
  context: {
    originalSubject: string;
    deliveryCount: number;
    lastError: string;
    now?: () => Date;
  },
): Promise<void> {
  const now = context.now ?? (() => new Date());
  const wrapped: EventEnvelope = {
    ...envelope,
    dlq: {
      original_subject: context.originalSubject,
      delivery_count: context.deliveryCount,
      last_error: context.lastError,
      failed_at: now().toISOString(),
    },
  };
  const bytes = encodeEnvelope(wrapped);
  // Per-attempt msgID so the DLQ doesn't dedupe re-DLQ'd messages.
  // Distinct from the envelope's idempotency_key which is event.id.
  const msgID = `${envelope.idempotency_key}#dlq#${context.deliveryCount}`;
  await publisher.publish(dlqSubject, bytes, { msgID });
}
