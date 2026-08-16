/**
 * @caia/factory-sdk — TypeScript SDK for building a CAIA microfactory.
 *
 * A "microfactory" is a single-purpose service that consumes one artifact type,
 * produces another, and reports its outcome to the control plane.
 *
 * Placeholder — full SDK lands under STOL-1036 (Phase 1 Kernel).
 */

import type { FactoryTaskEnvelope, FactoryTaskOutcome } from "@caia/contracts";

export type FactoryHandler<TIn, TOut> = (
  envelope: FactoryTaskEnvelope<TIn>,
) => Promise<{ outcome: FactoryTaskOutcome; artifact?: TOut }>;

export interface FactoryOptions {
  readonly sfId: `SF-${string}`;
  readonly version: string;
}

/**
 * Register a microfactory handler. Full implementation will wire OTel spans,
 * contract validation, ledger writes, retry/backoff, and health endpoints.
 */
export function createFactory<TIn, TOut>(
  _opts: FactoryOptions,
  _handler: FactoryHandler<TIn, TOut>,
): { start: () => Promise<void> } {
  return {
    async start() {
      // TODO(STOL-1036): implement transport bind + validation + OTel.
      throw new Error("factory-sdk-ts: not implemented — landing in STOL-1036");
    },
  };
}
