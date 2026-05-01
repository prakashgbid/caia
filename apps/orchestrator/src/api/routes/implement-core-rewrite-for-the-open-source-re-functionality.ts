import type { Hono } from 'hono';

export interface OssPackage {
  name: string;
  version: string;
  description: string;
  kind: 'app' | 'package';
  status: 'stable' | 'beta' | 'alpha';
}

const OSS_CATALOG: OssPackage[] = [
  { name: '@caia-app/orchestrator', version: '0.1.0', description: 'CAIA orchestration server and API', kind: 'app', status: 'beta' },
  { name: '@caia-app/dashboard', version: '0.1.0', description: 'CAIA monitoring dashboard (Next.js)', kind: 'app', status: 'beta' },
  { name: '@caia-app/executor', version: '0.1.0', description: 'Claude Code executor daemon', kind: 'app', status: 'beta' },
  { name: '@caia/cli', version: '0.1.0', description: 'CAIA project scaffolding CLI', kind: 'package', status: 'beta' },
  { name: '@caia/config', version: '0.1.0', description: 'Shared configuration utilities', kind: 'package', status: 'stable' },
  { name: '@caia/errors', version: '0.1.0', description: 'Structured error types', kind: 'package', status: 'stable' },
  { name: '@caia/events', version: '0.1.0', description: 'Typed domain event definitions', kind: 'package', status: 'stable' },
  { name: '@chiefaia/cache', version: '0.1.0', description: 'Redis-backed cache layer', kind: 'package', status: 'stable' },
  { name: '@chiefaia/local-llm-router', version: '0.1.0', description: 'LLM dispatch with circuit-breaker and retry', kind: 'package', status: 'stable' },
  { name: '@chiefaia/logger', version: '0.1.0', description: 'Structured logger with redaction', kind: 'package', status: 'stable' },
];

// @no-events — read-only catalog endpoint, no domain mutations
export function registerOssRegistryRoutes(app: Hono): void {
  app.get('/oss-registry', (c) => {
    const kindCounts = OSS_CATALOG.reduce<Record<string, number>>((acc, p) => {
      acc[p.kind] = (acc[p.kind] ?? 0) + 1;
      return acc;
    }, {});
    const statusCounts = OSS_CATALOG.reduce<Record<string, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    }, {});
    return c.json({
      totalPackages: OSS_CATALOG.length,
      kindBreakdown: kindCounts,
      statusBreakdown: statusCounts,
      lastUpdated: new Date().toISOString(),
    });
  });

  app.get('/oss-registry/packages', (c) => {
    const { kind, status } = c.req.query() as Record<string, string>;
    let results: OssPackage[] = OSS_CATALOG;
    if (kind) results = results.filter((p) => p.kind === kind);
    if (status) results = results.filter((p) => p.status === status);
    return c.json(results);
  });

  app.get('/oss-registry/packages/:name', (c) => {
    const name = decodeURIComponent(c.req.param('name'));
    const pkg = OSS_CATALOG.find((p) => p.name === name);
    if (!pkg) return c.json({ error: 'Package not found' }, 404);
    return c.json(pkg);
  });
}
