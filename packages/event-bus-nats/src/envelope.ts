/**
 * Wire envelope encode/decode + subject derivation.
 *
 * The envelope is what actually traverses NATS. It wraps the
 * ConductorEvent with at-least-once delivery metadata
 * (idempotency_key, sender, recipients) plus a schema_version
 * for future migrations.
 */

import { randomUUID } from 'node:crypto';
import type { ConductorEvent, EventSeverity } from '@chiefaia/events-taxonomy-internal';
import type { EventEnvelope, PublishInput } from './types.js';

/** Map an event.type ("story.completed") to a NATS subject ("chiefaia.story.completed"). */
export function subjectFor(eventType: string, prefix = 'chiefaia'): string {
  if (!eventType || typeof eventType !== 'string') {
    throw new TypeError(`subjectFor: invalid eventType ${String(eventType)}`);
  }
  return `${prefix}.${eventType}`;
}

/** Inverse: given a subject + prefix, recover the event type. */
export function eventTypeFromSubject(subject: string, prefix = 'chiefaia'): string {
  const want = `${prefix}.`;
  if (!subject.startsWith(want)) {
    throw new Error(`subject ${subject} not under prefix ${prefix}`);
  }
  return subject.slice(want.length);
}

/** Map a glob ("story.*") to a NATS subject glob ("chiefaia.story.>"). */
export function subjectGlob(typeGlob: string, prefix = 'chiefaia'): string {
  if (typeGlob === '*' || typeGlob === '**') return `${prefix}.>`;
  if (typeGlob.endsWith('.*')) {
    return `${prefix}.${typeGlob.slice(0, -1)}>`;
  }
  return `${prefix}.${typeGlob}`;
}

/** Make an idempotency key. Defaults to event.id but operators can override. */
export function makeIdempotencyKey(event: Pick<ConductorEvent, 'id'>): string {
  return event.id;
}

/** Encode an envelope to bytes for NATS. */
export function encodeEnvelope(env: EventEnvelope): Uint8Array {
  const json = JSON.stringify(env);
  return new TextEncoder().encode(json);
}

/** Decode bytes from NATS into an envelope. Throws on schema mismatch. */
export function decodeEnvelope(bytes: Uint8Array): EventEnvelope {
  const json = new TextDecoder().decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`envelope: invalid JSON — ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('envelope: not an object');
  }
  const e = parsed as Partial<EventEnvelope>;
  if (e.schema_version !== 1) {
    throw new Error(`envelope: unsupported schema_version ${e.schema_version}`);
  }
  if (!e.event || typeof e.event !== 'object') {
    throw new Error('envelope: missing event');
  }
  if (typeof e.idempotency_key !== 'string' || !e.idempotency_key) {
    throw new Error('envelope: missing idempotency_key');
  }
  if (typeof e.sender !== 'string') {
    throw new Error('envelope: missing sender');
  }
  if (!Array.isArray(e.recipients)) {
    throw new Error('envelope: recipients must be array');
  }
  return e as EventEnvelope;
}

/** Build a fully-populated ConductorEvent from a PublishInput. */
export function inflateEvent(
  input: PublishInput,
  severityFromTaxonomy: (type: string) => EventSeverity | undefined,
): ConductorEvent {
  const id = makeEventId();
  const occurred_at = new Date().toISOString();
  const severity: EventSeverity =
    input.severity ?? severityFromTaxonomy(input.type) ?? ('info' as EventSeverity);
  return {
    id,
    occurred_at,
    severity,
    ...input,
  } as ConductorEvent;
}

/** Wrap a ConductorEvent into an EventEnvelope. */
export function wrap(
  event: ConductorEvent,
  sender: string,
  recipients: string[] = [],
): EventEnvelope {
  return {
    schema_version: 1,
    event,
    idempotency_key: makeIdempotencyKey(event),
    sender,
    recipients,
  };
}

/** Generate a fresh event ID matching the in-process bus's format. */
export function makeEventId(): string {
  const ts = Date.now().toString(36).padStart(8, '0');
  const rand = randomUUID().replace(/-/g, '').slice(0, 16);
  return `ev_${ts}_${rand}`;
}
