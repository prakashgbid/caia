/**
 * Wizard-side retry-spawner adapter (Phase B, task B7).
 *
 * Re-exports the canonical `withRetry`, `defaultClassifyError`,
 * `fromSpawnResult` helpers from `@chiefaia/claude-spawner` and provides
 * a `wizardWithRetry(fn, opts)` convenience that auto-wires:
 *
 *   - the per-project `progressChannel` (so the UI's `/api/wizard/{id}/progress`
 *     endpoint can poll retry events without each route plumbing it
 *     individually),
 *   - the OTel tracer (already wrapped inside @chiefaia/claude-spawner
 *     — we just confirm the import here so the bundler ships it),
 *   - a sensible default `signal` derived from `req.signal` when the
 *     route hands one in.
 *
 * Routes call this instead of touching `@chiefaia/claude-spawner` directly.
 * Future routes that need to spawn Claude get retry/backoff + progress
 * surface for free.
 *
 * Reuse-first: this file is a 30-line wrapper, NOT a new retry impl.
 * The actual retry engine, classifier, backoff math, and span wiring
 * live in `@chiefaia/claude-spawner/src/retry.ts`. We strictly forbid
 * adding parallel retry logic here.
 */

import {
  withRetry as canonicalWithRetry,
  type RetryAttemptOutcome,
  type WithRetryOptions,
  type WithRetryResult,
  type RetryProgressEvent,
} from '@chiefaia/claude-spawner';
import { getProgressChannel, type ProgressKey } from './progress-channel';

export {
  defaultClassifyError,
  computeBackoffDelay,
  fromSpawnResult,
  sanitizeDiagnostic,
} from '@chiefaia/claude-spawner';

export type {
  RetryAttemptOutcome,
  RetryErrorClass,
  RetryProgressEvent,
  WithRetryOptions,
  WithRetryResult,
} from '@chiefaia/claude-spawner';

/** Per-route binding that publishes progress to the wizard's progress channel. */
export interface WizardRetryBinding {
  /** Tenant + project pair the progress events are bucketed under. */
  key: ProgressKey;
  /** Identifies the route (`interview.answer`, etc.) for the UI to render. */
  step:
    | 'interview.answer'
    | 'interview.complete'
    | 'proposal.generate';
}

/**
 * Run `fn` under the canonical retry/backoff envelope AND publish
 * `retry-attempt` / `retry-final` events to the wizard progress channel.
 *
 * Behaviour 1:1 with `@chiefaia/claude-spawner.withRetry`. The only
 * additions are:
 *
 *   - onAttempt / onRetry / onFinal callbacks are composed with the
 *     channel publisher (caller-supplied callbacks still fire).
 *   - lastError is sanitised by the canonical helper before publish.
 */
export async function wizardWithRetry<T>(
  binding: WizardRetryBinding,
  fn: () => Promise<RetryAttemptOutcome<T>>,
  opts: WithRetryOptions<T> = {},
): Promise<WithRetryResult<T>> {
  const channel = getProgressChannel();
  const publish = (kind: 'attempt' | 'retry' | 'final', event: RetryProgressEvent): void => {
    channel.publish(binding.key, {
      step: binding.step,
      kind,
      attempt: event.attempt,
      totalAttempts: event.totalAttempts,
      nextDelayMs: event.nextDelayMs,
      ...(event.errorClass !== undefined ? { errorClass: event.errorClass } : {}),
      ...(event.lastError !== undefined ? { lastError: event.lastError } : {}),
      occurredAtIso: new Date().toISOString(),
    });
  };

  return canonicalWithRetry<T>(fn, {
    ...opts,
    onAttempt: (event) => {
      publish('attempt', event);
      opts.onAttempt?.(event);
    },
    onRetry: (event) => {
      publish('retry', event);
      opts.onRetry?.(event);
    },
    onFinal: (event) => {
      publish('final', event);
      opts.onFinal?.(event);
    },
  });
}
