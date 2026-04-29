/**
 * PipelineCostTracker — HARDEN-002 unit tests.
 *
 * Exercises:
 *   1. recordCall inserts a fresh row with started_at and per-agent breakdown.
 *   2. recordCall updates an existing row (counters, breakdown, last_updated_at).
 *   3. Threshold trip emits pipeline.cost.alert exactly once.
 *   4. recent() returns runs sorted by lastUpdatedAt desc.
 *   5. get() returns null for unknown correlationId.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { eventBus } from '../../src/events/bus-adapter';
import { PipelineCostTracker, __resetPipelineCostTracker } from '../../src/agents/pipeline-cost-tracker';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function setup(now = () => 1000) {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, sqlite, now };
}

beforeEach(() => __resetPipelineCostTracker());

describe('PipelineCostTracker.recordCall', () => {
  it('inserts a fresh row with started_at and per-agent breakdown', () => {
    let t = 1000;
    const { db } = setup();
    const tracker = new PipelineCostTracker(db, { silent: true, now: () => t });
    const snap = tracker.recordCall({
      correlationId: 'corr_a',
      agent: 'po-agent',
      provider: 'claude',
      estimatedCostUsd: 0.5,
      baselineCostUsd: 0.5,
    });
    expect(snap.totalCalls).toBe(1);
    expect(snap.claudeCalls).toBe(1);
    expect(snap.totalCostUsd).toBe(0.5);
    expect(snap.startedAt).toBe(1000);
    expect(snap.perAgent['po-agent']).toEqual({ calls: 1, costUsd: 0.5, baselineUsd: 0.5 });
    expect(snap.alertTriggeredAt).toBeNull();
  });

  it('updates the existing row across calls + agents + providers', () => {
    let t = 1000;
    const { db } = setup();
    const tracker = new PipelineCostTracker(db, { silent: true, now: () => t });
    tracker.recordCall({
      correlationId: 'corr_b',
      agent: 'po-agent',
      provider: 'claude',
      estimatedCostUsd: 0.4,
      baselineCostUsd: 0.4,
    });
    t = 2000;
    const snap = tracker.recordCall({
      correlationId: 'corr_b',
      agent: 'ba-agent',
      provider: 'local',
      estimatedCostUsd: 0,
      baselineCostUsd: 0.3,
    });
    expect(snap.totalCalls).toBe(2);
    expect(snap.localCalls).toBe(1);
    expect(snap.claudeCalls).toBe(1);
    expect(snap.totalCostUsd).toBe(0.4);
    expect(snap.baselineCostUsd).toBe(0.7);
    expect(snap.savedUsd).toBe(0.3);
    expect(snap.startedAt).toBe(1000);   // preserved on update
    expect(snap.lastUpdatedAt).toBe(2000);
    expect(snap.perAgent['po-agent']).toEqual({ calls: 1, costUsd: 0.4, baselineUsd: 0.4 });
    expect(snap.perAgent['ba-agent']).toEqual({ calls: 1, costUsd: 0, baselineUsd: 0.3 });
  });

  it('threshold trip emits pipeline.cost.alert exactly once', () => {
    let t = 1000;
    const { db } = setup();
    const tracker = new PipelineCostTracker(db, { alertThresholdUsd: 1, silent: false, now: () => t });
    const events: Array<{ type: string }> = [];
    const off = eventBus.subscribe('pipeline.cost.alert', (ev) => events.push(ev));
    try {
      tracker.recordCall({
        correlationId: 'corr_c',
        agent: 'po-agent',
        provider: 'claude',
        estimatedCostUsd: 0.4,
        baselineCostUsd: 0.4,
      });
      expect(events).toHaveLength(0);
      t = 2000;
      const snap2 = tracker.recordCall({
        correlationId: 'corr_c',
        agent: 'ba-agent',
        provider: 'claude',
        estimatedCostUsd: 0.7,
        baselineCostUsd: 0.7,
      });
      expect(snap2.alertTriggeredAt).toBe(2000);
      expect(events).toHaveLength(1);
      // Third call still over threshold — must NOT re-emit.
      t = 3000;
      const snap3 = tracker.recordCall({
        correlationId: 'corr_c',
        agent: 'ea-agent',
        provider: 'claude',
        estimatedCostUsd: 0.5,
        baselineCostUsd: 0.5,
      });
      expect(snap3.alertTriggeredAt).toBe(2000);
      expect(events).toHaveLength(1);
    } finally {
      off();
    }
  });

  it('recent() returns the N latest runs sorted desc by lastUpdatedAt', () => {
    let t = 1000;
    const { db } = setup();
    const tracker = new PipelineCostTracker(db, { silent: true, now: () => t });
    tracker.recordCall({ correlationId: 'corr_old', agent: 'a', provider: 'local', estimatedCostUsd: 0, baselineCostUsd: 0.1 });
    t = 2000;
    tracker.recordCall({ correlationId: 'corr_mid', agent: 'a', provider: 'local', estimatedCostUsd: 0, baselineCostUsd: 0.1 });
    t = 3000;
    tracker.recordCall({ correlationId: 'corr_new', agent: 'a', provider: 'local', estimatedCostUsd: 0, baselineCostUsd: 0.1 });
    const recent = tracker.recent();
    expect(recent.map((r) => r.correlationId)).toEqual(['corr_new', 'corr_mid', 'corr_old']);
  });

  it('get() returns null for unknown correlationId', () => {
    const { db } = setup();
    const tracker = new PipelineCostTracker(db, { silent: true });
    expect(tracker.get('corr_ghost')).toBeNull();
  });
});
