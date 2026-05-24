import { describe, expect, it } from 'vitest';

import { InMemoryFsAdapter } from '@caia/ea-architect';

import { DedupChecker, EaResearchConductor, StubDispatcher, slugify } from '../src/index.js';

describe('slugify', () => {
  it('produces a slug', () => {
    expect(slugify('Hello World! 2026')).toBe('hello-world-2026');
  });
});

describe('DedupChecker', () => {
  it('returns no duplicate when repo is empty', () => {
    const fs = new InMemoryFsAdapter({});
    const dedup = new DedupChecker('/tmp/caia-ea', fs);
    const result = dedup.check('any topic');
    expect(result.isDuplicate).toBe(false);
  });

  it('finds a duplicate by token overlap', () => {
    const fs = new InMemoryFsAdapter({
      '/tmp/caia-ea/decisions/ADR-001-event-bus-design.md': '# ADR-001'
    });
    const dedup = new DedupChecker('/tmp/caia-ea', fs);
    const result = dedup.check('event bus design');
    expect(result.isDuplicate).toBe(true);
  });
});

describe('EaResearchConductor', () => {
  it('skips dispatch when topic is a duplicate', async () => {
    const fs = new InMemoryFsAdapter({
      '/tmp/caia-ea/decisions/ADR-001-event-bus-design.md': '# ADR-001'
    });
    const stub = new StubDispatcher();
    const c = new EaResearchConductor({
      repositoryPath: '/tmp/caia-ea',
      fs,
      dispatcher: stub
    });
    const result = await c.request({
      topic: 'event bus design',
      brief: 'explore alternatives',
      requesterAgentId: 'tests'
    });
    expect(result.dispatched).toBe(false);
    expect(stub.dispatches.length).toBe(0);
  });

  it('dispatches when topic is novel', async () => {
    const fs = new InMemoryFsAdapter({});
    const stub = new StubDispatcher();
    const c = new EaResearchConductor({
      repositoryPath: '/tmp/caia-ea',
      fs,
      dispatcher: stub
    });
    const result = await c.request({
      topic: 'novel topic xyz',
      brief: 'explore',
      requesterAgentId: 'tests'
    });
    expect(result.dispatched).toBe(true);
    expect(stub.dispatches.length).toBe(1);
  });
});
