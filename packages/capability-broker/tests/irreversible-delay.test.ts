/**
 * Irreversible-action delay (v2 §3.7).
 */

import { describe, it, expect, vi } from 'vitest';
import { IrreversibleDelay, type CapabilityToken } from '../src/index.js';

function fakeToken(): CapabilityToken {
  return {
    tokenId: 'a'.repeat(32),
    name: 'cloudflare.pages.deploy.production',
    scope: 'cf-pages/pokerzeno',
    agentRole: 'release-bot',
    taskId: 't',
    issuedAt: 1000,
    expiresAt: 1000 + 5 * 60 * 1000,
    signature: '00',
    singleUse: true,
  };
}

describe('IrreversibleDelay', () => {
  it('emits pending then committed when the delay elapses', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const d = new IrreversibleDelay({ defaultDelayMs: 5_000 });
    d.on((ev) => events.push(ev.kind));
    const promise = d.begin({ token: fakeToken(), reason: 'r' });
    expect(events).toEqual(['pending']);
    vi.advanceTimersByTime(5_000);
    const result = await promise;
    expect(result.cancelled).toBe(false);
    expect(events).toEqual(['pending', 'committed']);
    vi.useRealTimers();
  });

  it('emits pending then cancelled when cancel() races the delay', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const d = new IrreversibleDelay({ defaultDelayMs: 5_000 });
    d.on((ev) => events.push(ev.kind));
    const tok = fakeToken();
    const promise = d.begin({ token: tok, reason: 'r' });
    vi.advanceTimersByTime(2_000);
    expect(
      d.cancel({
        tokenId: tok.tokenId,
        by: 'operator',
        capabilityName: tok.name,
        scope: tok.scope,
        taskId: tok.taskId,
        reason: 'oops',
      }),
    ).toBe(true);
    const result = await promise;
    expect(result.cancelled).toBe(true);
    expect(events).toEqual(['pending', 'cancelled']);
    vi.useRealTimers();
  });

  it('returns false from cancel() when the window is already closed', async () => {
    const d = new IrreversibleDelay({ defaultDelayMs: 1 });
    const tok = fakeToken();
    await d.begin({ token: tok, reason: 'r' });
    expect(
      d.cancel({
        tokenId: tok.tokenId,
        by: 'operator',
        capabilityName: tok.name,
        scope: tok.scope,
        taskId: tok.taskId,
        reason: 'late',
      }),
    ).toBe(false);
  });

  it('throws when starting two concurrent windows for the same token', () => {
    vi.useFakeTimers();
    const d = new IrreversibleDelay({ defaultDelayMs: 5_000 });
    const tok = fakeToken();
    void d.begin({ token: tok, reason: 'r' });
    expect(() => d.begin({ token: tok, reason: 'r' })).toThrow(/already has/);
    vi.useRealTimers();
  });

  it('respects per-call delayMs overrides', async () => {
    vi.useFakeTimers();
    const d = new IrreversibleDelay({ defaultDelayMs: 5_000 });
    const promise = d.begin({ token: fakeToken(), reason: 'r', delayMs: 1_000 });
    vi.advanceTimersByTime(1_000);
    const r = await promise;
    expect(r.cancelled).toBe(false);
    vi.useRealTimers();
  });

  it('listener errors do not break the delay machinery', async () => {
    vi.useFakeTimers();
    const d = new IrreversibleDelay({ defaultDelayMs: 100 });
    d.on(() => {
      throw new Error('listener boom');
    });
    const promise = d.begin({ token: fakeToken(), reason: 'r' });
    vi.advanceTimersByTime(100);
    await expect(promise).resolves.toEqual({ cancelled: false });
    vi.useRealTimers();
  });
});
