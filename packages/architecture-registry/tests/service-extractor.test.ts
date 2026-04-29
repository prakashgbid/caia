import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractServicesFromAppsRoot } from '../src';

const NOW = 1745812800000;
let counter = 0;
const idFactory = (prefix: string) => `${prefix}_${counter++}`;

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'akg-test-'));
  // apps/orchestrator
  mkdirSync(join(root, 'apps/orchestrator/src'), { recursive: true });
  writeFileSync(
    join(root, 'apps/orchestrator/package.json'),
    JSON.stringify({
      name: '@caia-app/orchestrator',
      private: true,
      description: 'Orchestrator brain (MCP server + Hono API + WebSocket).',
      dependencies: { hono: '^4.0.0' },
    }),
  );
  writeFileSync(
    join(root, 'apps/orchestrator/src/index.ts'),
    `
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
const app = new Hono();
serve({ fetch: app.fetch, port: 7776 });
`,
  );
  mkdirSync(join(root, 'apps/orchestrator/src/pump'), { recursive: true });
  writeFileSync(
    join(root, 'apps/orchestrator/src/pump/pump.ts'),
    'export class PumpEngine {}',
  );

  // apps/dashboard (Next.js)
  mkdirSync(join(root, 'apps/dashboard/app'), { recursive: true });
  writeFileSync(
    join(root, 'apps/dashboard/package.json'),
    JSON.stringify({
      name: '@caia-app/dashboard',
      private: true,
      description: 'CAIA orchestrator dashboard.',
      dependencies: { next: '^15.0.0', react: '^18.0.0' },
    }),
  );

  // apps/db-backup — has no port, no pump
  mkdirSync(join(root, 'apps/db-backup'), { recursive: true });
  writeFileSync(
    join(root, 'apps/db-backup/package.json'),
    JSON.stringify({ name: 'db-backup', description: 'SQLite backup job.' }),
  );

  return root;
}

describe('extractServicesFromAppsRoot', () => {
  let root: string;

  beforeEach(() => {
    counter = 0;
    root = makeRepo();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('extracts each apps/* folder as a service', () => {
    const r = extractServicesFromAppsRoot({
      repoRoot: root,
      defaultProject: 'caia',
      now: NOW,
      newId: idFactory,
    });
    expect(r.warnings).toEqual([]);
    expect(r.artifacts.length).toBe(3);
    const names = r.artifacts.map((a) => a.name).sort();
    expect(names).toEqual(['@caia-app/dashboard', '@caia-app/orchestrator', 'db-backup']);
  });

  it('detects port + background loop on orchestrator', () => {
    const r = extractServicesFromAppsRoot({
      repoRoot: root,
      defaultProject: 'caia',
      now: NOW,
      newId: idFactory,
    });
    const orch = r.artifacts.find((a) => a.name === '@caia-app/orchestrator')!;
    expect(orch).toBeDefined();
    const meta = JSON.parse(orch.metadataJson);
    expect(meta.port).toBe(7776);
    expect(meta.hasBackgroundLoop).toBe(true);
    expect(orch.techSubDomains).toContain('bff');
    expect(orch.techSubDomains).toContain('agent-runtime');
    expect(orch.tags).toContain('hono');
  });

  it('tags Next.js apps as frontend', () => {
    const r = extractServicesFromAppsRoot({
      repoRoot: root,
      defaultProject: 'caia',
      now: NOW,
      newId: idFactory,
    });
    const dash = r.artifacts.find((a) => a.name === '@caia-app/dashboard')!;
    expect(dash.techSubDomains).toContain('frontend');
    expect(dash.tags).toContain('next');
  });

  it('produces stable dedup key on re-extraction', () => {
    const opts = {
      repoRoot: root,
      defaultProject: 'caia' as const,
      now: NOW,
      newId: idFactory,
    };
    const r1 = extractServicesFromAppsRoot(opts);
    counter = 0;
    const r2 = extractServicesFromAppsRoot(opts);
    const keys1 = r1.artifacts.map((a) => a.dedupKey).sort();
    const keys2 = r2.artifacts.map((a) => a.dedupKey).sort();
    expect(keys1).toEqual(keys2);
  });

  it('returns a warning when apps/ does not exist', () => {
    const r = extractServicesFromAppsRoot({
      repoRoot: '/nonexistent-repo-path',
      defaultProject: 'caia',
      now: NOW,
      newId: idFactory,
    });
    expect(r.artifacts).toEqual([]);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain('not found');
  });
});
