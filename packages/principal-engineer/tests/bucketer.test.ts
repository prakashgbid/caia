import { describe, expect, it } from 'vitest';

import {
  bucketTickets,
  DEFAULT_PER_WAVE_CAP,
  resolvePerWaveCap,
} from '../src/bucketer.js';
import { TIER_CAPS } from '../src/types.js';
import { mk } from './test-helpers.js';

describe('resolvePerWaveCap', () => {
  it('returns the tier cap when no override is set', () => {
    expect(resolvePerWaveCap('free')).toBe(TIER_CAPS.free);
    expect(resolvePerWaveCap('pro')).toBe(TIER_CAPS.pro);
    expect(resolvePerWaveCap('enterprise')).toBe(TIER_CAPS.enterprise);
  });

  it('clamps the override down to the tier cap', () => {
    expect(resolvePerWaveCap('free', 50)).toBe(TIER_CAPS.free);
    expect(resolvePerWaveCap('pro', 50)).toBe(TIER_CAPS.pro);
  });

  it('honours a lower override under the tier cap', () => {
    expect(resolvePerWaveCap('pro', 2)).toBe(2);
    expect(resolvePerWaveCap('enterprise', 4)).toBe(4);
  });

  it('floors fractional overrides', () => {
    expect(resolvePerWaveCap('enterprise', 7.7)).toBe(7);
  });

  it('treats override < 1 as 1', () => {
    expect(resolvePerWaveCap('pro', 0)).toBe(1);
    expect(resolvePerWaveCap('pro', -3)).toBe(1);
  });
});

describe('bucketTickets', () => {
  it('returns an empty plan for empty input', () => {
    const plan = bucketTickets({ tickets: [], tenantTier: 'pro' });
    expect(plan.buckets).toEqual([]);
    expect(plan.waveCount).toBe(0);
    expect(plan.perWaveCap).toBe(TIER_CAPS.pro);
  });

  it('produces a single parallel bucket for independent tickets', () => {
    const plan = bucketTickets({
      tickets: [mk('A'), mk('B'), mk('C')],
      tenantTier: 'pro',
    });
    expect(plan.buckets).toHaveLength(1);
    expect(plan.buckets[0]?.assignment.kind).toBe('parallel-bucket');
    expect(plan.buckets[0]?.ticketIds).toEqual(['A', 'B', 'C']);
    expect(plan.waveCount).toBe(1);
  });

  it('shards across multiple parallel-bucket-N when exceeding the cap', () => {
    const tickets = Array.from({ length: 12 }, (_, i) => mk(`T${i}`));
    const plan = bucketTickets({ tickets, tenantTier: 'free' }); // cap=2
    expect(plan.buckets.length).toBe(6);
    for (const b of plan.buckets) expect(b.ticketIds.length).toBeLessThanOrEqual(2);
    const allTickets = plan.buckets.flatMap((b) => b.ticketIds);
    expect(allTickets.sort()).toEqual(tickets.map((t) => t.ticketId).sort());
  });

  it('produces sequential waves for a dep chain', () => {
    const plan = bucketTickets({
      tickets: [mk('A'), mk('B', ['A']), mk('C', ['B'])],
      tenantTier: 'pro',
    });
    expect(plan.waveCount).toBe(3);
    const byWave = new Map<number, string[]>();
    for (const b of plan.buckets) byWave.set(b.waveIndex, b.ticketIds.slice());
    expect(byWave.get(0)).toEqual(['A']);
    expect(byWave.get(1)).toEqual(['B']);
    expect(byWave.get(2)).toEqual(['C']);
  });

  it('pushes resource-locked conflicts to sequential-after', () => {
    const plan = bucketTickets({
      tickets: [
        mk('A', [], { resourceLocks: ['db'] }),
        mk('B', [], { resourceLocks: ['db'] }),
      ],
      tenantTier: 'pro',
    });
    const parallel = plan.buckets.filter((b) => b.assignment.kind === 'parallel-bucket');
    const seq = plan.buckets.filter((b) => b.assignment.kind === 'sequential-after');
    expect(parallel).toHaveLength(1);
    expect(parallel[0]?.ticketIds).toEqual(['A']);
    expect(seq).toHaveLength(1);
    expect(seq[0]?.ticketIds).toEqual(['B']);
    expect(seq[0]?.waveIndex).toBe(1);
  });

  it('produces deterministic bucket ids across runs', () => {
    const tickets = [mk('A'), mk('B', ['A']), mk('C', ['A'])];
    const a = bucketTickets({ tickets, tenantTier: 'pro' });
    const b = bucketTickets({ tickets, tenantTier: 'pro' });
    expect(a.buckets.map((x) => x.bucketId)).toEqual(b.buckets.map((x) => x.bucketId));
  });

  it('emits a default-cap value of DEFAULT_PER_WAVE_CAP for "pro"', () => {
    expect(DEFAULT_PER_WAVE_CAP).toBe(5);
    const plan = bucketTickets({ tickets: [mk('A')], tenantTier: 'pro' });
    expect(plan.perWaveCap).toBe(5);
  });

  it('orders buckets by waveIndex then bucketId', () => {
    const plan = bucketTickets({
      tickets: [
        mk('A'),
        mk('B'),
        mk('C', ['A']),
      ],
      tenantTier: 'pro',
    });
    let prevWave = -1;
    for (const b of plan.buckets) {
      expect(b.waveIndex).toBeGreaterThanOrEqual(prevWave);
      prevWave = b.waveIndex;
    }
  });

  it('handles a fully-conflicting set (everyone holds the same lock)', () => {
    const plan = bucketTickets({
      tickets: [
        mk('A', [], { resourceLocks: ['x'] }),
        mk('B', [], { resourceLocks: ['x'] }),
        mk('C', [], { resourceLocks: ['x'] }),
      ],
      tenantTier: 'enterprise',
    });
    // A goes in parallel, B sequential in wave 1, C sequential in wave 2
    expect(plan.waveCount).toBeGreaterThanOrEqual(3);
  });

  it('honours the EA modifier #3 — falls back to defaults when no SPS YAML is supplied', () => {
    const plan = bucketTickets({
      tickets: [mk('A'), mk('B')],
      tenantTier: 'pro',
    });
    expect(plan.buckets).toHaveLength(1);
    expect(plan.perWaveCap).toBe(TIER_CAPS.pro);
  });
});
