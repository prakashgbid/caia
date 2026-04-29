/**
 * /api/contracts — route tests (ACR-009).
 *
 * Verifies the orchestrator exposes a working dashboard backend for the
 * Agent Section Contract Registry. Uses a real Hono app + the bootstrap
 * function so the assertions run end-to-end.
 */

import { Hono } from 'hono';
import { resetDefaultRegistry } from '@chiefaia/agent-contract-registry';
import { resetBootstrapFlag } from '../../src/agents/contract-bootstrap';
import { registerContractsRoutes } from '../../src/api/routes/contracts';

function buildApp(): Hono {
  resetDefaultRegistry();
  resetBootstrapFlag();
  const app = new Hono();
  registerContractsRoutes(app);
  return app;
}

async function get(app: Hono, path: string): Promise<{ status: number; body: any }> {
  const res = await app.request(path);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: (await res.json()) as any };
}

describe('GET /api/contracts/registry', () => {
  it('returns all 4 Phase-1 contracts with metadata', async () => {
    const app = buildApp();
    const r = await get(app, '/api/contracts/registry');
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(4);
    const owners = r.body.contracts.map((c: { ownerAgent: string }) => c.ownerAgent);
    expect(owners.sort()).toEqual(['ba', 'ea', 'po', 'test-design']);
  });

  it('each contract entry has appliesTo + sectionCount + sectionNames', async () => {
    const app = buildApp();
    const r = await get(app, '/api/contracts/registry');
    for (const c of r.body.contracts) {
      expect(Array.isArray(c.appliesTo)).toBe(true);
      expect(typeof c.sectionCount).toBe('number');
      expect(c.sectionCount).toBeGreaterThan(0);
      expect(Array.isArray(c.sectionNames)).toBe(true);
    }
  });
});

describe('GET /api/contracts/composed/:scope', () => {
  it('story scope returns full union (PO+BA+EA+Test-Design)', async () => {
    const app = buildApp();
    const r = await get(app, '/api/contracts/composed/story');
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('story');
    expect(r.body.warnings).toEqual([]);
    const owners = new Set(
      r.body.sections.map((s: { ownerAgent: string }) => s.ownerAgent),
    );
    expect(owners).toEqual(new Set(['po', 'ba', 'ea', 'test-design']));
  });

  it('initiative scope returns PO-only sections', async () => {
    const app = buildApp();
    const r = await get(app, '/api/contracts/composed/initiative');
    expect(r.status).toBe(200);
    const owners = new Set(
      r.body.sections.map((s: { ownerAgent: string }) => s.ownerAgent),
    );
    expect(owners).toEqual(new Set(['po']));
  });

  it('subtask scope returns PO + EA only', async () => {
    const app = buildApp();
    const r = await get(app, '/api/contracts/composed/subtask');
    expect(r.status).toBe(200);
    const owners = new Set(
      r.body.sections.map((s: { ownerAgent: string }) => s.ownerAgent),
    );
    expect(owners).toContain('po');
    expect(owners).toContain('ea');
    expect(owners).not.toContain('ba');
    expect(owners).not.toContain('test-design');
  });

  it('returns rubric metadata + dependencies + exampleCount per section', async () => {
    const app = buildApp();
    const r = await get(app, '/api/contracts/composed/story');
    const ac = r.body.sections.find((s: { name: string }) => s.name === 'acceptanceCriteria');
    expect(ac).toBeDefined();
    expect(ac.effectiveRubric.severityOnFail).toBe('hard');
    expect(ac.effectiveRubric.fixHint.length).toBeGreaterThan(0);
    expect(ac.exampleCount).toBeGreaterThanOrEqual(1);
  });

  it('rejects invalid scope with 400 + allowedScopes list', async () => {
    const app = buildApp();
    const r = await get(app, '/api/contracts/composed/feature');
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('feature');
    expect(r.body.allowedScopes).toEqual([
      'initiative',
      'epic',
      'module',
      'story',
      'task',
      'subtask',
    ]);
  });

  it('signature is stable across calls', async () => {
    const app = buildApp();
    const a = await get(app, '/api/contracts/composed/story');
    const b = await get(app, '/api/contracts/composed/story');
    expect(a.body.signature).toBe(b.body.signature);
  });
});

describe('GET /api/contracts/composed-all', () => {
  it('returns per-scope summary for every canonical scope', async () => {
    const app = buildApp();
    const r = await get(app, '/api/contracts/composed-all');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.scopes).sort()).toEqual([
      'epic',
      'initiative',
      'module',
      'story',
      'subtask',
      'task',
    ]);
    for (const v of Object.values(r.body.scopes) as Array<{ signature: string; sectionCount: number }>) {
      expect(typeof v.signature).toBe('string');
      expect(v.sectionCount).toBeGreaterThan(0);
    }
  });
});
