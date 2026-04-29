import { describe, it, expect } from 'vitest';
import {
  FeatureRegistryRowSchema,
  computeDedupKey,
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
} from '../src';

const NOW = 1745812800000; // 2026-04-28 in epoch ms

function buildRow(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    id: 'freg_abc1234567',
    project: 'pokerzeno' as const,
    name: 'leaderboard page',
    description: 'ranks top players by chips won today',
    routePath: '/leaderboard',
    filePaths: ['app/leaderboard/page.tsx'],
    componentName: 'LeaderboardPage',
    apiEndpoint: undefined,
    dbTables: ['users', 'sessions'],
    agentName: undefined,
    shippedAt: NOW,
    storyId: 'story-leader-aaaa',
    tags: ['gameplay', 'frontend'],
    source: 'story_completed' as const,
    createdAt: NOW,
    updatedAt: NOW,
    dedupKey: computeDedupKey({
      project: 'pokerzeno',
      name: 'leaderboard page',
      routePath: '/leaderboard',
    }),
  };
  return { ...base, ...overrides };
}

describe('FeatureRegistryRowSchema', () => {
  it('accepts a fully-populated row with the minimum required locator', () => {
    const parsed = FeatureRegistryRowSchema.parse(buildRow());
    expect(parsed.id).toBe('freg_abc1234567');
    expect(parsed.embeddingModel).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(parsed.embeddingDim).toBe(DEFAULT_EMBEDDING_DIM);
  });

  it('rejects a row with an unknown project slug', () => {
    expect(() =>
      FeatureRegistryRowSchema.parse(buildRow({ project: 'fakeproject' as unknown as string })),
    ).toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => FeatureRegistryRowSchema.parse(buildRow({ name: '' }))).toThrow();
  });

  it('rejects a name beyond MAX_NAME_LENGTH', () => {
    expect(() =>
      FeatureRegistryRowSchema.parse(buildRow({ name: 'a'.repeat(MAX_NAME_LENGTH + 1) })),
    ).toThrow();
  });

  it('rejects a description beyond MAX_DESCRIPTION_LENGTH', () => {
    expect(() =>
      FeatureRegistryRowSchema.parse(
        buildRow({ description: 'a'.repeat(MAX_DESCRIPTION_LENGTH + 1) }),
      ),
    ).toThrow();
  });

  it('rejects a row with an unknown source', () => {
    expect(() =>
      FeatureRegistryRowSchema.parse(buildRow({ source: 'magic' as unknown as string })),
    ).toThrow();
  });

  it('rejects a negative shippedAt', () => {
    expect(() => FeatureRegistryRowSchema.parse(buildRow({ shippedAt: -1 }))).toThrow();
  });

  it('rejects extra unknown fields (strict)', () => {
    expect(() =>
      FeatureRegistryRowSchema.parse({ ...buildRow(), wat: 'extra' } as unknown as object),
    ).toThrow();
  });

  it('accepts an agent-style locator (agentName, no routePath)', () => {
    const row = buildRow({
      routePath: undefined,
      componentName: undefined,
      filePaths: ['apps/orchestrator/src/agents/po-agent.ts'],
      agentName: 'po-agent',
      dedupKey: computeDedupKey({
        project: 'pokerzeno',
        name: 'leaderboard page',
        agentName: 'po-agent',
      }),
    });
    expect(() => FeatureRegistryRowSchema.parse(row)).not.toThrow();
  });

  it('rejects a too-short dedupKey', () => {
    expect(() => FeatureRegistryRowSchema.parse(buildRow({ dedupKey: 'short' }))).toThrow();
  });

  it('caps tags at MAX_TAGS', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    expect(() => FeatureRegistryRowSchema.parse(buildRow({ tags: tooMany }))).toThrow();
  });
});

describe('computeDedupKey', () => {
  it('is deterministic across calls', () => {
    const k1 = computeDedupKey({
      project: 'pokerzeno',
      name: 'leaderboard page',
      routePath: '/leaderboard',
    });
    const k2 = computeDedupKey({
      project: 'pokerzeno',
      name: 'leaderboard page',
      routePath: '/leaderboard',
    });
    expect(k1).toBe(k2);
  });

  it('normalizes whitespace and case', () => {
    const k1 = computeDedupKey({
      project: 'pokerzeno',
      name: 'Leaderboard Page',
      routePath: ' /Leaderboard ',
    });
    const k2 = computeDedupKey({
      project: 'pokerzeno',
      name: 'leaderboard page',
      routePath: '/leaderboard',
    });
    expect(k1).toBe(k2);
  });

  it('differs when project differs', () => {
    const k1 = computeDedupKey({
      project: 'pokerzeno',
      name: 'leaderboard page',
      routePath: '/leaderboard',
    });
    const k2 = computeDedupKey({
      project: 'roulettecommunity',
      name: 'leaderboard page',
      routePath: '/leaderboard',
    });
    expect(k1).not.toBe(k2);
  });

  it('uses route_path before component_name when both are present', () => {
    const withRoute = computeDedupKey({
      project: 'pokerzeno',
      name: 'leaderboard page',
      routePath: '/leaderboard',
      componentName: 'LeaderboardPage',
    });
    const withoutComponent = computeDedupKey({
      project: 'pokerzeno',
      name: 'leaderboard page',
      routePath: '/leaderboard',
    });
    expect(withRoute).toBe(withoutComponent);
  });

  it('falls back to api_endpoint when no route/component/agent', () => {
    const k = computeDedupKey({
      project: 'caia',
      name: 'metrics endpoint',
      apiEndpoint: 'GET /metrics',
    });
    expect(k).toMatch(/^[a-f0-9]{64}$/);
  });

  it('falls back to sorted file_paths when nothing else is available', () => {
    const k1 = computeDedupKey({
      project: 'caia',
      name: 'shared utility',
      filePaths: ['packages/utils/src/b.ts', 'packages/utils/src/a.ts'],
    });
    const k2 = computeDedupKey({
      project: 'caia',
      name: 'shared utility',
      filePaths: ['packages/utils/src/a.ts', 'packages/utils/src/b.ts'],
    });
    expect(k1).toBe(k2);
  });

  it('produces a 64-char lowercase hex string', () => {
    const k = computeDedupKey({
      project: 'pokerzeno',
      name: 'leaderboard',
      routePath: '/leaderboard',
    });
    expect(k).toMatch(/^[a-f0-9]{64}$/);
  });
});
