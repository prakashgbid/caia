/**
 * `withFsmPublish` — NATS lifecycle wrapper for every wizard FSM transition.
 *
 * Concept
 * -------
 *
 * `apps/wizard` dispatches FSM transitions through `@caia/state-machine`'s
 * `StateMachine.transition()`. WIZARD-B5 requires that **every** such
 * call publish three lifecycle events on the bus:
 *
 *   - `wizard.step.transitioning`  — fired *immediately before* the FSM call
 *   - `wizard.step.completed`      — fired *after* the FSM call resolves OK
 *   - `wizard.step.failed`         — fired *if* the FSM call throws
 *
 * `withFsmPublish(opts, fn)` wraps the FSM call. It is the *only* code
 * path the route handlers should use to dispatch transitions; this
 * keeps the publish contract honored in one place instead of duplicated
 * per route.
 *
 * Reuse-first
 * -----------
 *
 *  - Publisher API:    `@chiefaia/event-bus-nats` (via `EventPublisher`)
 *  - Event taxonomy:   `@chiefaia/events-taxonomy-internal` (the three
 *                      types added to `registry.yaml` in this PR)
 *  - Step mapping:     `./steps.ts` (`stepIndexForState`)
 *  - Active trace id:  `@opentelemetry/api` — extracted from the active
 *                      span context if `@chiefaia/tracing` has been
 *                      initialised; falls back to `null` otherwise.
 *
 * Hard invariants
 * ---------------
 *
 *  1. Publish is **fire-and-forget**: the FSM call's success/failure is
 *     never blocked on a publish promise. Publish errors are logged via
 *     `console.warn`; subscribers tolerate gaps (NATS is at-least-once,
 *     so the bus is the source for "did it happen", but downstream code
 *     re-derives from the FSM history table).
 *
 *  2. `wizard.step.failed` carries the error's `.message`; the original
 *     error is re-thrown so the caller's error handling is unchanged.
 *
 *  3. The wrapper is idempotent under double-fire (it does NOT dedupe);
 *     `@caia/state-machine` already enforces idempotent transitions at
 *     the SQL layer. If the same call is retried, three events fire each
 *     attempt — that matches the "every transition publishes" spec and
 *     keeps the conductor's per-attempt forecast honest.
 *
 *  4. `trace_id` is captured at the time of the *transitioning* publish
 *     so the same id appears on the corresponding `completed`/`failed`
 *     event even if the FSM call somehow swaps the active context.
 */

import { trace } from '@opentelemetry/api';
import type { ProjectState } from '@caia/state-machine';
import { stepIndexForState } from './steps';

/**
 * Structural shape we use from the bus. Compatible with
 * `@chiefaia/event-bus-nats`'s `EventBus.publish()` *and* with the
 * `EventPublisher` shape that `provisionTenant` already uses. We
 * intentionally type this here (rather than importing the bus type)
 * so unit tests don't need a NATS connection.
 */
export interface FsmEventPublisher {
  publish(input: {
    type: string;
    severity?: 'debug' | 'info' | 'warning' | 'error';
    actor?: string;
    payload: Record<string, unknown>;
  }): unknown | Promise<unknown>;
}

export interface WithFsmPublishOpts {
  publisher: FsmEventPublisher;
  projectId: string;
  /** Project's current state at call-time, *before* transitioning. */
  fromState: ProjectState;
  /** Target state of the transition. */
  toState: ProjectState;
  /**
   * Per-tenant Postgres schema the FSM call targets. Required so
   * subscribers can route by tenant without re-deriving from project_id.
   */
  tenantSchema: string;
  /**
   * Actor that triggered the transition. Defaults to `'api'` — the
   * common case (a Next.js API handler).
   */
  actor?: 'api' | 'user' | 'system';
  /**
   * Optional clock override for tests (defaults to `Date.now`).
   */
  now?: () => number;
}

/**
 * Return the active trace id (16-byte hex), or `null` if no SDK is wired.
 *
 * `@chiefaia/tracing`'s `initTracing()` registers the global tracer
 * provider; absent that, `trace.getActiveSpan()` returns `undefined`
 * and we fall through to `null`. We never throw — propagation is
 * best-effort.
 */
export function currentTraceId(): string | null {
  try {
    const span = trace.getActiveSpan();
    if (!span) return null;
    const ctx = span.spanContext();
    if (!ctx || !ctx.traceId) return null;
    // OpenTelemetry uses an all-zero traceId for NonRecordingSpan; treat
    // that as "no trace id" so subscribers never see a poisoned value.
    if (/^0+$/.test(ctx.traceId)) return null;
    return ctx.traceId;
  } catch {
    return null;
  }
}

/**
 * Publish `wizard.step.transitioning`. Fire-and-forget; rejections are
 * caught + logged so the FSM call is never blocked.
 */
export async function publishStepTransitioning(
  publisher: FsmEventPublisher,
  payload: {
    project_id: string;
    from_step: number | null;
    to_step: number | null;
    tenant_schema: string;
    trace_id: string | null;
  },
  actor: 'api' | 'user' | 'system' = 'api',
): Promise<void> {
  try {
    await Promise.resolve(
      publisher.publish({
        type: 'wizard.step.transitioning',
        severity: 'info',
        actor,
        payload,
      }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[wizard.fsm-events] publish wizard.step.transitioning failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Publish `wizard.step.completed`. Fire-and-forget. */
export async function publishStepCompleted(
  publisher: FsmEventPublisher,
  payload: {
    project_id: string;
    step: number | null;
    duration_ms: number;
    tenant_schema: string;
    trace_id: string | null;
  },
  actor: 'api' | 'user' | 'system' = 'api',
): Promise<void> {
  try {
    await Promise.resolve(
      publisher.publish({
        type: 'wizard.step.completed',
        severity: 'info',
        actor,
        payload,
      }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[wizard.fsm-events] publish wizard.step.completed failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Publish `wizard.step.failed`. Fire-and-forget. */
export async function publishStepFailed(
  publisher: FsmEventPublisher,
  payload: {
    project_id: string;
    step: number | null;
    error: string;
    tenant_schema: string;
    trace_id: string | null;
  },
  actor: 'api' | 'user' | 'system' = 'api',
): Promise<void> {
  try {
    await Promise.resolve(
      publisher.publish({
        type: 'wizard.step.failed',
        severity: 'error',
        actor,
        payload,
      }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[wizard.fsm-events] publish wizard.step.failed failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Wrap a `StateMachine.transition()` call with the three lifecycle
 * publishes. Returns whatever `fn` returns; rethrows whatever `fn`
 * throws so the route handler's error path is unchanged.
 */
export async function withFsmPublish<T>(
  opts: WithFsmPublishOpts,
  fn: () => Promise<T>,
): Promise<T> {
  const now = opts.now ?? (() => Date.now());
  const fromStep = stepIndexForState(opts.fromState);
  const toStep = stepIndexForState(opts.toState);
  const traceId = currentTraceId();
  const actor = opts.actor ?? 'api';
  const t0 = now();

  // 1. Pre-publish (fire-and-forget — we await the swallow-and-log but
  // not the bus's underlying ack; see publishStep*).
  void publishStepTransitioning(
    opts.publisher,
    {
      project_id: opts.projectId,
      from_step: fromStep,
      to_step: toStep,
      tenant_schema: opts.tenantSchema,
      trace_id: traceId,
    },
    actor,
  );

  try {
    const result = await fn();
    void publishStepCompleted(
      opts.publisher,
      {
        project_id: opts.projectId,
        step: toStep,
        duration_ms: now() - t0,
        tenant_schema: opts.tenantSchema,
        trace_id: traceId,
      },
      actor,
    );
    return result;
  } catch (err) {
    void publishStepFailed(
      opts.publisher,
      {
        project_id: opts.projectId,
        step: toStep,
        error: err instanceof Error ? err.message : String(err),
        tenant_schema: opts.tenantSchema,
        trace_id: traceId,
      },
      actor,
    );
    throw err;
  }
}
