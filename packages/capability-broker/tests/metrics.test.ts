/**
 * CapabilityBrokerMetrics — verifies that broker, executor, and delay
 * wire metrics correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRegistry } from '@chiefaia/metrics';
import {
  CapabilityBroker,
  CapabilityBrokerMetrics,
  CapabilityExecutor,
  IrreversibleDelay,
  InMemoryLedger,
  StaticSigningKeyProvider,
  createDefaultRegistry,
  type CapabilityHandler,
} from '../src/index.js';
import { BROKER_TESTS_SIGNING_KEY } from './__fixtures__/signing-keys.js';

function makeMetrics() {
  const registry = createRegistry();
  return { registry, metrics: new CapabilityBrokerMetrics(registry) };
}

function makeBroker(metrics?: CapabilityBrokerMetrics) {
  const reg = createDefaultRegistry();
  reg.registerAllowlistEntry({
    name: 'cloudflare.api',
    agentRole: 'coding-agent',
    scopePattern: 'cf/zones/*',
    maxPerTask: 2,
  });
  reg.registerAllowlistEntry({
    name: 'gh.pr.merge',
    agentRole: 'release-bot',
    scopePattern: 'pr/*',
  });
  return new CapabilityBroker({
    registry: reg,
    signingKey: new StaticSigningKeyProvider(BROKER_TESTS_SIGNING_KEY),
    metrics,
  });
}

describe('CapabilityBrokerMetrics — broker.issue()', () => {
  it('increments tokensIssuedTotal on success', () => {
    const { metrics } = makeMetrics();
    const broker = makeBroker(metrics);
    broker.issue({
      name: 'cloudflare.api',
      scope: 'cf/zones/abc',
      agentRole: 'coding-agent',
      taskId: 't1',
      reason: 'test',
    });
    expect(
      metrics.tokensIssuedTotal.get({ capability: 'cloudflare.api', agent_role: 'coding-agent' }),
    ).toBe(1);
  });

  it('increments tokensRejectedTotal with allowlist_miss on denied request', () => {
    const { metrics } = makeMetrics();
    const broker = makeBroker(metrics);
    expect(() =>
      broker.issue({
        name: 'cloudflare.api',
        scope: 'cf/zones/abc',
        agentRole: 'unknown-agent', // not in allowlist
        taskId: 't1',
        reason: 'test',
      }),
    ).toThrow();
    expect(
      metrics.tokensRejectedTotal.get({ capability: 'cloudflare.api', code: 'allowlist_miss' }),
    ).toBe(1);
    // No tokens issued
    expect(metrics.tokensIssuedTotal.get({ capability: 'cloudflare.api', agent_role: 'unknown-agent' })).toBe(0);
  });

  it('increments tokensRejectedTotal with budget_exceeded when per-task limit hit', () => {
    const { metrics } = makeMetrics();
    const broker = makeBroker(metrics);
    const base = {
      name: 'cloudflare.api' as const,
      scope: 'cf/zones/abc',
      agentRole: 'coding-agent',
      taskId: 't-budget',
      reason: 'test',
    };
    broker.issue(base); // 1st — ok
    broker.issue(base); // 2nd — ok (maxPerTask = 2)
    expect(() => broker.issue(base)).toThrow(); // 3rd — budget_exceeded
    expect(
      metrics.tokensRejectedTotal.get({ capability: 'cloudflare.api', code: 'budget_exceeded' }),
    ).toBe(1);
    expect(
      metrics.tokensIssuedTotal.get({ capability: 'cloudflare.api', agent_role: 'coding-agent' }),
    ).toBe(2);
  });
});

describe('CapabilityBrokerMetrics — broker.validate()', () => {
  it('increments tokensRedeemedTotal on successful validation', () => {
    const { metrics } = makeMetrics();
    const broker = makeBroker(metrics);
    const tok = broker.issue({
      name: 'gh.pr.merge',
      scope: 'pr/42',
      agentRole: 'release-bot',
      taskId: 'task-1',
      reason: 'merge pr',
    });
    broker.validate({ token: tok, expectedName: 'gh.pr.merge', expectedScope: 'pr/42' });
    expect(metrics.tokensRedeemedTotal.get({ capability: 'gh.pr.merge' })).toBe(1);
  });

  it('increments tokenValidationErrorsTotal on expired token', () => {
    const { metrics } = makeMetrics();
    const pastClock = { now: () => Date.now() - 999_999 }; // token issued way in the past
    const reg = createDefaultRegistry();
    reg.registerAllowlistEntry({
      name: 'gh.pr.merge',
      agentRole: 'release-bot',
      scopePattern: 'pr/*',
    });
    const broker = new CapabilityBroker({
      registry: reg,
      signingKey: new StaticSigningKeyProvider(BROKER_TESTS_SIGNING_KEY),
      clock: pastClock,
      metrics,
    });
    const tok = broker.issue({
      name: 'gh.pr.merge',
      scope: 'pr/10',
      agentRole: 'release-bot',
      taskId: 'task-exp',
      reason: 'test',
    });
    // Now validate with real (future) clock — token is expired
    const futureBroker = new CapabilityBroker({
      registry: reg,
      signingKey: new StaticSigningKeyProvider(BROKER_TESTS_SIGNING_KEY),
      metrics,
    });
    expect(() =>
      futureBroker.validate({ token: tok, expectedName: 'gh.pr.merge', expectedScope: 'pr/10' }),
    ).toThrow();
    expect(
      metrics.tokenValidationErrorsTotal.get({ capability: 'gh.pr.merge', code: 'expired_token' }),
    ).toBe(1);
  });

  it('increments tokenValidationErrorsTotal on wrong_scope', () => {
    const { metrics } = makeMetrics();
    const broker = makeBroker(metrics);
    const tok = broker.issue({
      name: 'gh.pr.merge',
      scope: 'pr/42',
      agentRole: 'release-bot',
      taskId: 'task-scope',
      reason: 'test',
    });
    expect(() =>
      broker.validate({ token: tok, expectedName: 'gh.pr.merge', expectedScope: 'pr/99' }),
    ).toThrow();
    expect(
      metrics.tokenValidationErrorsTotal.get({ capability: 'gh.pr.merge', code: 'wrong_scope' }),
    ).toBe(1);
  });
});

describe('CapabilityBrokerMetrics — executor.execute()', () => {
  function makeExecutorSetup(metrics?: CapabilityBrokerMetrics) {
    const broker = makeBroker(metrics);
    const ledger = new InMemoryLedger();
    const successHandler: CapabilityHandler = async () => ({ ok: true, data: { done: true } });
    const failHandler: CapabilityHandler = async () => {
      throw new Error('handler-boom');
    };
    const executor = new CapabilityExecutor({
      broker,
      ledger,
      handlers: {
        'cloudflare.api': successHandler,
        'gh.pr.merge': failHandler,
      },
      metrics,
    });
    return { broker, executor };
  }

  it('increments executionsTotal with outcome ok on successful handler', async () => {
    const { metrics } = makeMetrics();
    const { broker, executor } = makeExecutorSetup(metrics);
    const tok = broker.issue({
      name: 'cloudflare.api',
      scope: 'cf/zones/x',
      agentRole: 'coding-agent',
      taskId: 'task-exec',
      reason: 'deploy',
    });
    await executor.execute({ token: tok, payload: { name: 'cloudflare.api', scope: 'cf/zones/x' }, reason: 'deploy' });
    expect(metrics.executionsTotal.get({ capability: 'cloudflare.api', outcome: 'ok' })).toBe(1);
    expect(metrics.executionDurationMs.getCount({ capability: 'cloudflare.api', outcome: 'ok' })).toBe(1);
  });

  it('increments executionsTotal with outcome error on handler throw', async () => {
    const { metrics } = makeMetrics();
    const { broker, executor } = makeExecutorSetup(metrics);
    const tok = broker.issue({
      name: 'gh.pr.merge',
      scope: 'pr/1',
      agentRole: 'release-bot',
      taskId: 'task-err',
      reason: 'merge',
    });
    const result = await executor.execute({ token: tok, payload: { name: 'gh.pr.merge', scope: 'pr/1' }, reason: 'merge' });
    expect(result.ok).toBe(false);
    expect(metrics.executionsTotal.get({ capability: 'gh.pr.merge', outcome: 'error' })).toBe(1);
    expect(metrics.executionDurationMs.getCount({ capability: 'gh.pr.merge', outcome: 'error' })).toBe(1);
  });

  it('increments executionsTotal with outcome rejected on broker validation failure', async () => {
    const { metrics } = makeMetrics();
    const reg = createDefaultRegistry();
    reg.registerAllowlistEntry({
      name: 'cloudflare.api',
      agentRole: 'coding-agent',
      scopePattern: 'cf/zones/*',
    });
    const broker = new CapabilityBroker({
      registry: reg,
      signingKey: new StaticSigningKeyProvider(BROKER_TESTS_SIGNING_KEY),
      metrics,
    });
    const ledger = new InMemoryLedger();
    const executor = new CapabilityExecutor({
      broker,
      ledger,
      handlers: {},
      metrics,
    });
    const tok = broker.issue({
      name: 'cloudflare.api',
      scope: 'cf/zones/y',
      agentRole: 'coding-agent',
      taskId: 'rej-task',
      reason: 'test',
    });
    // Attempt to execute with mismatched scope
    await expect(
      executor.execute({ token: tok, payload: { name: 'cloudflare.api', scope: 'cf/zones/WRONG' }, reason: 'test' }),
    ).rejects.toThrow();
    expect(metrics.executionsTotal.get({ capability: 'cloudflare.api', outcome: 'rejected' })).toBe(1);
  });

  it('increments executionsTotal with outcome no_handler when handler missing', async () => {
    const { metrics } = makeMetrics();
    const broker = makeBroker(metrics);
    const ledger = new InMemoryLedger();
    const executor = new CapabilityExecutor({ broker, ledger, handlers: {}, metrics });
    const tok = broker.issue({
      name: 'cloudflare.api',
      scope: 'cf/zones/noh',
      agentRole: 'coding-agent',
      taskId: 'task-noh',
      reason: 'test',
    });
    const result = await executor.execute({
      token: tok,
      payload: { name: 'cloudflare.api', scope: 'cf/zones/noh' },
      reason: 'test',
    });
    expect(result.ok).toBe(false);
    expect(metrics.executionsTotal.get({ capability: 'cloudflare.api', outcome: 'no_handler' })).toBe(1);
  });
});

describe('CapabilityBrokerMetrics — bindDelay()', () => {
  it('increments delayPendingGauge when delay begins and decrements when committed', async () => {
    const { metrics } = makeMetrics();
    const delay = new IrreversibleDelay({ defaultDelayMs: 0 });
    metrics.bindDelay(delay);

    const broker = makeBroker();
    const tok = broker.issue({
      name: 'cloudflare.api',
      scope: 'cf/zones/bind',
      agentRole: 'coding-agent',
      taskId: 't-delay',
      reason: 'test',
    });

    expect(metrics.delayPendingGauge.get()).toBe(0);
    const p = delay.begin({ token: tok, reason: 'test', delayMs: 0 });
    expect(metrics.delayPendingGauge.get()).toBe(1);
    await p;
    expect(metrics.delayPendingGauge.get()).toBe(0);
  });

  it('increments delayCancellationsTotal and decrements gauge on cancel', () => {
    const { metrics } = makeMetrics();
    const delay = new IrreversibleDelay({ defaultDelayMs: 60_000 });
    metrics.bindDelay(delay);

    const broker = makeBroker();
    const tok = broker.issue({
      name: 'cloudflare.api',
      scope: 'cf/zones/cancel',
      agentRole: 'coding-agent',
      taskId: 't-cancel',
      reason: 'test',
    });

    delay.begin({ token: tok, reason: 'test' }); // starts the window

    expect(metrics.delayPendingGauge.get()).toBe(1);
    delay.cancel({
      tokenId: tok.tokenId,
      by: 'operator',
      capabilityName: tok.name,
      scope: tok.scope,
      taskId: tok.taskId,
      reason: 'abort',
    });
    expect(metrics.delayPendingGauge.get()).toBe(0);
    expect(metrics.delayCancellationsTotal.get({ capability: 'cloudflare.api' })).toBe(1);
  });
});
