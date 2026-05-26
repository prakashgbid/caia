/**
 * @chiefaia/event-bus-nats — NATS JetStream backend for ConductorEventBus.
 *
 * Public surface mirrors @chiefaia/event-bus-internal:
 *   - publish(input) → ConductorEvent
 *   - subscribe(typeGlob, handler) → unsubscribe
 *   - replay(opts) → ConductorEvent[]    (V1: returns [] — see PLAN.md)
 *
 * Backed by nats.js JetStream. At-least-once via AckPolicy.Explicit
 * + idempotency_key in the envelope. Reconnect with exponential
 * backoff. Publish backpressure via in-flight cap.
 *
 * V1 scope cut: one catch-all stream, single durable consumer per
 * subscription. Full 57-event fanout, saga, request/reply, and
 * broker-side replay land in v0.2.
 *
 * Wave 1a (2026-05-25, this PR): three additions on top of the V1
 * baseline:
 *   1. Per-event-type consumer overrides via `consumerOverrides` —
 *      lets `worker.heartbeat` opt into `ackPolicy: 'none'`.
 *   2. Active DLQ republishing — when a message exceeds
 *      `maxRetriesBeforeDlq` deliveries, the bus wraps it with a
 *      `dlq` provenance block and republishes to `dlqSubject`,
 *      then ack's the original so JetStream stops redelivering.
 *   3. Exponential-backoff nak — nakBackoffMs() derives a per-attempt
 *      delay so transient failures don't hot-loop.
 *
 * The HybridEventBus (./router.js) wraps NatsEventBus + a legacy
 * in-process bus and routes per event-type via the
 * BUS_BACKEND_NATS_FOR_EVENT_TYPES env var.
 */

import picomatch from 'picomatch';
import {
  withNatsConsumeSpan,
  withNatsPublishSpan,
  type TraceCarrier,
} from '@chiefaia/tracing';
import type {
  ConductorEvent,
  EventType,
  EventSeverity,
} from '@chiefaia/events-taxonomy-internal';
import {
  EVENT_SEVERITY,
  isValidEventType,
} from '@chiefaia/events-taxonomy-internal';
import type {
  ConsumerOverride,
  EventBus,
  EventEnvelope,
  EventHandler,
  EventQueryOpts,
  NatsEventBusConfig,
  PublishInput,
  Unsubscribe,
} from './types.js';
import {
  decodeEnvelope,
  encodeEnvelope,
  inflateEvent,
  subjectFor,
  subjectGlob,
  wrap,
} from './envelope.js';
import { DEFAULT_STREAM, defaultConsumer } from './streams.js';
import {
  defaultDlqHandler,
  nakBackoffMs,
  publishToDlq,
  type DlqHandler,
} from './dlq.js';

// We import nats lazily inside connect() so the package can be
// loaded in environments where the native bits aren't installed
// (type-only consumption, pure-shape tests).
type NatsConnection = unknown;
type JetStreamClient = unknown;
type JetStreamManager = unknown;

interface InternalSub {
  glob: string;
  matcher: (s: string) => boolean;
  handler: EventHandler;
  durable: string;
  override?: ConsumerOverride;
  stopper?: () => Promise<void>;
}

interface ResolvedConfig {
  servers: string[];
  stream: string;
  subjectPrefix: string;
  durableConsumer: string;
  maxInflight: number;
  ackWaitMs: number;
  maxDeliver: number;
  auth: NatsEventBusConfig['auth'];
  tls: NatsEventBusConfig['tls'];
  reconnect: NatsEventBusConfig['reconnect'];
  consumerOverrides: Record<string, ConsumerOverride>;
  dlqSubject: string;
  maxRetriesBeforeDlq: number;
}

/** Default DLQ subject; can be overridden per-bus via NatsEventBusConfig.dlqSubject. */
export const DEFAULT_DLQ_SUBJECT = 'chiefaia.events.dlq';

export class NatsEventBus implements EventBus {
  private readonly cfg: ResolvedConfig;

  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private jsm: JetStreamManager | null = null;
  private _subs: InternalSub[] = [];
  private _inflight = 0;
  private _closed = false;
  private _dlqHandler: DlqHandler = defaultDlqHandler;
  private _sender: string;

  constructor(cfg: NatsEventBusConfig) {
    if (!cfg.servers || cfg.servers.length === 0) {
      throw new Error('NatsEventBus: at least one server URL required');
    }
    this.cfg = {
      servers: cfg.servers,
      stream: cfg.stream ?? DEFAULT_STREAM.name,
      subjectPrefix: cfg.subjectPrefix ?? 'chiefaia',
      durableConsumer: cfg.durableConsumer ?? 'chiefaia-default',
      maxInflight: cfg.maxInflight ?? 1024,
      ackWaitMs: cfg.ackWaitMs ?? 30_000,
      maxDeliver: cfg.maxDeliver ?? 5,
      auth: cfg.auth,
      tls: cfg.tls,
      reconnect: cfg.reconnect,
      consumerOverrides: cfg.consumerOverrides ?? {},
      dlqSubject: cfg.dlqSubject ?? DEFAULT_DLQ_SUBJECT,
      maxRetriesBeforeDlq: cfg.maxRetriesBeforeDlq ?? 3,
    };
    this._sender = this.cfg.durableConsumer;
  }

  setSender(sender: string): void { this._sender = sender; }
  setDlqHandler(handler: DlqHandler): void { this._dlqHandler = handler; }

  async connect(): Promise<void> {
    if (this.nc) return;
    if (this._closed) throw new Error('NatsEventBus: cannot reconnect a closed bus');
    const { connect } = (await import('nats')) as typeof import('nats');
    const opts: Record<string, unknown> = {
      servers: this.cfg.servers,
      maxReconnectAttempts: this.cfg.reconnect?.maxAttempts ?? -1,
      reconnectTimeWait: this.cfg.reconnect?.initialDelayMs ?? 500,
      reconnect: true,
      waitOnFirstConnect: true,
    };

    if (this.cfg.auth?.nkeySeed) {
      const { nkeyAuthenticator } = (await import('nats')) as typeof import('nats');
      opts.authenticator = nkeyAuthenticator(new TextEncoder().encode(this.cfg.auth.nkeySeed));
    } else if (this.cfg.auth?.token) {
      opts.token = this.cfg.auth.token;
    } else if (this.cfg.auth?.user) {
      opts.user = this.cfg.auth.user;
      opts.pass = this.cfg.auth.pass;
    }

    if (this.cfg.tls) {
      opts.tls = {
        caFile: this.cfg.tls.caFile,
        certFile: this.cfg.tls.certFile,
        keyFile: this.cfg.tls.keyFile,
        rejectUnauthorized: this.cfg.tls.rejectUnauthorized ?? true,
      };
    }

    this.nc = await connect(opts);
    this.js = (this.nc as { jetstream(): JetStreamClient }).jetstream();
    this.jsm = await (this.nc as { jetstreamManager(): Promise<JetStreamManager> }).jetstreamManager();

    await this.ensureStream();
  }

  private async ensureStream(): Promise<void> {
    if (!this.jsm) throw new Error('NatsEventBus: not connected');
    const jsm = this.jsm as {
      streams: {
        info(name: string): Promise<unknown>;
        add(opts: Record<string, unknown>): Promise<unknown>;
      };
    };
    try {
      await jsm.streams.info(this.cfg.stream);
    } catch {
      await jsm.streams.add({
        name: this.cfg.stream,
        subjects: [`${this.cfg.subjectPrefix}.>`],
        retention: 'limits',
        max_age: 7 * 24 * 60 * 60 * 1_000_000_000,
        max_bytes: 4 * 1024 * 1024 * 1024,
        num_replicas: 3,
        storage: 'file',
      });
    }
  }

  private resolveSeverity(type: string): EventSeverity | undefined {
    return (EVENT_SEVERITY as Record<string, EventSeverity | undefined>)[type];
  }

  /** Resolve the per-subscription consumer override merged with bus defaults. */
  private resolveConsumerSpec(entry: InternalSub): {
    ackPolicy: 'explicit' | 'none' | 'all';
    ackWaitMs: number;
    maxDeliver: number;
    maxAckPending: number;
  } {
    const ov = entry.override ?? {};
    return {
      ackPolicy: ov.ackPolicy ?? 'explicit',
      ackWaitMs: ov.ackWaitMs ?? this.cfg.ackWaitMs,
      maxDeliver: ov.maxDeliver ?? this.cfg.maxDeliver,
      maxAckPending: ov.maxAckPending ?? 1024,
    };
  }

  async publish(input: PublishInput): Promise<ConductorEvent> {
    if (this._closed) throw new Error('NatsEventBus: bus is closed');
    if (!this.js) throw new Error('NatsEventBus: not connected (call connect() first)');
    if (this._inflight >= this.cfg.maxInflight) {
      throw new Error(
        `NatsEventBus: backpressure — ${this._inflight} publishes in flight (max ${this.cfg.maxInflight})`,
      );
    }
    if (input.type && isValidEventType && !isValidEventType(input.type as EventType)) {
      // eslint-disable-next-line no-console
      console.warn(`[event-bus-nats] publish: unknown event type "${input.type}"`);
    }

    const event = inflateEvent(input as PublishInput, (t) => this.resolveSeverity(t));
    const envelope = wrap(event, this._sender);
    const subject = subjectFor(event.type, this.cfg.subjectPrefix);

    // OTel: stamp the active trace context into the envelope so the
    // consumer can rebuild the parent span. Carrier is mutated in
    // place by `withNatsPublishSpan` → `injectContext`.
    const traceCarrier: TraceCarrier = {};
    envelope.trace = traceCarrier;

    const js = this.js as {
      publish(subject: string, data: Uint8Array, opts?: Record<string, unknown>): Promise<unknown>;
    };

    this._inflight += 1;
    try {
      await withNatsPublishSpan(
        {
          subject,
          carrier: traceCarrier,
          attributes: {
            'caia.event.type': event.type,
            'caia.event.id': event.id,
            'caia.event.sender': this._sender,
          },
        },
        async () => {
          // Re-encode AFTER injection so traceparent is on the wire.
          const bytes = encodeEnvelope(envelope);
          await js.publish(subject, bytes, { msgID: envelope.idempotency_key });
        },
      );
    } finally {
      this._inflight -= 1;
    }
    return event;
  }

  subscribe(typeGlob: string, handler: EventHandler): Unsubscribe {
    const override = this.cfg.consumerOverrides[typeGlob];
    const entry: InternalSub = {
      glob: typeGlob,
      matcher: picomatch(typeGlob),
      handler,
      durable: `${this.cfg.durableConsumer}-${sanitizeDurable(typeGlob)}`,
      ...(override ? { override } : {}),
    };
    this._subs.push(entry);

    if (this.js && this.jsm) {
      void this.startConsumer(entry).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[event-bus-nats] subscribe: failed to start consumer', err);
      });
    }

    return () => {
      this._subs = this._subs.filter((s) => s !== entry);
      if (entry.stopper) void entry.stopper().catch(() => {});
    };
  }

  private async startConsumer(entry: InternalSub): Promise<void> {
    if (!this.js || !this.jsm) return;
    const resolved = this.resolveConsumerSpec(entry);
    const filter = subjectGlob(entry.glob, this.cfg.subjectPrefix);
    const spec = defaultConsumer(entry.durable, filter, {
      ackWaitMs: resolved.ackWaitMs,
      maxDeliver: resolved.maxDeliver,
      maxAckPending: resolved.maxAckPending,
      ackPolicy: resolved.ackPolicy,
    });

    const jsm = this.jsm as {
      consumers: {
        add(stream: string, opts: Record<string, unknown>): Promise<unknown>;
      };
    };
    try {
      await jsm.consumers.add(this.cfg.stream, {
        durable_name: spec.durable,
        filter_subject: spec.filterSubject,
        ack_policy: resolved.ackPolicy,
        ack_wait: resolved.ackWaitMs * 1_000_000,
        max_deliver: resolved.maxDeliver,
        max_ack_pending: resolved.maxAckPending,
      });
    } catch (err) {
      if (!String(err).includes('already in use')) {
        // eslint-disable-next-line no-console
        console.warn('[event-bus-nats] consumer.add', err);
      }
    }

    const js = this.js as {
      publish(subject: string, data: Uint8Array, opts?: Record<string, unknown>): Promise<unknown>;
      consumers: {
        get(stream: string, durable: string): Promise<{
          consume(opts?: Record<string, unknown>): Promise<AsyncIterable<{
            data: Uint8Array;
            ack(): void;
            nak(delayMs?: number): void;
            info?: { redeliveryCount?: number; deliveryCount?: number };
          }>>;
        }>;
      };
    };
    const consumer = await js.consumers.get(this.cfg.stream, spec.durable);
    const iter = await consumer.consume();

    entry.stopper = async () => {
      const maybeStop = (iter as unknown as { stop?: () => void | Promise<void> }).stop;
      if (maybeStop) await maybeStop.call(iter);
    };

    const ackPolicy = resolved.ackPolicy;
    const maxRetriesBeforeDlq = this.cfg.maxRetriesBeforeDlq;
    const dlqSubject = this.cfg.dlqSubject;

    (async () => {
      for await (const msg of iter) {
        if (ackPolicy === 'none') {
          try {
            const env = decodeEnvelope(msg.data);
            if (entry.matcher(env.event.type)) {
              const carrier: TraceCarrier = env.trace ?? {};
              await withNatsConsumeSpan(
                {
                  subject: subjectFor(env.event.type, this.cfg.subjectPrefix),
                  carrier,
                  attributes: {
                    'caia.event.type': env.event.type,
                    'caia.event.id': env.event.id,
                    'caia.event.sender': env.sender,
                    'caia.subscription.glob': entry.glob,
                    'caia.consumer.ack_policy': 'none',
                  },
                },
                async () => entry.handler(env.event),
              );
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[event-bus-nats] handler threw (ackPolicy=none, dropping)', err);
          }
          continue;
        }

        let env: EventEnvelope | null = null;
        const deliveryCount = (msg.info?.redeliveryCount ?? 0) + 1;
        try {
          env = decodeEnvelope(msg.data);
          if (entry.matcher(env.event.type)) {
            const carrier: TraceCarrier = env.trace ?? {};
            await withNatsConsumeSpan(
              {
                subject: subjectFor(env.event.type, this.cfg.subjectPrefix),
                carrier,
                attributes: {
                  'caia.event.type': env.event.type,
                  'caia.event.id': env.event.id,
                  'caia.event.sender': env.sender,
                  'caia.subscription.glob': entry.glob,
                  'caia.delivery.count': deliveryCount,
                },
              },
              async () => entry.handler!(env!.event),
            );
          }
          msg.ack();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (env && deliveryCount > maxRetriesBeforeDlq) {
            try {
              await publishToDlq(
                js,
                dlqSubject,
                env,
                {
                  originalSubject: subjectFor(env.event.type, this.cfg.subjectPrefix),
                  deliveryCount,
                  lastError: errMsg,
                },
              );
              // eslint-disable-next-line no-console
              console.error(
                `[event-bus-nats] DLQ'd after ${deliveryCount} deliveries: ${env.event.type} id=${env.event.id} subject=${dlqSubject}`,
                err,
              );
              msg.ack();
            } catch (dlqErr) {
              // eslint-disable-next-line no-console
              console.error('[event-bus-nats] DLQ publish failed, nak-ing', dlqErr);
              msg.nak(nakBackoffMs(deliveryCount));
            }
          } else {
            // eslint-disable-next-line no-console
            console.warn(
              `[event-bus-nats] handler threw on delivery ${deliveryCount}/${maxRetriesBeforeDlq}, nak-ing`,
              errMsg,
            );
            msg.nak(nakBackoffMs(deliveryCount));
          }
        }
      }
    })().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[event-bus-nats] consumer loop ended', err);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  replay(_opts: EventQueryOpts): ConductorEvent[] {
    // V1: returns []. JetStream-backed replay lands in v0.2.
    return [];
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    for (const sub of this._subs) {
      if (sub.stopper) { try { await sub.stopper(); } catch { /* swallow */ } }
    }
    this._subs = [];
    if (this.nc) {
      const nc = this.nc as { drain(): Promise<void>; close(): Promise<void> };
      try { await nc.drain(); } catch { /* swallow */ }
      try { await nc.close(); } catch { /* swallow */ }
    }
    this.nc = null;
    this.js = null;
    this.jsm = null;
  }

  get _stats() {
    return {
      inflight: this._inflight,
      subCount: this._subs.length,
      closed: this._closed,
      connected: this.nc !== null,
    };
  }
}

function sanitizeDurable(glob: string): string {
  return glob.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'all';
}

export type {
  ConsumerOverride,
  EventBus,
  EventEnvelope,
  EventHandler,
  EventQueryOpts,
  NatsEventBusConfig,
  PublishInput,
  Unsubscribe,
} from './types.js';
export {
  encodeEnvelope,
  decodeEnvelope,
  subjectFor,
  subjectGlob,
  eventTypeFromSubject,
  inflateEvent,
  wrap,
  makeEventId,
} from './envelope.js';
export { DEFAULT_STREAM, defaultConsumer, NAMESPACE_HINTS } from './streams.js';
export type { DlqAdvisory, DlqHandler, DlqPublisher } from './dlq.js';
export { defaultDlqHandler, nakBackoffMs, publishToDlq } from './dlq.js';
export {
  HybridEventBus,
  parseFlagCsv,
  BUS_BACKEND_NATS_ENV_VAR,
  type HybridEventBusOptions,
  type LegacyEventBus,
} from './router.js';
export {
  WAVE_1A_EVENT_TYPES,
  WAVE_1A_CONSUMER_OVERRIDES,
  WAVE_1A_DLQ_SUBJECT,
  isWave1aEvent,
  type Wave1aEventType,
} from './wave1a.js';
