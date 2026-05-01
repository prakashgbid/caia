/**
 * CapabilityExecutor — privileged subprocess that redeems a token and runs
 * the action via a registered handler. Every execution lands on the ledger.
 */

import { randomBytes } from 'node:crypto';
import {
  ActionPayloadSchema,
  ActionResultSchema,
  type ActionPayload,
  type ActionResult,
  type CapabilityName,
  type CapabilityToken,
  type LedgerEntry,
} from './types.js';
import { CapabilityBrokerError } from './broker.js';
import type { CapabilityBroker } from './broker.js';
import type { IrreversibleActionLedger } from './ledger.js';
import type { IrreversibleDelay } from './irreversible-delay.js';
import type { CapabilityBrokerMetrics } from './metrics.js';

/**
 * A capability handler receives the validated payload + the per-execution
 * context and returns a structured result. Implementations should be
 * idempotent where possible.
 */
export type CapabilityHandler = (
  payload: ActionPayload,
  ctx: HandlerContext,
) => Promise<ActionResult>;

export interface HandlerContext {
  /** Echo of the token so handlers can include it in audit headers. */
  token: CapabilityToken;
  /** Free-form reason captured at issuance time, propagated for logging. */
  reason: string;
  /** Wall-clock timestamp for the execution attempt. */
  ts: number;
}

export interface ExecutorOptions {
  broker: CapabilityBroker;
  ledger: IrreversibleActionLedger;
  handlers: Partial<Record<CapabilityName, CapabilityHandler>>;
  clockMs?: () => number;
  /**
   * Optional irreversible-delay manager (per v2 §3.7). When set, executions
   * of capabilities flagged `irreversible: true` (per the registry) wait
   * the configured delay (default 5_000 ms) before invoking the handler;
   * an operator can call `delay.cancel()` from the dashboard during the
   * window. Without this, irreversibles run immediately (legacy mode for
   * unit tests + first-pass landings).
   */
  irreversibleDelay?: IrreversibleDelay;
  /**
   * Predicate that returns true if the capability should be delayed.
   * Defaults to "all capabilities" when `irreversibleDelay` is set; the
   * orchestrator passes a predicate sourced from the registry's
   * `Capability.irreversible` field.
   */
  isIrreversible?: (name: CapabilityName) => boolean;
  /** Optional logger called for every accept / reject / handler-error / cancelled. */
  log?: (
    ev:
      | { kind: 'accepted'; tokenId: string; name: CapabilityName }
      | { kind: 'rejected'; tokenId: string; reason: string }
      | { kind: 'handler-error'; tokenId: string; error: string }
      | { kind: 'cancelled-by-operator'; tokenId: string; name: CapabilityName },
  ) => void;
  /** Optional metrics collector. When provided, execution outcomes and durations are recorded. */
  metrics?: CapabilityBrokerMetrics;
}

export class CapabilityExecutor {
  private readonly broker: CapabilityBroker;
  private readonly ledger: IrreversibleActionLedger;
  private readonly handlers: Partial<Record<CapabilityName, CapabilityHandler>>;
  private readonly clockMs: () => number;
  private readonly log?: ExecutorOptions['log'];
  private readonly irreversibleDelay: IrreversibleDelay | undefined;
  private readonly isIrreversible: ((name: CapabilityName) => boolean) | undefined;
  private readonly metrics?: CapabilityBrokerMetrics;

  constructor(opts: ExecutorOptions) {
    this.broker = opts.broker;
    this.ledger = opts.ledger;
    this.handlers = opts.handlers;
    this.clockMs = opts.clockMs ?? (() => Date.now());
    if (opts.log) this.log = opts.log;
    if (opts.irreversibleDelay) this.irreversibleDelay = opts.irreversibleDelay;
    if (opts.isIrreversible) this.isIrreversible = opts.isIrreversible;
    if (opts.metrics) this.metrics = opts.metrics;
  }

  /**
   * Validate the token + run the action. Always records to the ledger when
   * the action is irreversible, including failure cases — that's the point
   * of an append-only ledger.
   */
  async execute(opts: {
    token: CapabilityToken;
    payload: ActionPayload;
    reason: string;
  }): Promise<ActionResult> {
    const payload = ActionPayloadSchema.parse(opts.payload);
    try {
      this.broker.validate({
        token: opts.token,
        expectedName: payload.name,
        expectedScope: payload.scope,
      });
    } catch (err) {
      const reason =
        err instanceof CapabilityBrokerError
          ? `${err.code}: ${err.message}`
          : String(err);
      this.log?.({ kind: 'rejected', tokenId: opts.token.tokenId, reason });
      this.metrics?.executionsTotal.inc({ capability: payload.name, outcome: 'rejected' });
      throw err;
    }
    this.log?.({
      kind: 'accepted',
      tokenId: opts.token.tokenId,
      name: payload.name,
    });
    if (this.irreversibleDelay) {
      const isIrr = this.isIrreversible
        ? this.isIrreversible(payload.name)
        : true;
      if (isIrr) {
        const result = await this.irreversibleDelay.begin({
          token: opts.token,
          reason: opts.reason,
        });
        if (result.cancelled) {
          this.log?.({
            kind: 'cancelled-by-operator',
            tokenId: opts.token.tokenId,
            name: payload.name,
          });
          const cancelledResult: ActionResult = {
            ok: false,
            error: 'cancelled-by-operator',
          };
          this.metrics?.executionsTotal.inc({ capability: payload.name, outcome: 'cancelled' });
          await this.recordToLedger(
            opts.token,
            payload,
            opts.reason,
            cancelledResult,
          );
          return ActionResultSchema.parse(cancelledResult);
        }
      }
    }
    const handler = this.handlers[payload.name];
    if (!handler) {
      const result: ActionResult = {
        ok: false,
        error: `no handler registered for capability '${payload.name}'`,
      };
      this.metrics?.executionsTotal.inc({ capability: payload.name, outcome: 'no_handler' });
      await this.recordToLedger(opts.token, payload, opts.reason, result);
      return ActionResultSchema.parse(result);
    }
    const ctx: HandlerContext = {
      token: opts.token,
      reason: opts.reason,
      ts: this.clockMs(),
    };
    let result: ActionResult;
    const handlerStart = this.clockMs();
    try {
      result = ActionResultSchema.parse(await handler(payload, ctx));
      const durationMs = this.clockMs() - handlerStart;
      this.metrics?.executionsTotal.inc({ capability: payload.name, outcome: 'ok' });
      this.metrics?.executionDurationMs.observe(durationMs, { capability: payload.name, outcome: 'ok' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log?.({
        kind: 'handler-error',
        tokenId: opts.token.tokenId,
        error: msg,
      });
      result = { ok: false, error: msg };
      const durationMs = this.clockMs() - handlerStart;
      this.metrics?.executionsTotal.inc({ capability: payload.name, outcome: 'error' });
      this.metrics?.executionDurationMs.observe(durationMs, { capability: payload.name, outcome: 'error' });
    }
    await this.recordToLedger(opts.token, payload, opts.reason, result);
    return result;
  }

  private async recordToLedger(
    token: CapabilityToken,
    payload: ActionPayload,
    reason: string,
    result: ActionResult,
  ): Promise<void> {
    const entry: LedgerEntry = {
      id: randomBytes(12).toString('hex'),
      ts: this.clockMs(),
      agentRole: token.agentRole,
      taskId: token.taskId,
      capabilityName: token.name,
      scope: token.scope,
      reason,
      actionPayloadJson: JSON.stringify(payload),
      resultJson: JSON.stringify(result),
      undoToken: result.undoToken ?? null,
    };
    await this.ledger.append(entry);
  }
}
