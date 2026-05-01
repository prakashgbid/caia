/**
 * CapabilityBroker — issues, validates, and tracks redemption of
 * capability tokens.
 */

import {
  CapabilityIssueRequestSchema,
  CapabilityTokenSchema,
} from './types.js';
import type {
  CapabilityIssueRequest,
  CapabilityToken,
  CapabilityName,
} from './types.js';
import type { CapabilityRegistry } from './registry.js';
import {
  newTokenId,
  signTokenPayload,
  verifyTokenSignature,
  type SigningKeyProvider,
} from './signing.js';
import type { CapabilityBrokerMetrics } from './metrics.js';

export interface BrokerClock {
  now(): number;
}

const realClock: BrokerClock = { now: () => Date.now() };

export interface BrokerOptions {
  registry: CapabilityRegistry;
  signingKey: SigningKeyProvider;
  clock?: BrokerClock;
  /**
   * Optional hook called every time the broker emits a decision (issued /
   * rejected / redeemed). Used by the orchestrator to mirror decisions onto
   * its audit_log.
   */
  onDecision?: (decision: BrokerDecision) => void;
  /** Optional metrics collector. When provided, issuance and validation outcomes are counted. */
  metrics?: CapabilityBrokerMetrics;
}

export type BrokerDecision =
  | {
      kind: 'issued';
      token: CapabilityToken;
      request: CapabilityIssueRequest;
    }
  | {
      kind: 'rejected';
      reason: string;
      request: CapabilityIssueRequest;
    }
  | {
      kind: 'redeemed';
      tokenId: string;
      name: CapabilityName;
      taskId: string;
    };

export type CapabilityBrokerErrorCode =
  | 'unknown_capability'
  | 'allowlist_miss'
  | 'budget_exceeded'
  | 'invalid_token'
  | 'expired_token'
  | 'wrong_scope'
  | 'wrong_capability'
  | 'token_already_used'
  | 'invalid_signature';

export class CapabilityBrokerError extends Error {
  constructor(
    public readonly code: CapabilityBrokerErrorCode,
    detail: string,
  ) {
    // Prefix the code so logs/tests can grep for it deterministically.
    super(`${code}: ${detail}`);
    this.name = 'CapabilityBrokerError';
  }
}

export class CapabilityBroker {
  private readonly registry: CapabilityRegistry;
  private readonly signingKey: SigningKeyProvider;
  private readonly clock: BrokerClock;
  private readonly onDecision?: (d: BrokerDecision) => void;
  private readonly metrics?: CapabilityBrokerMetrics;
  /** Per-task call counts keyed by `${taskId}|${name}`. */
  private readonly perTaskCounts = new Map<string, number>();
  /** Token-ids that have been redeemed (single-use enforcement). */
  private readonly redeemedTokens = new Set<string>();

  constructor(opts: BrokerOptions) {
    this.registry = opts.registry;
    this.signingKey = opts.signingKey;
    this.clock = opts.clock ?? realClock;
    if (opts.onDecision) this.onDecision = opts.onDecision;
    if (opts.metrics) this.metrics = opts.metrics;
  }

  /**
   * Issue a fresh capability token, or throw `CapabilityBrokerError` if the
   * request is rejected.
   */
  issue(request: CapabilityIssueRequest): CapabilityToken {
    const parsed = CapabilityIssueRequestSchema.parse(request);
    const cap = this.registry.getCapability(parsed.name);
    if (!cap) {
      const reason = `unknown capability '${parsed.name}'`;
      this.emitDecision({ kind: 'rejected', reason, request: parsed });
      this.metrics?.tokensRejectedTotal.inc({ capability: parsed.name, code: 'unknown_capability' });
      throw new CapabilityBrokerError('unknown_capability', reason);
    }
    const allowEntry = this.registry.findAllowlistMatch(
      parsed.name,
      parsed.agentRole,
      parsed.scope,
    );
    if (!allowEntry) {
      const reason = `allowlist miss: agent='${parsed.agentRole}' name='${parsed.name}' scope='${parsed.scope}'`;
      this.emitDecision({ kind: 'rejected', reason, request: parsed });
      this.metrics?.tokensRejectedTotal.inc({ capability: parsed.name, code: 'allowlist_miss' });
      throw new CapabilityBrokerError('allowlist_miss', reason);
    }
    if (allowEntry.maxPerTask !== undefined) {
      const key = `${parsed.taskId}|${parsed.name}`;
      const used = this.perTaskCounts.get(key) ?? 0;
      if (used >= allowEntry.maxPerTask) {
        const reason = `budget exceeded: ${parsed.name} task=${parsed.taskId} used=${used} limit=${allowEntry.maxPerTask}`;
        this.emitDecision({ kind: 'rejected', reason, request: parsed });
        this.metrics?.tokensRejectedTotal.inc({ capability: parsed.name, code: 'budget_exceeded' });
        throw new CapabilityBrokerError('budget_exceeded', reason);
      }
      this.perTaskCounts.set(key, used + 1);
    }
    const issuedAt = this.clock.now();
    const ttl = Math.min(
      cap.ttlMs,
      parsed.requestedTtlMs ?? cap.ttlMs,
    );
    const expiresAt = issuedAt + ttl;
    const tokenId = newTokenId();
    const unsigned: Omit<CapabilityToken, 'signature'> = {
      tokenId,
      name: parsed.name,
      scope: parsed.scope,
      agentRole: parsed.agentRole,
      taskId: parsed.taskId,
      issuedAt,
      expiresAt,
      singleUse: true,
    };
    const signature = signTokenPayload(unsigned, this.signingKey);
    const token = CapabilityTokenSchema.parse({ ...unsigned, signature });
    this.emitDecision({ kind: 'issued', token, request: parsed });
    this.metrics?.tokensIssuedTotal.inc({ capability: parsed.name, agent_role: parsed.agentRole });
    return token;
  }

  /**
   * Validate an inbound token + intended-action shape. Throws on any
   * mismatch. On success the token is marked redeemed (single-use) and the
   * decision is emitted.
   */
  validate(opts: {
    token: CapabilityToken;
    expectedName: CapabilityName;
    expectedScope: string;
  }): void {
    const { token, expectedName, expectedScope } = opts;
    if (token.name !== expectedName) {
      this.metrics?.tokenValidationErrorsTotal.inc({ capability: token.name, code: 'wrong_capability' });
      throw new CapabilityBrokerError(
        'wrong_capability',
        `token name='${token.name}' does not match expected='${expectedName}'`,
      );
    }
    if (token.scope !== expectedScope) {
      this.metrics?.tokenValidationErrorsTotal.inc({ capability: token.name, code: 'wrong_scope' });
      throw new CapabilityBrokerError(
        'wrong_scope',
        `token scope='${token.scope}' does not match expected='${expectedScope}'`,
      );
    }
    if (!verifyTokenSignature(token, this.signingKey)) {
      this.metrics?.tokenValidationErrorsTotal.inc({ capability: token.name, code: 'invalid_signature' });
      throw new CapabilityBrokerError(
        'invalid_signature',
        'capability token signature does not verify against the configured key set',
      );
    }
    const now = this.clock.now();
    if (now >= token.expiresAt) {
      this.metrics?.tokenValidationErrorsTotal.inc({ capability: token.name, code: 'expired_token' });
      throw new CapabilityBrokerError(
        'expired_token',
        `token expired at ${new Date(token.expiresAt).toISOString()} (now=${new Date(now).toISOString()})`,
      );
    }
    if (token.singleUse && this.redeemedTokens.has(token.tokenId)) {
      this.metrics?.tokenValidationErrorsTotal.inc({ capability: token.name, code: 'token_already_used' });
      throw new CapabilityBrokerError(
        'token_already_used',
        `single-use token ${token.tokenId} has already been redeemed`,
      );
    }
    if (token.singleUse) {
      this.redeemedTokens.add(token.tokenId);
    }
    this.emitDecision({
      kind: 'redeemed',
      tokenId: token.tokenId,
      name: token.name,
      taskId: token.taskId,
    });
    this.metrics?.tokensRedeemedTotal.inc({ capability: token.name });
  }

  /** Test-only helper exposed for assertions. */
  _isRedeemed(tokenId: string): boolean {
    return this.redeemedTokens.has(tokenId);
  }

  private emitDecision(d: BrokerDecision): void {
    if (!this.onDecision) return;
    try {
      this.onDecision(d);
    } catch {
      // Hook errors must never break the broker.
    }
  }
}
