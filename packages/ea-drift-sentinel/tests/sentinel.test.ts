import { describe, expect, it } from 'vitest';

import { InMemoryFsAdapter } from '@caia/ea-architect';

import {
  DEFAULT_PRINCIPLE_RULES,
  EaDriftSentinel,
  StubTier2Adapter,
  Tier1Detector,
  type BusEvent
} from '../src/index.js';

const baseEvent: BusEvent = {
  type: 'deploy.cost-incurred',
  payload: { cost: 5.5 },
  at: '2026-05-24T00:00:00.000Z'
};

describe('Tier1Detector', () => {
  it('detects P2 cost-incurred violation', () => {
    const det = new Tier1Detector(DEFAULT_PRINCIPLE_RULES);
    const hits = det.detect(baseEvent, '2026-05-24T00:00:01.000Z');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.find((h) => h.principleId === 'P2')).toBeDefined();
  });

  it('detects API-key reference (P14)', () => {
    const det = new Tier1Detector(DEFAULT_PRINCIPLE_RULES);
    const evt: BusEvent = {
      type: 'llm.call',
      payload: { config: 'sk-12345' },
      at: '2026-05-24T00:00:00.000Z'
    };
    const hits = det.detect(evt, '2026-05-24T00:00:01.000Z');
    const hit = hits.find((h) => h.principleId === 'P14');
    expect(hit).toBeDefined();
  });
});

describe('EaDriftSentinel.process', () => {
  it('confirms tier-1 hits via stub tier-2 + appends to drift log', async () => {
    const fs = new InMemoryFsAdapter({});
    const sentinel = new EaDriftSentinel({
      fs,
      driftLogDir: '/tmp/drift',
      tier2: new StubTier2Adapter({
        confirmed: true,
        reasoning: 'stub confirms',
        escalate: false
      })
    });
    const result = await sentinel.process(baseEvent);
    expect(result.confirmed.length).toBeGreaterThan(0);
    const logs = Object.keys(fs.snapshot()).filter((p) => p.startsWith('/tmp/drift/'));
    expect(logs.length).toBeGreaterThan(0);
  });

  it('escalates to INBOX when tier-2 says escalate', async () => {
    const fs = new InMemoryFsAdapter({});
    const sentinel = new EaDriftSentinel({
      fs,
      driftLogDir: '/tmp/drift',
      tier2: new StubTier2Adapter({
        confirmed: true,
        reasoning: 'stub confirms with escalation',
        escalate: true
      })
    });
    const result = await sentinel.process(baseEvent);
    expect(result.escalated).toBeGreaterThan(0);
  });
});
