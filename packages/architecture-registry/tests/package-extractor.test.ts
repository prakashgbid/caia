import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPackagesFromMonorepo } from '../src';

const NOW = 1745812800000;
let counter = 0;
const idFactory = (prefix: string) => `${prefix}_${counter++}`;
const reset = () => { counter = 0; };

function makeMonorepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'akg-pkg-'));
  // packages/feature-registry
  mkdirSync(join(root, 'packages/feature-registry'), { recursive: true });
  writeFileSync(
    join(root, 'packages/feature-registry/package.json'),
    JSON.stringify({
      name: '@chiefaia/feature-registry',
      version: '0.1.0',
      private: true,
      description: 'Fast, local feature registry.',
      dependencies: {
        zod: '^3.23.8',
        'better-sqlite3': '^12.6.2',
        '@chiefaia/ticket-template': 'workspace:*',
      },
      devDependencies: {
        vitest: '^1.6.0',
      },
    }),
  );
  // packages/ticket-template
  mkdirSync(join(root, 'packages/ticket-template'), { recursive: true });
  writeFileSync(
    join(root, 'packages/ticket-template/package.json'),
    JSON.stringify({
      name: '@chiefaia/ticket-template',
      version: '0.2.0',
      private: true,
      description: 'Canonical ticket template.',
      dependencies: { zod: '^3.23.8' },
    }),
  );
  // apps/orchestrator
  mkdirSync(join(root, 'apps/orchestrator'), { recursive: true });
  writeFileSync(
    join(root, 'apps/orchestrator/package.json'),
    JSON.stringify({
      name: '@caia-app/orchestrator',
      version: '0.1.1',
      private: true,
      description: 'Orchestrator brain.',
      dependencies: {
        hono: '^4.0.0',
        '@chiefaia/feature-registry': 'workspace:*',
        '@chiefaia/ticket-template': 'workspace:*',
      },
    }),
  );
  // an empty folder under apps/ with no package.json — should be skipped
  mkdirSync(join(root, 'apps/empty'), { recursive: true });
  return root;
}

describe('extractPackagesFromMonorepo', () => {
  let root: string;
  beforeEach(() => {
    reset();
    root = makeMonorepo();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('emits one artifact per workspace package + one per external dep', () => {
    const r = extractPackagesFromMonorepo({
      repoRoot: root,
      defaultProject: 'caia',
      now: NOW,
      newId: idFactory,
    });
    expect(r.warnings).toEqual([]);
    const internalNames = r.artifacts
      .filter((a) => a.tags.includes('internal'))
      .map((a) => a.name)
      .sort();
    expect(internalNames).toEqual([
      '@caia-app/orchestrator',
      '@chiefaia/feature-registry',
      '@chiefaia/ticket-template',
    ]);
    const externalNames = r.artifacts
      .filter((a) => a.tags.includes('external'))
      .map((a) => a.name)
      .sort();
    expect(externalNames).toEqual(['better-sqlite3', 'hono', 'vitest', 'zod']);
  });

  it('records reverse-deps (consumers) for internal packages', () => {
    const r = extractPackagesFromMonorepo({
      repoRoot: root,
      defaultProject: 'caia',
      now: NOW,
      newId: idFactory,
    });
    const ticketTpl = r.artifacts.find((a) => a.name === '@chiefaia/ticket-template')!;
    const meta = JSON.parse(ticketTpl.metadataJson);
    expect(meta.consumers.sort()).toEqual([
      '@caia-app/orchestrator',
      '@chiefaia/feature-registry',
    ]);
  });

  it('emits depends_on edges from each consumer to each dep', () => {
    const r = extractPackagesFromMonorepo({
      repoRoot: root,
      defaultProject: 'caia',
      now: NOW,
      newId: idFactory,
    });
    expect(r.edges.length).toBeGreaterThanOrEqual(6);
    const featureRegistry = r.artifacts.find((a) => a.name === '@chiefaia/feature-registry')!;
    const featureRegistryEdges = r.edges.filter((e) => e.fromId === featureRegistry.id);
    // feature-registry depends on: zod, better-sqlite3, @chiefaia/ticket-template, vitest
    const targetIds = new Set(featureRegistryEdges.map((e) => e.toId));
    expect(targetIds.size).toBe(4);
    expect(featureRegistryEdges.every((e) => e.relation === 'depends_on')).toBe(true);
  });

  it('produces stable dedup keys on re-extraction', () => {
    const r1 = extractPackagesFromMonorepo({
      repoRoot: root,
      defaultProject: 'caia',
      now: NOW,
      newId: idFactory,
    });
    counter = 0;
    const r2 = extractPackagesFromMonorepo({
      repoRoot: root,
      defaultProject: 'caia',
      now: NOW,
      newId: idFactory,
    });
    expect(r1.artifacts.map((a) => a.dedupKey).sort()).toEqual(
      r2.artifacts.map((a) => a.dedupKey).sort(),
    );
  });

  it('returns a warning when no workspace folders exist', () => {
    const empty = mkdtempSync(join(tmpdir(), 'akg-empty-'));
    const r = extractPackagesFromMonorepo({
      repoRoot: empty,
      defaultProject: 'caia',
      now: NOW,
      newId: idFactory,
    });
    expect(r.artifacts).toHaveLength(0);
    expect(r.warnings.length).toBe(1);
    rmSync(empty, { recursive: true, force: true });
  });

  it('infers tech sub-domains for internal + external packages', () => {
    const r = extractPackagesFromMonorepo({
      repoRoot: root,
      defaultProject: 'caia',
      now: NOW,
      newId: idFactory,
    });
    const featureRegistry = r.artifacts.find((a) => a.name === '@chiefaia/feature-registry')!;
    expect(featureRegistry.techSubDomains.length).toBeGreaterThan(0);
    const honoExt = r.artifacts.find((a) => a.name === 'hono')!;
    expect(honoExt.techSubDomains).toContain('bff');
    const sqliteExt = r.artifacts.find((a) => a.name === 'better-sqlite3')!;
    expect(sqliteExt.techSubDomains).toContain('database');
    const zodExt = r.artifacts.find((a) => a.name === 'zod')!;
    expect(zodExt.techSubDomains).toContain('agent-runtime');
  });
});
