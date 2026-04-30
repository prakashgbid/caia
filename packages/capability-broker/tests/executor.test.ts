/**
 * Executor — handler dispatch + ledger persistence.
 */

import { describe, it, expect } from 'vitest';
import { EXECUTOR_TESTS_SIGNING_KEY } from './__fixtures__/signing-keys.js';
import {
  CapabilityBroker,
  CapabilityExecutor,
  CapabilityRegistry,
  InMemoryLedger,
  StaticSigningKeyProvider,
  createDefaultRegistry,
  type CapabilityHandler,
} from '../src/index.js';

function setup(): {
  broker: CapabilityBroker;
  executor: CapabilityExecutor;
  ledger: InMemoryLedger;
  successHandler: CapabilityHandler;
  failHandler: CapabilityHandler;
} {
  const reg: CapabilityRegistry = createDefaultRegistry();
  reg.registerAllowlistEntry({
    name: 'cloudflare.pages.deploy.preview',
    agentRole: 'coding-agent',
    scopePattern: 'cf-pages/pokerzeno-preview',
    maxPerTask: 5,
  });
  reg.registerAllowlistEntry({
    name: 'cloudflare.pages.deploy.production',
    agentRole: 'release-bot',
    scopePattern: 'cf-pages/pokerzeno',
    maxPerTask: 1,
  });
  const broker = new CapabilityBroker({
    registry: reg,
    signingKey: new StaticSigningKeyProvider(
      EXECUTOR_TESTS_SIGNING_KEY,
    ),
  });
  const ledger = new InMemoryLedger();

  const successHandler: CapabilityHandler = async () => ({
    ok: true,
    data: { ok: 'yes' },
    undoToken: 'rollback-id-123',
  });
  const failHandler: CapabilityHandler = async () => {
    throw new Error('cf api unreachable');
  };

  const executor = new CapabilityExecutor({
    broker,
    ledger,
    handlers: {
      'cloudflare.pages.deploy.preview': successHandler,
      'cloudflare.pages.deploy.production': failHandler,
    },
  });
  return { broker, executor, ledger, successHandler, failHandler };
}

describe('CapabilityExecutor', () => {
  it('runs the handler and records success to the ledger', async () => {
    const { broker, executor, ledger } = setup();
    const tok = broker.issue({
      name: 'cloudflare.pages.deploy.preview',
      scope: 'cf-pages/pokerzeno-preview',
      agentRole: 'coding-agent',
      taskId: 't-cf-1',
      reason: 'deploy preview for PR #42',
    });
    const result = await executor.execute({
      token: tok,
      payload: {
        name: 'cloudflare.pages.deploy.preview',
        scope: 'cf-pages/pokerzeno-preview',
        args: { sha: 'abc123' },
      },
      reason: 'deploy preview for PR #42',
    });
    expect(result.ok).toBe(true);
    expect(result.undoToken).toBe('rollback-id-123');
    const entries = await ledger.byTaskId('t-cf-1');
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.capabilityName).toBe('cloudflare.pages.deploy.preview');
    expect(entry.undoToken).toBe('rollback-id-123');
    expect(entry.scope).toBe('cf-pages/pokerzeno-preview');
  });

  it('records failures to the ledger too (append-only invariant)', async () => {
    const { broker, executor, ledger } = setup();
    const tok = broker.issue({
      name: 'cloudflare.pages.deploy.production',
      scope: 'cf-pages/pokerzeno',
      agentRole: 'release-bot',
      taskId: 't-cf-prod',
      reason: 'promote build',
    });
    const result = await executor.execute({
      token: tok,
      payload: {
        name: 'cloudflare.pages.deploy.production',
        scope: 'cf-pages/pokerzeno',
        args: {},
      },
      reason: 'promote build',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('cf api unreachable');
    const entries = await ledger.byTaskId('t-cf-prod');
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    const parsed = JSON.parse(entry.resultJson);
    expect(parsed.ok).toBe(false);
  });

  it('refuses to execute when no handler is registered', async () => {
    const { broker, ledger } = setup();
    const exec = new CapabilityExecutor({ broker, ledger, handlers: {} });
    const tok = broker.issue({
      name: 'cloudflare.pages.deploy.preview',
      scope: 'cf-pages/pokerzeno-preview',
      agentRole: 'coding-agent',
      taskId: 't-no-handler',
      reason: 'r',
    });
    const result = await exec.execute({
      token: tok,
      payload: {
        name: 'cloudflare.pages.deploy.preview',
        scope: 'cf-pages/pokerzeno-preview',
        args: {},
      },
      reason: 'r',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no handler/);
    // Even with no handler, the rejection is recorded.
    expect(ledger.size).toBe(1);
  });

  it('rejects a payload whose name does not match the token', async () => {
    const { broker, executor } = setup();
    const tok = broker.issue({
      name: 'cloudflare.pages.deploy.preview',
      scope: 'cf-pages/pokerzeno-preview',
      agentRole: 'coding-agent',
      taskId: 't-mismatch',
      reason: 'r',
    });
    await expect(
      executor.execute({
        token: tok,
        payload: {
          name: 'cloudflare.pages.deploy.production', // mismatched
          scope: 'cf-pages/pokerzeno-preview',
          args: {},
        },
        reason: 'r',
      }),
    ).rejects.toThrow(/wrong_capability/);
  });

  it('rejects an expired token at execute time', async () => {
    let now = 1_000_000;
    const reg = createDefaultRegistry();
    reg.registerAllowlistEntry({
      name: 'cloudflare.pages.deploy.preview',
      agentRole: 'coding-agent',
      scopePattern: 'cf-pages/*',
    });
    const broker = new CapabilityBroker({
      registry: reg,
      signingKey: new StaticSigningKeyProvider(
        EXECUTOR_TESTS_SIGNING_KEY,
      ),
      clock: { now: () => now },
    });
    const ledger = new InMemoryLedger();
    const handler: CapabilityHandler = async () => ({ ok: true });
    const exec = new CapabilityExecutor({
      broker,
      ledger,
      handlers: { 'cloudflare.pages.deploy.preview': handler },
      clockMs: () => now,
    });
    const tok = broker.issue({
      name: 'cloudflare.pages.deploy.preview',
      scope: 'cf-pages/x',
      agentRole: 'coding-agent',
      taskId: 't',
      reason: 'r',
    });
    now += 6 * 60 * 1000;
    await expect(
      exec.execute({
        token: tok,
        payload: {
          name: 'cloudflare.pages.deploy.preview',
          scope: 'cf-pages/x',
          args: {},
        },
        reason: 'r',
      }),
    ).rejects.toThrow(/expired_token/);
  });

  it('persists undoToken so operators can roll back', async () => {
    const { broker, executor, ledger } = setup();
    const tok = broker.issue({
      name: 'cloudflare.pages.deploy.preview',
      scope: 'cf-pages/pokerzeno-preview',
      agentRole: 'coding-agent',
      taskId: 't-undo',
      reason: 'r',
    });
    await executor.execute({
      token: tok,
      payload: {
        name: 'cloudflare.pages.deploy.preview',
        scope: 'cf-pages/pokerzeno-preview',
        args: {},
      },
      reason: 'r',
    });
    const recent = await ledger.recent(10);
    expect(recent[0]!.undoToken).toBe('rollback-id-123');
  });

  it('byId surfaces a single entry for follow-up queries', async () => {
    const { broker, executor, ledger } = setup();
    const tok = broker.issue({
      name: 'cloudflare.pages.deploy.preview',
      scope: 'cf-pages/pokerzeno-preview',
      agentRole: 'coding-agent',
      taskId: 't-byid',
      reason: 'r',
    });
    await executor.execute({
      token: tok,
      payload: {
        name: 'cloudflare.pages.deploy.preview',
        scope: 'cf-pages/pokerzeno-preview',
        args: {},
      },
      reason: 'r',
    });
    const all = await ledger.recent(10);
    const id = all[0]!.id;
    const found = await ledger.byId(id);
    expect(found?.id).toBe(id);
  });
});
