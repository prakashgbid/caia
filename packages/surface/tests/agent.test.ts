import { describe, it, expect } from 'vitest';

import { SurfaceAgent, parseSince } from '../src/agent.js';
import type { Connector, ConnectorResult, Finding, FindingSource } from '../src/types.js';
import { FakeFs } from './__fixtures__/fs.js';
import { FakeGh, FakeGit } from './__fixtures__/runners.js';

const FIXED_NOW = new Date('2026-05-09T12:00:00.000Z');

function constantClock(d = FIXED_NOW): () => Date {
  return () => d;
}

function findingFx(over: Partial<Finding> & { source: FindingSource }): Finding {
  return {
    id: 'fx',
    kind: 'memory-updated',
    key: 'k',
    title: 't',
    tsIso: '2026-05-09T01:00:00.000Z',
    importance: 0,
    tags: [],
    ...over
  };
}

function fakeConnector(source: FindingSource, findings: Finding[], warnings: string[] = []): Connector {
  return {
    source,
    async collect(args): Promise<ConnectorResult> {
      return {
        source,
        findings,
        collectedAtIso: args.untilIso,
        warnings
      };
    }
  };
}

describe('parseSince', () => {
  it('parses "1 day ago"', () => {
    const d = parseSince('1 day ago', FIXED_NOW);
    expect(d).not.toBeNull();
    expect(d?.toISOString()).toBe('2026-05-08T12:00:00.000Z');
  });
  it('parses "3 hours ago"', () => {
    const d = parseSince('3 hours ago', FIXED_NOW);
    expect(d?.toISOString()).toBe('2026-05-09T09:00:00.000Z');
  });
  it('parses ISO8601', () => {
    const d = parseSince('2026-05-01T00:00:00.000Z', FIXED_NOW);
    expect(d?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
  it('rejects gibberish', () => {
    expect(parseSince('something invalid', FIXED_NOW)).toBeNull();
  });
});

describe('SurfaceAgent', () => {
  it('runs end-to-end with injected connectors and produces a digest', async () => {
    const findings = [
      findingFx({ source: 'pr', kind: 'pr-merged', title: 'PR #400 merged: feature x', tsIso: '2026-05-09T03:00:00.000Z' }),
      findingFx({ source: 'memory', kind: 'memory-added', title: 'feedback_x.md added', tags: ['feedback'], tsIso: '2026-05-09T04:00:00.000Z' })
    ];
    const agent = new SurfaceAgent({
      maxBytes: 50_000,
      minImportance: 0.0,
      clock: constantClock(),
      connectors: [
        fakeConnector('pr', [findings[0]!]),
        fakeConnector('memory', [findings[1]!])
      ]
    });
    const d = await agent.generateDigest({ since: '1 day ago' });
    expect(d.findings.length).toBeGreaterThanOrEqual(2);
    expect(d.markdown).toContain('Surface Digest');
    expect(d.markdown).toContain('PR #400');
    expect(d.markdown).toContain('feedback_x.md');
  });

  it('throws when exceeding maxBytes (importance not strict enough)', async () => {
    const many: Finding[] = [];
    for (let i = 0; i < 500; i++) {
      many.push(findingFx({
        id: `i${i}`,
        source: 'memory',
        title: 'x'.repeat(500),
        importance: 0.9
      }));
    }
    const agent = new SurfaceAgent({
      maxBytes: 5000,
      minImportance: 0.0,
      maxFindings: 1000,
      clock: constantClock(),
      connectors: [fakeConnector('memory', many)]
    });
    await expect(agent.generateDigest({ since: '1 day ago' })).rejects.toThrow(/Digest size/);
  });

  it('drops findings below minImportance', async () => {
    const agent = new SurfaceAgent({
      maxBytes: 50_000,
      minImportance: 0.99,
      clock: constantClock(),
      connectors: [fakeConnector('memory', [
        findingFx({ id: 'a', source: 'memory', title: 'low importance' })
      ])]
    });
    const d = await agent.generateDigest({ since: '1 day ago' });
    expect(d.findings.length).toBe(0);
    expect(d.dropped.length).toBeGreaterThanOrEqual(1);
  });

  it('emits a connector-degraded annotation on warnings', async () => {
    const agent = new SurfaceAgent({
      maxBytes: 50_000,
      minImportance: 0.0,
      clock: constantClock(),
      connectors: [fakeConnector('pr', [], ['rate-limit hit'])]
    });
    const d = await agent.generateDigest({ since: '1 day ago' });
    expect(d.markdown).toContain('Connector pr degraded');
  });

  it('determinism: same fakes, two runs → byte-identical markdown', async () => {
    const findings = [findingFx({ id: 'a', source: 'memory', title: 'x' })];
    const a1 = new SurfaceAgent({
      maxBytes: 50_000, minImportance: 0.0, clock: constantClock(),
      connectors: [fakeConnector('memory', findings)]
    });
    const a2 = new SurfaceAgent({
      maxBytes: 50_000, minImportance: 0.0, clock: constantClock(),
      connectors: [fakeConnector('memory', findings)]
    });
    const d1 = await a1.generateDigest({ since: '1 day ago' });
    const d2 = await a2.generateDigest({ since: '1 day ago' });
    expect(d1.markdown).toBe(d2.markdown);
  });

  it('survives a connector that throws', async () => {
    const agent = new SurfaceAgent({
      maxBytes: 50_000,
      minImportance: 0.0,
      clock: constantClock(),
      connectors: [
        {
          source: 'pr',
          async collect(): Promise<ConnectorResult> {
            throw new Error('boom');
          }
        }
      ]
    });
    const d = await agent.generateDigest({ since: '1 day ago' });
    expect(d.markdown).toContain('Connector pr degraded');
  });

  it('--since gibberish rejected with clear error', async () => {
    const agent = new SurfaceAgent({ clock: constantClock(), connectors: [] });
    await expect(agent.generateDigest({ since: 'not-a-time' })).rejects.toThrow(/could not parse/);
  });

  it('uses defaults for max bytes/findings/importance', () => {
    const agent = new SurfaceAgent({});
    expect(agent.config.maxBytes).toBe(50_000);
    expect(agent.config.maxFindings).toBe(100);
    expect(agent.config.minImportance).toBeCloseTo(0.35, 5);
  });

  it('integration: built-in connectors used when no override (with fake fs/gh/git)', async () => {
    const fs = new FakeFs()
      .addDir('/m')
      .addFile('/m/feedback_x.md', 'b'.repeat(200), '2026-05-09T03:00:00.000Z');
    const gh = new FakeGh()
      .on(args => args.includes('merged'), '[]')
      .on(args => args.includes('open'), '[]');
    // Force fs-walk fallback by simulating "agent-memory not a git repo"
    const git = new FakeGit().on('/m', _ => true, new Error('not a git repo'));
    const agent = new SurfaceAgent({
      corpusRoot: '/m',
      memoryGitRepo: '/m',
      transcriptRoot: '/no',
      ghRepo: 'r/r',
      maxBytes: 50_000,
      minImportance: 0.0,
      fs, gh, git,
      clock: constantClock()
    });
    const d = await agent.generateDigest({ since: '1 day ago' });
    // Memory file fs-walk fallback should pick up feedback_x.md.
    const seenFx = d.markdown.includes('feedback_x.md');
    expect(seenFx).toBe(true);
  });
});
