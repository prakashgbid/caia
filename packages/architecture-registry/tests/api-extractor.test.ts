import { describe, it, expect } from 'vitest';
import { extractApisFromInMemorySources } from '../src';

const NOW = 1745812800000;
let counter = 0;
const idFactory = (prefix: string) => `${prefix}_${counter++}`;
const reset = () => { counter = 0; };

const baseOpts = () => ({
  repoRoot: '/repo',
  defaultProject: 'caia',
  now: NOW,
  newId: idFactory,
});

describe('extractApisFromInMemorySources', () => {
  it('extracts a simple GET route', () => {
    reset();
    const sources = [
      {
        path: '/repo/apps/orchestrator/src/api/routes/health.ts',
        content: `
import { Hono } from 'hono';
const app = new Hono();
app.get('/observability/health', (c) => c.json({ status: 'ok' }));
export default app;
`,
      },
    ];
    const r = extractApisFromInMemorySources(sources, baseOpts());
    expect(r.warnings).toEqual([]);
    expect(r.artifacts).toHaveLength(1);
    const a = r.artifacts[0]!;
    expect(a.kind).toBe('api');
    expect(a.routeSignature).toBe('GET /observability/health');
    expect(a.name).toBe('GET /observability/health');
    expect(a.techSubDomains).toContain('bff');
    expect(a.techSubDomains).toContain('observability');
    const meta = JSON.parse(a.metadataJson);
    expect(meta.method).toBe('GET');
    expect(meta.path).toBe('/observability/health');
    expect(meta.authRequired).toBe(false);
  });

  it('extracts a POST route with middleware + auth', () => {
    reset();
    const sources = [
      {
        path: '/repo/apps/orchestrator/src/api/routes/events.ts',
        content: `
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { zValidator } from '../middleware/zv';
const app = new Hono();
app.post('/events', requireAuth, zValidator('json', EventSchema), async (c) => c.json({ ok: true }));
`,
      },
    ];
    const r = extractApisFromInMemorySources(sources, baseOpts());
    expect(r.warnings).toEqual([]);
    expect(r.artifacts).toHaveLength(1);
    const meta = JSON.parse(r.artifacts[0]!.metadataJson);
    expect(meta.method).toBe('POST');
    expect(meta.authRequired).toBe(true);
    expect(meta.middlewareChain.length).toBe(2);
    expect(r.artifacts[0]!.tags).toContain('auth-required');
  });

  it('extracts multiple methods on the same path', () => {
    reset();
    const sources = [
      {
        path: '/repo/apps/orchestrator/src/api/routes/users.ts',
        content: `
import { Hono } from 'hono';
const app = new Hono();
app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }));
app.put('/users/:id', (c) => c.json({}));
app.delete('/users/:id', (c) => c.json({}));
`,
      },
    ];
    const r = extractApisFromInMemorySources(sources, baseOpts());
    expect(r.warnings).toEqual([]);
    expect(r.artifacts).toHaveLength(3);
    expect(r.artifacts.map((a) => a.routeSignature).sort()).toEqual([
      'DELETE /users/:id',
      'GET /users/:id',
      'PUT /users/:id',
    ]);
  });

  it('skips files with no Hono import + non-route filename', () => {
    reset();
    const sources = [
      {
        path: '/repo/apps/orchestrator/src/random.ts',
        content: `
const obj = { get: () => {} };
obj.get('/x', () => {});
`,
      },
    ];
    const r = extractApisFromInMemorySources(sources, baseOpts());
    expect(r.artifacts).toHaveLength(0);
  });

  it('does scan files with .routes.ts pattern even without explicit Hono import', () => {
    reset();
    const sources = [
      {
        path: '/repo/apps/orchestrator/src/api/health.routes.ts',
        content: `
const app = makeApp();
app.get('/observability/health', (c) => c.json({}));
`,
      },
    ];
    const r = extractApisFromInMemorySources(sources, baseOpts());
    expect(r.artifacts).toHaveLength(1);
    expect(r.artifacts[0]!.routeSignature).toBe('GET /observability/health');
  });

  it('produces stable dedup key on re-extraction', () => {
    reset();
    const sources = [
      {
        path: '/repo/apps/orchestrator/src/api/routes/x.ts',
        content: `
import { Hono } from 'hono';
const app = new Hono();
app.get('/x', (c) => c.json({}));
`,
      },
    ];
    const r1 = extractApisFromInMemorySources(sources, baseOpts());
    counter = 0;
    const r2 = extractApisFromInMemorySources(sources, baseOpts());
    expect(r1.artifacts[0]!.dedupKey).toBe(r2.artifacts[0]!.dedupKey);
  });

  it('handles routes registered on subapps + sibling identifiers', () => {
    reset();
    const sources = [
      {
        path: '/repo/apps/orchestrator/src/api/routes/sub.ts',
        content: `
import { Hono } from 'hono';
const router = new Hono();
router.patch('/profile/:id', (c) => c.json({}));
`,
      },
    ];
    const r = extractApisFromInMemorySources(sources, baseOpts());
    expect(r.artifacts).toHaveLength(1);
    const meta = JSON.parse(r.artifacts[0]!.metadataJson);
    expect(meta.appName).toBe('router');
  });
});
