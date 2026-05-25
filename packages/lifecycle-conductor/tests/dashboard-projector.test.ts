import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { LifecycleAggregator } from '../src/aggregator.js';
import { LifecycleConductorApi } from '../src/api.js';
import {
  createSseFanout,
  projectToSse,
} from '../src/dashboard-projector.js';
import type { CompositeStateChangedEvent, StewardAttestation, StewardName } from '../src/types.js';

const T0 = new Date('2026-05-25T12:00:00Z');

function att(
  steward: StewardName,
  status: 'green' | 'amber' | 'red',
  solutionId = 'sln-A',
  observedAt: Date = T0,
): StewardAttestation {
  return { steward, status, solutionId, observedAt: observedAt.toISOString() };
}

class MockResponse extends EventEmitter {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public writes: string[] = [];
  public ended = false;
  setHeader(k: string, v: string): void {
    this.headers[k] = v;
  }
  flushHeaders(): void {
    /* no-op */
  }
  write(s: string): boolean {
    if (this.ended) return false;
    this.writes.push(s);
    return true;
  }
  end(): void {
    this.ended = true;
    this.emit('close');
  }
}

class MockRequest extends EventEmitter {}

describe('createSseFanout', () => {
  it('routes emitted events to subscribed handlers', () => {
    const fanout = createSseFanout();
    const seen: CompositeStateChangedEvent[] = [];
    const unsub = fanout.onChange((e) => seen.push(e));
    const event: CompositeStateChangedEvent = {
      solutionId: 'x',
      fromState: 'plan-approved',
      toState: 'deployed',
      trigger: 't',
      rowsSnapshot: {
        deploy: null, usage: null, activation: null, outcome: null,
      },
      at: T0.toISOString(),
    };
    fanout.emit(event);
    expect(seen).toEqual([event]);
    unsub();
    fanout.emit(event);
    expect(seen).toHaveLength(1);
  });

  it('swallows handler errors so one bad subscriber does not block others', () => {
    const fanout = createSseFanout();
    let secondCalled = false;
    fanout.onChange(() => {
      throw new Error('boom');
    });
    fanout.onChange(() => {
      secondCalled = true;
    });
    fanout.emit({
      solutionId: 'x', fromState: 'plan-approved', toState: 'deployed', trigger: 't',
      rowsSnapshot: { deploy: null, usage: null, activation: null, outcome: null },
      at: T0.toISOString(),
    });
    expect(secondCalled).toBe(true);
  });
});

describe('projectToSse', () => {
  it('writes a snapshot frame for a known solution then a composite frame on change', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green'));
    const api = new LifecycleConductorApi(agg);
    const fanout = createSseFanout();
    const req = new MockRequest();
    const res = new MockResponse();
    await projectToSse(api, fanout, req as unknown as never, res as unknown as never, {
      solutionId: 'sln-A',
      keepaliveMs: 60_000,
    });
    const joined = res.writes.join('');
    expect(joined).toContain('event: snapshot');
    expect(joined).toContain('sln-A');

    // Emit a composite-state change.
    fanout.emit({
      solutionId: 'sln-A',
      fromState: 'deployed',
      toState: 'built-into-active-app',
      trigger: 'forward',
      rowsSnapshot: {
        deploy: null, usage: null, activation: null, outcome: null,
      },
      at: T0.toISOString(),
    });
    const after = res.writes.join('');
    expect(after).toContain('event: composite');
    expect(after).toContain('built-into-active-app');
  });

  it('writes an error frame when the solution is not found', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    const api = new LifecycleConductorApi(agg);
    const fanout = createSseFanout();
    const req = new MockRequest();
    const res = new MockResponse();
    await projectToSse(api, fanout, req as unknown as never, res as unknown as never, {
      solutionId: 'does-not-exist',
      keepaliveMs: 60_000,
    });
    expect(res.writes.join('')).toContain('solution-not-found');
    expect(res.ended).toBe(true);
  });

  it('subscribes to ALL changes when no solutionId filter is provided', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green', 'sln-A'));
    const api = new LifecycleConductorApi(agg);
    const fanout = createSseFanout();
    const req = new MockRequest();
    const res = new MockResponse();
    await projectToSse(api, fanout, req as unknown as never, res as unknown as never, {
      keepaliveMs: 60_000,
    });
    expect(res.writes.join('')).toContain('event: snapshot');
    // Now emit a change for a different solution — it should appear.
    fanout.emit({
      solutionId: 'sln-B',
      fromState: 'plan-approved',
      toState: 'deployed',
      trigger: 'forward',
      rowsSnapshot: {
        deploy: null, usage: null, activation: null, outcome: null,
      },
      at: T0.toISOString(),
    });
    expect(res.writes.join('')).toContain('sln-B');
  });

  it('unsubscribes on client close', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green', 'sln-A'));
    const api = new LifecycleConductorApi(agg);
    const fanout = createSseFanout();
    const req = new MockRequest();
    const res = new MockResponse();
    await projectToSse(api, fanout, req as unknown as never, res as unknown as never, {
      solutionId: 'sln-A',
      keepaliveMs: 60_000,
    });
    res.writes.length = 0; // clear snapshot writes
    req.emit('close');
    fanout.emit({
      solutionId: 'sln-A',
      fromState: 'deployed',
      toState: 'built-into-active-app',
      trigger: 'forward',
      rowsSnapshot: {
        deploy: null, usage: null, activation: null, outcome: null,
      },
      at: T0.toISOString(),
    });
    // After close, no further frames should be written.
    expect(res.writes.join('')).not.toContain('built-into-active-app');
  });
});
