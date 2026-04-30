/**
 * Capability broker — issuance, validation, expiry, allowlist, budget, single-use.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CapabilityBroker,
  CapabilityBrokerError,
  type BrokerDecision,
  CapabilityRegistry,
  StaticSigningKeyProvider,
  createDefaultRegistry,
} from '../src/index.js';

import { BROKER_TESTS_SIGNING_KEY as SIGNING_KEY } from './__fixtures__/signing-keys.js';

function makeRegistry(): CapabilityRegistry {
  const reg = createDefaultRegistry();
  reg.registerAllowlistEntry({
    name: 'cloudflare.api',
    agentRole: 'coding-agent',
    scopePattern: 'cf/zones/*/dns_records*',
    maxPerTask: 3,
  });
  reg.registerAllowlistEntry({
    name: 'gh.pr.merge',
    agentRole: 'release-bot',
    scopePattern: 'pr/*',
  });
  reg.registerAllowlistEntry({
    name: 'git.push.protected',
    agentRole: 'release-bot',
    scopePattern: 'origin/refs/heads/main',
  });
  return reg;
}

function makeBroker(opts?: {
  clock?: { now: () => number };
  onDecision?: (d: BrokerDecision) => void;
}): CapabilityBroker {
  return new CapabilityBroker({
    registry: makeRegistry(),
    signingKey: new StaticSigningKeyProvider(SIGNING_KEY),
    ...(opts?.clock ? { clock: opts.clock } : {}),
    ...(opts?.onDecision ? { onDecision: opts.onDecision } : {}),
  });
}

describe('CapabilityBroker.issue', () => {
  it('issues a token when the request matches the allowlist', () => {
    const broker = makeBroker();
    const tok = broker.issue({
      name: 'cloudflare.api',
      scope: 'cf/zones/abc/dns_records/POST',
      agentRole: 'coding-agent',
      taskId: 'task-1',
      reason: 'create dns record for chiefaia.com',
    });
    expect(tok.tokenId).toHaveLength(32);
    expect(tok.signature).toMatch(/^[0-9a-f]+$/);
    expect(tok.expiresAt).toBeGreaterThan(tok.issuedAt);
    expect(tok.singleUse).toBe(true);
  });

  it('rejects an unknown agent role', () => {
    const broker = makeBroker();
    expect(() =>
      broker.issue({
        name: 'cloudflare.api',
        scope: 'cf/zones/abc/dns_records/POST',
        agentRole: 'pirate-agent',
        taskId: 't',
        reason: 'mischief',
      }),
    ).toThrow(CapabilityBrokerError);
  });

  it('rejects a scope that does not match the allowlist pattern', () => {
    const broker = makeBroker();
    expect(() =>
      broker.issue({
        name: 'cloudflare.api',
        scope: 'cf/account/billing/PUT',
        agentRole: 'coding-agent',
        taskId: 't',
        reason: 'attempt to call billing endpoint',
      }),
    ).toThrow(/allowlist_miss|allowlist miss/i);
  });

  it('enforces per-task budget caps', () => {
    const broker = makeBroker();
    for (let i = 0; i < 3; i++) {
      broker.issue({
        name: 'cloudflare.api',
        scope: 'cf/zones/abc/dns_records/POST',
        agentRole: 'coding-agent',
        taskId: 't-budget',
        reason: `call ${i}`,
      });
    }
    expect(() =>
      broker.issue({
        name: 'cloudflare.api',
        scope: 'cf/zones/abc/dns_records/POST',
        agentRole: 'coding-agent',
        taskId: 't-budget',
        reason: 'call 4 (over budget)',
      }),
    ).toThrow(/budget/i);
  });

  it('caps requested ttl at the capability default', () => {
    let now = 1_000_000;
    const broker = makeBroker({ clock: { now: () => now } });
    const tok = broker.issue({
      name: 'cloudflare.api',
      scope: 'cf/zones/abc/dns_records/POST',
      agentRole: 'coding-agent',
      taskId: 't',
      reason: 'r',
      requestedTtlMs: 24 * 60 * 60 * 1000, // user asks for 1 day
    });
    // Default ttl is 5 minutes.
    expect(tok.expiresAt - tok.issuedAt).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(tok.issuedAt).toBe(now);
  });

  it('emits onDecision for issued + rejected', () => {
    const calls: BrokerDecision[] = [];
    const broker = makeBroker({ onDecision: (d) => calls.push(d) });
    broker.issue({
      name: 'cloudflare.api',
      scope: 'cf/zones/abc/dns_records/POST',
      agentRole: 'coding-agent',
      taskId: 't',
      reason: 'r',
    });
    expect(() =>
      broker.issue({
        name: 'cloudflare.api',
        scope: 'cf/account/billing/PUT', // wrong scope
        agentRole: 'coding-agent',
        taskId: 't',
        reason: 'r',
      }),
    ).toThrow();
    expect(calls.map((c) => c.kind)).toEqual(['issued', 'rejected']);
  });

  it('rejects unknown capability name at the schema layer', () => {
    const broker = makeBroker();
    // Cast through unknown to exercise the runtime path.
    expect(() =>
      broker.issue({
        // @ts-expect-error — testing runtime rejection of a bogus name
        name: 'totally.fake',
        scope: '*',
        agentRole: 'coding-agent',
        taskId: 't',
        reason: 'r',
      }),
    ).toThrow();
  });
});

describe('CapabilityBroker.validate', () => {
  let broker: CapabilityBroker;
  beforeEach(() => {
    broker = makeBroker();
  });

  it('accepts a freshly-issued token', () => {
    const tok = broker.issue({
      name: 'gh.pr.merge',
      scope: 'pr/199',
      agentRole: 'release-bot',
      taskId: 't',
      reason: 'merge release PR',
    });
    expect(() =>
      broker.validate({
        token: tok,
        expectedName: 'gh.pr.merge',
        expectedScope: 'pr/199',
      }),
    ).not.toThrow();
  });

  it('rejects when the expected capability differs', () => {
    const tok = broker.issue({
      name: 'gh.pr.merge',
      scope: 'pr/199',
      agentRole: 'release-bot',
      taskId: 't',
      reason: 'r',
    });
    expect(() =>
      broker.validate({
        token: tok,
        expectedName: 'npm.publish',
        expectedScope: 'pr/199',
      }),
    ).toThrow(/wrong_capability/);
  });

  it('rejects when the expected scope differs', () => {
    const tok = broker.issue({
      name: 'gh.pr.merge',
      scope: 'pr/199',
      agentRole: 'release-bot',
      taskId: 't',
      reason: 'r',
    });
    expect(() =>
      broker.validate({
        token: tok,
        expectedName: 'gh.pr.merge',
        expectedScope: 'pr/200',
      }),
    ).toThrow(/wrong_scope/);
  });

  it('rejects an expired token', () => {
    let now = 100;
    const b = makeBroker({ clock: { now: () => now } });
    const tok = b.issue({
      name: 'gh.pr.merge',
      scope: 'pr/1',
      agentRole: 'release-bot',
      taskId: 't',
      reason: 'r',
    });
    now += 10 * 60 * 1000; // 10 min later
    expect(() =>
      b.validate({
        token: tok,
        expectedName: 'gh.pr.merge',
        expectedScope: 'pr/1',
      }),
    ).toThrow(/expired_token/);
  });

  it('rejects a tampered signature', () => {
    const tok = broker.issue({
      name: 'gh.pr.merge',
      scope: 'pr/1',
      agentRole: 'release-bot',
      taskId: 't',
      reason: 'r',
    });
    const tampered = { ...tok, signature: '00'.repeat(32) };
    expect(() =>
      broker.validate({
        token: tampered,
        expectedName: 'gh.pr.merge',
        expectedScope: 'pr/1',
      }),
    ).toThrow(/invalid_signature/);
  });

  it('rejects a tampered scope (signature mismatch)', () => {
    const tok = broker.issue({
      name: 'gh.pr.merge',
      scope: 'pr/1',
      agentRole: 'release-bot',
      taskId: 't',
      reason: 'r',
    });
    const tampered = { ...tok, scope: 'pr/9999' };
    expect(() =>
      broker.validate({
        token: tampered,
        expectedName: 'gh.pr.merge',
        expectedScope: 'pr/9999',
      }),
    ).toThrow(/invalid_signature|wrong_scope/);
  });

  it('refuses to redeem a single-use token twice', () => {
    const tok = broker.issue({
      name: 'gh.pr.merge',
      scope: 'pr/1',
      agentRole: 'release-bot',
      taskId: 't',
      reason: 'r',
    });
    broker.validate({
      token: tok,
      expectedName: 'gh.pr.merge',
      expectedScope: 'pr/1',
    });
    expect(() =>
      broker.validate({
        token: tok,
        expectedName: 'gh.pr.merge',
        expectedScope: 'pr/1',
      }),
    ).toThrow(/token_already_used/);
  });

  it('emits a redeemed decision on successful validate', () => {
    const calls: BrokerDecision[] = [];
    const b = makeBroker({ onDecision: (d) => calls.push(d) });
    const tok = b.issue({
      name: 'gh.pr.merge',
      scope: 'pr/1',
      agentRole: 'release-bot',
      taskId: 't',
      reason: 'r',
    });
    b.validate({
      token: tok,
      expectedName: 'gh.pr.merge',
      expectedScope: 'pr/1',
    });
    const kinds = calls.map((c) => c.kind);
    expect(kinds).toContain('redeemed');
  });
});

describe('CapabilityBroker.signing key rotation', () => {
  it('verifies tokens issued under a rotated key as long as it is still accepted', () => {
    // Provider returns multiple accepted keys, newest first, with the active
    // key being key2. Tokens issued earlier under key1 must still verify.
    const key1 = Buffer.from('first-key-eeeeeeeeeeeeeeeeeeeeee');
    const key2 = Buffer.from('second-key-fffffffffffffffffffff');
    const provider = {
      getActiveKey: () => key2,
      getAcceptedKeys: () => [key2, key1] as const,
    };
    const reg = makeRegistry();
    const broker = new CapabilityBroker({ registry: reg, signingKey: provider });
    // Patch active key to key1 to simulate an "older" token.
    const olderProvider = {
      getActiveKey: () => key1,
      getAcceptedKeys: () => [key1, key2] as const,
    };
    const olderBroker = new CapabilityBroker({
      registry: reg,
      signingKey: olderProvider,
    });
    const tok = olderBroker.issue({
      name: 'gh.pr.merge',
      scope: 'pr/1',
      agentRole: 'release-bot',
      taskId: 't',
      reason: 'r',
    });
    expect(() =>
      broker.validate({
        token: tok,
        expectedName: 'gh.pr.merge',
        expectedScope: 'pr/1',
      }),
    ).not.toThrow();
  });
});

describe('StaticSigningKeyProvider', () => {
  it('rejects a too-short secret', () => {
    expect(() => new StaticSigningKeyProvider('short')).toThrow(/at least 16/);
  });

  it('uses Buffer secrets verbatim', () => {
    const provider = new StaticSigningKeyProvider(
      Buffer.from('1234567890abcdef'),
    );
    expect(provider.getActiveKey().length).toBe(16);
  });
});
