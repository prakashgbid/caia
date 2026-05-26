/**
 * Manual NATS span helpers.
 *
 * The `nats@2` client we use has no first-party OTel instrumentation,
 * so @chiefaia/event-bus-nats wraps its publish and consume sites
 * with the two helpers below. They:
 *
 *   1. Start a span named `nats.publish <subject>` /
 *      `nats.consume <subject>` with `messaging.system = "nats"` and
 *      `messaging.destination = <subject>` attributes (per
 *      OpenTelemetry semantic conventions for messaging).
 *   2. On publish: inject the W3C TraceContext into a `headers`-like
 *      carrier the caller threads into the publish call.
 *   3. On consume: extract the parent context from the same carrier
 *      so the consumer span is correctly linked to the producer.
 *
 * The wrappers are independent of the actual nats.js types — they
 * accept and return plain `Record<string, string>` carriers and let
 * the caller adapt to whatever message shape they have.
 */

import type { Span, SpanContext, TraceCarrier } from './types.js';
import { createTracer } from './tracer.js';
import { extractContext, injectContext } from './propagation.js';

const TRACER_NAME = '@chiefaia/event-bus-nats';
const tracer = createTracer(TRACER_NAME);

export interface NatsPublishSpanOpts {
  readonly subject: string;
  /**
   * Carrier the helper writes the W3C TraceContext into. The caller
   * passes this object as the NATS message headers (or fans it into
   * the event envelope). MUTATED.
   */
  readonly carrier: TraceCarrier;
  /** Optional extra attributes added to the span. */
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface NatsConsumeSpanOpts {
  readonly subject: string;
  /** Carrier received with the message (NATS headers or envelope). */
  readonly carrier: TraceCarrier;
  /** Optional extra attributes added to the span. */
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

function applyCommonAttrs(
  span: Span,
  kind: 'publish' | 'consume',
  subject: string,
  extra?: Readonly<Record<string, string | number | boolean>>,
): void {
  span.setAttribute('messaging.system', 'nats');
  span.setAttribute('messaging.destination', subject);
  span.setAttribute('messaging.destination_kind', 'topic');
  span.setAttribute('messaging.operation', kind === 'publish' ? 'publish' : 'receive');
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      span.setAttribute(k, v);
    }
  }
}

/**
 * Wrap a NATS publish in a span. Injects W3C TraceContext into the
 * caller-supplied carrier so the consumer can rebuild the parent
 * span context.
 *
 *   const carrier: TraceCarrier = {};
 *   await withNatsPublishSpan(
 *     { subject, carrier, attributes: { 'caia.event.type': type } },
 *     () => js.publish(subject, payload, { headers: toNatsHeaders(carrier) }),
 *   );
 */
export async function withNatsPublishSpan<T>(
  opts: NatsPublishSpanOpts,
  fn: () => T | Promise<T>,
): Promise<T> {
  return tracer.withSpan(`nats.publish ${opts.subject}`, async (span) => {
    applyCommonAttrs(span, 'publish', opts.subject, opts.attributes);
    // Inject this span's context explicitly. The manual tracer in
    // tracer.ts does not stamp the span into OtelContext.active(),
    // so passing span.context here is what makes the W3C propagator
    // actually emit a `traceparent` header. The consumer's
    // extractContext sees us as the parent.
    injectContext(opts.carrier as TraceCarrier, span.context);
    return fn();
  });
}

/**
 * Wrap a NATS message consume in a span. The parent is taken from
 * the carrier the message arrived with — pass the headers / envelope
 * map directly.
 *
 *   await withNatsConsumeSpan(
 *     { subject, carrier: msg.headers, attributes: { 'caia.event.type': t } },
 *     async () => handler(event),
 *   );
 */
export async function withNatsConsumeSpan<T>(
  opts: NatsConsumeSpanOpts,
  fn: (parent: SpanContext | null) => T | Promise<T>,
): Promise<T> {
  const parent = extractContext(opts.carrier);
  return tracer.withSpan(
    `nats.consume ${opts.subject}`,
    async (span) => {
      applyCommonAttrs(span, 'consume', opts.subject, opts.attributes);
      if (parent) {
        span.setAttribute('caia.trace.parent_trace_id', parent.traceId);
        span.setAttribute('caia.trace.parent_span_id', parent.spanId);
      }
      return fn(parent);
    },
    parent ? { parent } : undefined,
  );
}
