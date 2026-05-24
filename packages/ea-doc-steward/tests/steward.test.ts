import { describe, expect, it } from 'vitest';

import { InMemoryFsAdapter, type EaRepository } from '@caia/ea-architect';

import {
  AdrFiler,
  IndexMaintainer,
  RepoFreshnessChecker,
  validateSupersessionGraph
} from '../src/index.js';

const emptyRepo: EaRepository = {
  rootPath: '/tmp/caia-ea',
  adrs: [],
  principles: [],
  lessons: [],
  risks: [],
  feedback: [],
  maxAdrId: 60
};

describe('AdrFiler', () => {
  it('files a new ADR and updates INDEX', async () => {
    const fs = new InMemoryFsAdapter({
      '/tmp/caia-ea/decisions/INDEX.md': '# Index\n'
    });
    const filer = new AdrFiler();
    const result = await filer.file({
      repo: emptyRepo,
      newAdrsToFile: [
        {
          title: 'Adopt EA Coordinator pattern',
          status: 'Accepted',
          context: 'why',
          decision: 'do this',
          consequences: 'good things'
        }
      ],
      affectedExistingAdrs: [],
      submissionId: 's',
      fs
    });
    expect(result.filedAdrs.length).toBe(1);
    expect(result.filedAdrs[0]?.adrId).toBe('ADR-061');
    expect(result.indexUpdated).toBe(true);
  });

  it('returns clean supersession graph for empty repo', async () => {
    const fs = new InMemoryFsAdapter({});
    const filer = new AdrFiler();
    const result = await filer.file({
      repo: emptyRepo,
      newAdrsToFile: [],
      affectedExistingAdrs: [],
      submissionId: 's',
      fs
    });
    expect(result.supersessionGraph.ok).toBe(true);
  });
});

describe('validateSupersessionGraph', () => {
  it('detects cycles', () => {
    const repo: EaRepository = {
      ...emptyRepo,
      adrs: [
        {
          id: 1,
          adrId: 'ADR-001',
          filePath: '/p/ADR-001.md',
          title: 'A',
          status: 'Accepted',
          affectedComponents: [],
          body: '# ADR-001\n\nSupersedes: ADR-002\n',
          keywords: []
        },
        {
          id: 2,
          adrId: 'ADR-002',
          filePath: '/p/ADR-002.md',
          title: 'B',
          status: 'Accepted',
          affectedComponents: [],
          body: '# ADR-002\n\nSupersedes: ADR-001\n',
          keywords: []
        }
      ]
    };
    const result = validateSupersessionGraph(repo);
    expect(result.ok).toBe(false);
    expect(result.cycles.length).toBeGreaterThan(0);
  });

  it('detects orphaned supersedes', () => {
    const repo: EaRepository = {
      ...emptyRepo,
      adrs: [
        {
          id: 1,
          adrId: 'ADR-001',
          filePath: '/p/ADR-001.md',
          title: 'A',
          status: 'Accepted',
          affectedComponents: [],
          body: '# ADR-001\n\nSupersedes: ADR-999\n',
          keywords: []
        }
      ]
    };
    const result = validateSupersessionGraph(repo);
    expect(result.orphanedSupersedes.length).toBe(1);
  });
});

describe('IndexMaintainer.rebuildSignoffsIndex', () => {
  it('writes the INDEX.md sorted reverse-chronologically', () => {
    const fs = new InMemoryFsAdapter({});
    const im = new IndexMaintainer(fs);
    const result = im.rebuildSignoffsIndex('/tmp/sign-offs', [
      { submissionId: '1', verdict: 'approved', planSlug: 'a', readTimeMinutes: 5, signoffRelativePath: '1.md', generatedAtIso: '2026-05-22T00:00:00.000Z' },
      { submissionId: '2', verdict: 'rejected', planSlug: 'b', readTimeMinutes: 7, signoffRelativePath: '2.md', generatedAtIso: '2026-05-24T00:00:00.000Z' }
    ]);
    const written = fs.get('/tmp/sign-offs/INDEX.md');
    expect(written).toBeDefined();
    // Should list b (newer) before a.
    const idxA = (written ?? '').indexOf('[a](');
    const idxB = (written ?? '').indexOf('[b](');
    expect(idxB).toBeGreaterThan(0);
    expect(idxB).toBeLessThan(idxA);
    expect(result.added).toBe(2);
  });
});

describe('RepoFreshnessChecker', () => {
  it('flags missing affected-components', () => {
    const repo: EaRepository = {
      ...emptyRepo,
      adrs: [
        {
          id: 1,
          adrId: 'ADR-001',
          filePath: '/p/ADR-001.md',
          title: 'A',
          status: 'Accepted',
          affectedComponents: [],
          body: '# ADR-001\n\nStatus: Accepted\n',
          keywords: []
        }
      ]
    };
    const result = new RepoFreshnessChecker().scan(repo);
    expect(result.stale.length).toBe(1);
    expect(result.stale[0]?.reason).toBe('no-affected-components');
  });
});
