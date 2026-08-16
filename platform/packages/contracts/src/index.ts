/**
 * @caia/contracts — public entry point.
 *
 * Types for CAIA microfactory events, artifacts, and control-plane messages.
 * Placeholder: agents will land the real contracts under STOL-1035..STOL-1049.
 */

export const CONTRACTS_SCHEMA_VERSION = "0.0.1" as const;

/** Every microfactory task carries this envelope. */
export interface FactoryTaskEnvelope<TPayload = unknown> {
  readonly taskId: string;
  readonly sfId: `SF-${string}`;
  readonly kernelVersion: string;
  readonly correlationId: string;
  readonly emittedAt: string; // ISO-8601
  readonly payload: TPayload;
}

/** Every microfactory emits one of these outcomes. */
export type FactoryTaskOutcome =
  | { readonly status: "succeeded"; readonly artifactRef: string }
  | { readonly status: "failed"; readonly errorCode: string; readonly detail: string }
  | { readonly status: "deferred"; readonly retryAfterSec: number };
