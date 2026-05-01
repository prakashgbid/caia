/**
 * Prometheus-compatible observability metrics for the capability broker.
 *
 * Wire up by passing a `MetricsRegistry` to `CapabilityBrokerMetrics`, then
 * supply the same instance to `CapabilityBroker` and `CapabilityExecutor`.
 * All metric names live under the `capability_broker_*` namespace.
 */

import type { Counter, Gauge, Histogram, MetricsRegistry } from '@chiefaia/metrics';
import type { IrreversibleDelay } from './irreversible-delay.js';

const HANDLER_DURATION_BUCKETS_MS = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
];

export class CapabilityBrokerMetrics {
  /** Tokens successfully issued, by capability and agent_role. */
  readonly tokensIssuedTotal: Counter;
  /** Issuance rejections, by capability and error code. */
  readonly tokensRejectedTotal: Counter;
  /** Tokens successfully validated + redeemed, by capability. */
  readonly tokensRedeemedTotal: Counter;
  /** Validation failures on inbound tokens (expired, wrong scope, etc.), by capability and code. */
  readonly tokenValidationErrorsTotal: Counter;
  /** Executor invocations, by capability and outcome (ok|error|cancelled|no_handler). */
  readonly executionsTotal: Counter;
  /** Handler wall-clock duration in ms, by capability and outcome. */
  readonly executionDurationMs: Histogram;
  /** Current count of in-flight irreversible-action delay windows (no labels). */
  readonly delayPendingGauge: Gauge;
  /** Operator-cancelled delay windows, by capability. */
  readonly delayCancellationsTotal: Counter;

  constructor(registry: MetricsRegistry) {
    this.tokensIssuedTotal = registry.counter(
      'capability_broker_tokens_issued_total',
      'Total capability tokens issued, labelled by capability and agent_role',
    );
    this.tokensRejectedTotal = registry.counter(
      'capability_broker_tokens_rejected_total',
      'Total capability token issuance rejections, labelled by capability and error code',
    );
    this.tokensRedeemedTotal = registry.counter(
      'capability_broker_tokens_redeemed_total',
      'Total capability tokens successfully validated and redeemed, labelled by capability',
    );
    this.tokenValidationErrorsTotal = registry.counter(
      'capability_broker_token_validation_errors_total',
      'Total capability token validation failures, labelled by capability and error code',
    );
    this.executionsTotal = registry.counter(
      'capability_broker_executions_total',
      'Total capability executor invocations, labelled by capability and outcome',
    );
    this.executionDurationMs = registry.histogram(
      'capability_broker_execution_duration_ms',
      'Handler wall-clock duration in milliseconds, labelled by capability and outcome',
      HANDLER_DURATION_BUCKETS_MS,
    );
    this.delayPendingGauge = registry.gauge(
      'capability_broker_delay_pending',
      'Current count of in-flight irreversible-action delay windows',
    );
    this.delayCancellationsTotal = registry.counter(
      'capability_broker_delay_cancellations_total',
      'Operator-cancelled irreversible-action delay windows, labelled by capability',
    );
  }

  /**
   * Subscribe to an IrreversibleDelay instance so that pending/committed/cancelled
   * events automatically update `delayPendingGauge` and `delayCancellationsTotal`.
   * Returns the unsubscribe function.
   */
  bindDelay(delay: IrreversibleDelay): () => void {
    return delay.on((ev) => {
      if (ev.kind === 'pending') {
        this.delayPendingGauge.inc();
      } else if (ev.kind === 'committed') {
        this.delayPendingGauge.dec();
      } else if (ev.kind === 'cancelled') {
        this.delayPendingGauge.dec();
        this.delayCancellationsTotal.inc({ capability: ev.capabilityName });
      }
    });
  }
}
