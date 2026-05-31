/**
 * Wizard-side OTel span helper around `@chiefaia/claude-spawner` calls.
 *
 * `@chiefaia/claude-spawner.spawnClaude` already emits its own
 * `claude.spawn` span carrying binary path, model, timeout, exit code,
 * etc — that's the "low-level" view useful to spawner-internals
 * debugging. The wizard pipeline needs a complementary "high-level"
 * span that wraps the *entire* round trip from a wizard step's POV:
 *
 *     wizard step           withClaudeSpawnerSpan(...)
 *       └─ claude-spawner   claude.spawn  (from claude-spawner internals)
 *
 * The wizard wrapper carries the semantic attributes operators care
 * about when looking at a Tempo trace ("which wizard step was this?
 * which project? which prompt template?") and the inner spawner span
 * carries the binary-level diagnostics. Together they form a
 * parent-child pair that round-trips trace_id through the W3C
 * propagator so Tempo can stitch the wizard pod's trace to the
 * engine's trace (when the live path crosses a process boundary).
 *
 * SUBSCRIPTION-ONLY: this helper is purely an OTel wrapper — it does
 * not invoke `claude` itself. The wrapped `fn` MUST call through
 * `@chiefaia/claude-spawner.spawnClaude` (directly or transitively
 * via `@caia/interviewer`, `@caia/business-proposal-generator`, etc).
 * Direct raw OTel SDK calls or shell-outs to `claude` are forbidden
 * per the Phase B gap-analysis report (see PR description).
 *
 * IMPLEMENTATION NOTE — OtelContext threading:
 *   Unlike the manual `createTracer().withSpan` surface in tracer.ts
 *   (which deliberately does NOT push the new span into
 *   `OtelContext.active()` for backwards compat), this helper threads
 *   the new span through `context.with(...)` so any nested OTel
 *   operations performed inside `fn` — including a transitive
 *   `spawnClaude` call's own `claude.spawn` span and any
 *   `injectContext()` write into a NATS / HTTP carrier — see the
 *   wizard span as their parent. This is what makes the wizard
 *   trace_id propagate to Tempo end-to-end (W3C TraceContext).
 */

import {
  trace,
  context as otelContext,
  SpanStatusCode,
  SpanKind,
  type Span as OtelSpan,
} from '@opentelemetry/api';

import type { Span, SpanContext } from './types.js';
import { wrapOtelSpan, buildSpanContext } from './tracer.js';

/**
 * Tracer name used for the wizard-side wrapper span. Picking a
 * single name across all wizard routes means Tempo's service-name
 * filter shows one row for the wizard's claude calls, regardless
 * of which step emitted them — operators can still narrow by the
 * `caia.wizard.step` attribute.
 */
export const WIZARD_CLAUDE_TRACER_NAME = '@caia/wizard.claude';

/**
 * Span name emitted by {@link withClaudeSpawnerSpan} when the caller
 * does not supply a custom operation name. Keeping a stable default
 * makes Tempo's "operation = claude.spawn.wizard" filter immediately
 * useful across the four wizard step routes.
 */
export const DEFAULT_WIZARD_CLAUDE_SPAN_NAME = 'claude.spawn.wizard';

/**
 * Semantic attributes the wizard wrapper attaches to its span.
 *
 * All fields are optional so callers can omit attributes that
 * legitimately don't apply (e.g. a route that has no prompt template
 * because it's a stub). The wrapper coerces `null` / `undefined` to a
 * skipped setAttribute call, matching how the NATS instrumentation
 * helper handles missing context.
 */
export interface WizardClaudeSpanAttributes {
  /**
   * Which wizard step is calling claude. Values mirror the FSM
   * step names — e.g. `interview.answer`, `interview.complete`,
   * `proposal.generate`, `architecture.run`.
   */
  readonly step?: string;
  /** The wizard project ID. Used by operators to filter a single tenant project's traces. */
  readonly projectId?: string;
  /** The tenant ID. Useful when one operator owns multiple tenant projects. */
  readonly tenantId?: string;
  /**
   * The prompt template identifier the wizard step is invoking. Free-form
   * string — `playbook:question-bank.v1`, `proposal:exec-summary`, etc.
   * Distinguishes which prompt produced a slow / failed claude call when
   * the same step issues several prompts per request.
   */
  readonly promptTemplate?: string;
  /** Claude model tag — `claude-opus-4-6`, `claude-sonnet-4-6`, etc. */
  readonly model?: string;
  /**
   * Optional turn number (multi-turn interview rounds). Surfaced as
   * `caia.wizard.turn` on the span.
   */
  readonly turn?: number;
  /** Free-form additional attributes — passed through as-is. */
  readonly extra?: Readonly<Record<string, string | number | boolean>>;
}

/** Options accepted by {@link withClaudeSpawnerSpan}. */
export interface WithClaudeSpawnerSpanOptions {
  /**
   * Override the span name. Defaults to {@link DEFAULT_WIZARD_CLAUDE_SPAN_NAME}.
   * Callers that want a step-specific name (`claude.spawn.wizard.interview.answer`)
   * can pass it here.
   */
  readonly operationName?: string;
  /**
   * Optional parent span context. When supplied, the wizard span is
   * created as a child of `parent` (used when the wizard handler has
   * already extracted a `traceparent` header from an upstream service).
   * When omitted, OTel's active-context manager picks the parent —
   * typically a route-level `withSpan` already in scope.
   */
  readonly parent?: SpanContext;
}

function applyAttributes(span: Span, attrs: WizardClaudeSpanAttributes): void {
  // Semantic attributes per the Phase B B3 task spec. Keys follow the
  // `caia.wizard.*` / `caia.claude.*` convention so they don't collide
  // with the spawner-internal `claude.*` keys from claude-spawner.
  if (attrs.step !== undefined) span.setAttribute('caia.wizard.step', attrs.step);
  if (attrs.projectId !== undefined) span.setAttribute('caia.wizard.project_id', attrs.projectId);
  if (attrs.tenantId !== undefined) span.setAttribute('caia.wizard.tenant_id', attrs.tenantId);
  if (attrs.promptTemplate !== undefined) {
    span.setAttribute('caia.claude.prompt_template', attrs.promptTemplate);
  }
  if (attrs.model !== undefined) span.setAttribute('caia.claude.model', attrs.model);
  if (attrs.turn !== undefined) span.setAttribute('caia.wizard.turn', attrs.turn);
  if (attrs.extra) {
    for (const [k, v] of Object.entries(attrs.extra)) {
      span.setAttribute(k, v);
    }
  }
}

/**
 * Wrap a wizard-side claude-spawner invocation with an OTel span.
 *
 * The span:
 *   1. Attaches `caia.wizard.step`, `caia.wizard.project_id`,
 *      `caia.claude.prompt_template`, `caia.claude.model`, and any
 *      `extra` attributes supplied by the caller.
 *   2. Becomes the parent of the `claude.spawn` span emitted by
 *      `@chiefaia/claude-spawner.spawnClaude` (the OTel context
 *      manager threads the parentage automatically via `context.with`).
 *   3. Records latency via the OTel SDK's automatic span duration
 *      (start → end). Explicit `caia.claude.duration_ms` attribute
 *      is added on completion for parity with the spawner span.
 *   4. Marks the span `ok` on resolve and `error` (with the error
 *      message) on reject. Always ends — even when `fn` throws.
 *
 * @param attrs - Wizard step semantic attributes.
 * @param fn    - Async function performing the claude-spawner call.
 * @param opts  - Optional span-name override and parent context.
 * @returns The result returned by `fn`. Errors propagate unchanged.
 *
 * @example
 *   await withClaudeSpawnerSpan(
 *     { step: 'interview.answer', projectId, model: 'claude-opus-4-6',
 *       promptTemplate: 'playbook:question-bank.v1' },
 *     async () => interviewer.advance(...),
 *   );
 */
export async function withClaudeSpawnerSpan<T>(
  attrs: WizardClaudeSpanAttributes,
  fn: () => T | Promise<T>,
  opts: WithClaudeSpawnerSpanOptions = {},
): Promise<T> {
  const operationName = opts.operationName ?? DEFAULT_WIZARD_CLAUDE_SPAN_NAME;
  const startedAt = Date.now();

  // Decide the parent context.
  //   - opts.parent supplied   → build a remote span context (typically
  //                              extracted from a `traceparent` header)
  //                              and use it as the parent.
  //   - opts.parent omitted    → use the currently-active OtelContext,
  //                              which picks up any route-level span
  //                              that wrapped this call via
  //                              `context.with(...)` upstream.
  let parentCtx = otelContext.active();
  if (opts.parent !== undefined) {
    const remote = trace.wrapSpanContext({
      traceId: opts.parent.traceId,
      spanId: opts.parent.spanId,
      traceFlags: 1, // SAMPLED — matches W3C traceparent flags=01
      isRemote: true,
    });
    parentCtx = trace.setSpan(otelContext.active(), remote);
  }

  const otelTracer = trace.getTracer(WIZARD_CLAUDE_TRACER_NAME);
  const otelSpan: OtelSpan = otelTracer.startSpan(
    operationName,
    { kind: SpanKind.INTERNAL },
    parentCtx,
  );
  const spanCtx = buildSpanContext(otelSpan, opts.parent);
  const span = wrapOtelSpan(otelSpan, spanCtx);

  applyAttributes(span, attrs);

  // Thread the new span through OtelContext.with so nested OTel
  // operations (including the transitive `claude.spawn` span from
  // claude-spawner and any `injectContext` calls into NATS / HTTP
  // carriers) see this span as their parent. This is what makes
  // trace_id propagate end-to-end to Tempo.
  const ctxWithSpan = trace.setSpan(parentCtx, otelSpan);
  try {
    const result = await otelContext.with(ctxWithSpan, fn);
    span.setAttribute('caia.claude.duration_ms', Date.now() - startedAt);
    span.setAttribute('caia.claude.ok', true);
    otelSpan.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setAttribute('caia.claude.duration_ms', Date.now() - startedAt);
    span.setAttribute('caia.claude.ok', false);
    const msg = err instanceof Error ? err.message : String(err);
    otelSpan.setStatus({ code: SpanStatusCode.ERROR, message: msg });
    throw err;
  } finally {
    otelSpan.end();
  }
}

/**
 * Lower-level escape hatch: callers that already own a parent span
 * (typically a route-level `tracer.withSpan('wizard.<step>', ...)`)
 * and just want to record claude-spawn attributes onto a fresh child
 * span without rebuilding the wrapper can use this directly.
 *
 * The signature deliberately mirrors `withClaudeSpawnerSpan` so the
 * call sites are interchangeable; the only difference is the default
 * operation name carries the `.child` suffix to make the span tree
 * legible in Tempo.
 */
export async function withClaudeSpawnerChildSpan<T>(
  attrs: WizardClaudeSpanAttributes,
  fn: () => T | Promise<T>,
  opts: WithClaudeSpawnerSpanOptions = {},
): Promise<T> {
  return withClaudeSpawnerSpan(attrs, fn, {
    operationName: opts.operationName ?? `${DEFAULT_WIZARD_CLAUDE_SPAN_NAME}.child`,
    ...(opts.parent !== undefined ? { parent: opts.parent } : {}),
  });
}
