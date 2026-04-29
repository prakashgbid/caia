import { describe, it, expect } from 'vitest';
import {
  computeArtifactDedupKey,
  computeEdgeDedupKey,
} from '../src';

describe('computeArtifactDedupKey', () => {
  it('returns a 64-char sha256 hex string', () => {
    const k = computeArtifactDedupKey({
      project: 'caia',
      kind: 'component',
      name: 'PromptList',
      entryPath: 'apps/dashboard/components/prompt-list.tsx',
    });
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across whitespace + casing', () => {
    const a = computeArtifactDedupKey({
      project: 'caia',
      kind: 'component',
      name: 'PromptList',
      entryPath: 'apps/dashboard/components/prompt-list.tsx',
    });
    const b = computeArtifactDedupKey({
      project: ' Caia ',
      kind: 'component',
      name: 'promptlist  ',
      entryPath: '   APPS/dashboard/components/prompt-list.tsx ',
    });
    expect(a).toBe(b);
  });

  it('locator preference: routeSignature beats other locators', () => {
    const a = computeArtifactDedupKey({
      project: 'caia',
      kind: 'api',
      name: 'leaderboard',
      routeSignature: 'GET /api/leaderboard',
      entryPath: 'apps/orchestrator/src/api/routes/leaderboard.ts',
    });
    const b = computeArtifactDedupKey({
      project: 'caia',
      kind: 'api',
      name: 'leaderboard',
      routeSignature: 'GET /api/leaderboard',
      entryPath: 'somewhere/else.ts', // ignored — route wins
    });
    expect(a).toBe(b);
  });

  it('locator preference: tableName for schemas + migrations', () => {
    const a = computeArtifactDedupKey({
      project: 'caia',
      kind: 'schema',
      name: 'arch_artifacts',
      tableName: 'arch_artifacts',
    });
    const b = computeArtifactDedupKey({
      project: 'caia',
      kind: 'schema',
      name: 'arch_artifacts',
      tableName: 'arch_artifacts',
      filePaths: ['apps/orchestrator/src/db/schema.ts'],
    });
    expect(a).toBe(b);
  });

  it('different artifact kind → different key', () => {
    const a = computeArtifactDedupKey({
      project: 'caia',
      kind: 'component',
      name: 'X',
      entryPath: 'a.tsx',
    });
    const b = computeArtifactDedupKey({
      project: 'caia',
      kind: 'service',
      name: 'X',
      entryPath: 'a.tsx',
    });
    expect(a).not.toBe(b);
  });

  it('different name → different key', () => {
    const a = computeArtifactDedupKey({
      project: 'caia',
      kind: 'component',
      name: 'A',
      entryPath: 'x.tsx',
    });
    const b = computeArtifactDedupKey({
      project: 'caia',
      kind: 'component',
      name: 'B',
      entryPath: 'x.tsx',
    });
    expect(a).not.toBe(b);
  });

  it('different project → different key', () => {
    const a = computeArtifactDedupKey({
      project: 'caia',
      kind: 'component',
      name: 'X',
      entryPath: 'a.tsx',
    });
    const b = computeArtifactDedupKey({
      project: 'pokerzeno',
      kind: 'component',
      name: 'X',
      entryPath: 'a.tsx',
    });
    expect(a).not.toBe(b);
  });

  it('falls back to filePaths join when no other locator present', () => {
    const a = computeArtifactDedupKey({
      project: 'caia',
      kind: 'domain_module',
      name: 'auth',
      filePaths: ['x.ts', 'y.ts'],
    });
    // Order independent.
    const b = computeArtifactDedupKey({
      project: 'caia',
      kind: 'domain_module',
      name: 'auth',
      filePaths: ['y.ts', 'x.ts'],
    });
    expect(a).toBe(b);
  });

  it('handles fully empty locators (conceptual artifacts)', () => {
    const a = computeArtifactDedupKey({
      project: 'caia',
      kind: 'domain_module',
      name: 'shared-context',
    });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeEdgeDedupKey', () => {
  it('returns a 64-char sha256 hex', () => {
    const k = computeEdgeDedupKey({
      fromId: 'arch_x',
      toId: 'arch_y',
      relation: 'depends_on',
    });
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is direction-sensitive', () => {
    const a = computeEdgeDedupKey({
      fromId: 'arch_x',
      toId: 'arch_y',
      relation: 'depends_on',
    });
    const b = computeEdgeDedupKey({
      fromId: 'arch_y',
      toId: 'arch_x',
      relation: 'depends_on',
    });
    expect(a).not.toBe(b);
  });

  it('is relation-sensitive', () => {
    const a = computeEdgeDedupKey({
      fromId: 'arch_x',
      toId: 'arch_y',
      relation: 'depends_on',
    });
    const b = computeEdgeDedupKey({
      fromId: 'arch_x',
      toId: 'arch_y',
      relation: 'documented_by',
    });
    expect(a).not.toBe(b);
  });
});
