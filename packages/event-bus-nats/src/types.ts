/**
 * Public types for @chiefaia/event-bus-nats.
 *
 * The `EventBus` interface is the contract every bus backend must
 * satisfy. The in-process bus in @chiefaia/event-bus-internal
 * implements this shape implicitly; we lift it into an explicit
 * interface here so future backends (Redpanda, Temporal, etc.)
 * can conform.
 */

import type {
  ConductorEvent,
  EventSeverity,
} from '@chiefaia/events-taxonomy-internal';

export type { ConductorEvent, EventSeverity };

/** Handler receives the decoded ConductorEvent; throwing must not crash the bus. */
export type EventHandler = (event: ConductorEvent) => void | Promise<void>;

/** Returned by subscribe; calling it removes the subscription. */
export type Unsubscribe = () => void;

/** Replay query options — kept structurally identical to event-bus-internal. */
export interface EventQueryOpts {
  type?: string;
  actor?: string;
  entityId?: string;
  projectSlug?: string;
  correlationId?: string;
  since?: string;
  limit?: number;
}

/** Partial event accepted by publish — id/occurred_at/severity are filled in. */
export type PublishInput = Omit<
  ConductorEvent,
  'id' | 'occurred_at' | 'severity'
> & {
  severity?: EventSeverity;
};

/** The shared interface every bus backend implements. */
export interface EventBus {
  publish(input: PublishInput): Promise<ConductorEvent> | ConductorEvent;
  subscribe(typeGlob: string, handler: EventHandler): Unsubscribe;
  replay(opts: EventQueryOpts): Promise<ConductorEvent[]> | ConductorEvent[];
}

/** Wire envelope — what actually traverses NATS. */
export interface EventEnvelope {
  /** Canonical envelope version; bumped on breaking wire changes. */
  schema_version: 1;
  /** The full ConductorEvent. */
  event: ConductorEvent;
  /** Idempotency key for at-least-once dedupe (defaults to event.id). */
  idempotency_key: string;
  /** Sender identity for routing/audit. */
  sender: string;
  /** Optional explicit recipient list; empty = broadcast on subject. */
  recipients: string[];
  /**
   * W3C TraceContext carrier (added 2026-05-25, gap analysis G47 + W5).
   *
   * Populated by `withNatsPublishSpan` on publish and consumed by
   * `withNatsConsumeSpan` on subscribe so a single trace_id propagates
   * across the bus end-to-end. Optional for backward-compatibility —
   * envelopes published by older producers (no `trace` field) are
   * still accepted; the consume side just starts a new root span when
   * no parent context is present.
   */
  trace?: { traceparent?: string; tracestate?: string };
}

/** Authentication options for the NATS connection. */
export interface NatsAuthConfig {
  /** Raw NKey seed (mounted from Secret). Preferred. */
  nkeySeed?: string;
  /** Static token. Dev only. */
  token?: string;
  /** Username/password. Dev only. */
  user?: string;
  pass?: string;
}

/** TLS options for the NATS connection. */
export interface NatsTlsConfig {
  caFile?: string;
  certFile?: string;
  keyFile?: string;
  rejectUnauthorized?: boolean;
}

/** Construction config for NatsEventBus. */
export interface NatsEventBusConfig {
  /** NATS server URLs, e.g. ['nats://nats.chiefaia.svc.cluster.local:4222']. */
  servers: string[];
  /** Stream name; defaults to 'chiefaia-events'. */
  stream?: string;
  /** Subject prefix; defaults to 'chiefaia'. Final subject: `${prefix}.${eventType}`. */
  subjectPrefix?: string;
  /** Durable consumer name; defaults to 'chiefaia-default'. */
  durableConsumer?: string;
  /** Authentication. */
  auth?: NatsAuthConfig;
  /** TLS. */
  tls?: NatsTlsConfig;
  /** Reconnect tuning. */
  reconnect?: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitter?: boolean;
  };
  /** Max in-flight publishes before backpressure kicks in; defaults to 1024. */
  maxInflight?: number;
  /** Per-message ack wait before redelivery; defaults to 30s. */
  ackWaitMs?: number;
  /** Max redelivery attempts before DLQ; defaults to 5. */
  maxDeliver?: number;
}
