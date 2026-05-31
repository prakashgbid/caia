/**
 * Unit tests for POST /api/wizard/design/ingest (Phase B B2).
 *
 * The route runs the canonical wrapper chain (withTenantSearchPath →
 * wizardWithRetry → withClaudeSpawnerSpan) around `ClaudeDesignAdapter`.
 *
 * These tests exercise the route at the contract level — the stub path
 * (`WIZARD_DESIGN_LIVE` unset) returns a deterministic stub response so
 * we can assert on shape + status codes without hitting Claude. Adapter
 * unit tests in `packages/design-ingest/tests/unit/claude-design-adapter.test.ts`
 * cover the spawn → envelope → schema path in detail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: async () => ({
    get(name: string) {
      if (name === 'x-tenant-id') return 'tenant-test';
      return null;
    },
  }),
}));

const realEnv = { ...process.env };

beforeEach(() => {
  delete process.env['WIZARD_DESIGN_LIVE'];
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in realEnv)) delete process.env[k];
  }
  for (const k of Object.keys(realEnv)) {
    process.env[k] = realEnv[k]!;
  }
});

async function loadRoute(): Promise<typeof import('../../../app/api/wizard/design/ingest/route')> {
  return await import('../../../app/api/wizard/design/ingest/route');
}

function makeReq(body: unknown): Request {
  return new Request('http://localhost:7777/api/wizard/design/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/wizard/design/ingest — contract', () => {
  it('runtime is nodejs', async () => {
    const mod = await loadRoute();
    expect(mod.runtime).toBe('nodejs');
  });

  it('dynamic is force-dynamic', async () => {
    const mod = await loadRoute();
    expect(mod.dynamic).toBe('force-dynamic');
  });
});

describe('POST /api/wizard/design/ingest — validation', () => {
  it('returns 400 on bad json', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request('http://localhost/api/wizard/design/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad-json');
  });

  it('returns 400 when tenantProjectId is missing', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ promptText: 'design something' }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('tenantProjectId-required');
  });

  it('returns 400 when promptText is missing', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ tenantProjectId: 'p-1' }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('promptText-required');
  });

  it('returns 400 when promptText is whitespace-only', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({ tenantProjectId: 'p-1', promptText: '   ' }) as never,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('promptText-required');
  });
});

describe('POST /api/wizard/design/ingest — auth', () => {
  it('returns 401 when x-tenant-id is missing', async () => {
    vi.resetModules();
    vi.doMock('next/headers', () => ({
      headers: async () => ({
        get() {
          return null;
        },
      }),
    }));
    const mod = await import('../../../app/api/wizard/design/ingest/route');
    const res = await mod.POST(
      makeReq({ tenantProjectId: 'p-1', promptText: 'x' }) as never,
    );
    expect(res.status).toBe(401);
    vi.doUnmock('next/headers');
    vi.resetModules();
    vi.doMock('next/headers', () => ({
      headers: async () => ({
        get(name: string) {
          if (name === 'x-tenant-id') return 'tenant-test';
          return null;
        },
      }),
    }));
  });
});

describe('POST /api/wizard/design/ingest — stub path', () => {
  it('returns 200 + source=memory by default (no WIZARD_DESIGN_LIVE)', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({ tenantProjectId: 'p-1', promptText: 'design a dashboard' }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      source: string;
      designVersionId: string;
      attemptsRun: number;
      renderableDesign: unknown;
    };
    expect(body.ok).toBe(true);
    expect(body.source).toBe('memory');
    expect(body.attemptsRun).toBe(1);
    expect(body.renderableDesign).toBeNull();
  });

  it('uses the caller-supplied designVersionId when provided', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({
        tenantProjectId: 'p-1',
        promptText: 'design',
        designVersionId: 'dv-fixed-1',
      }) as never,
    );
    const body = (await res.json()) as { designVersionId: string };
    expect(body.designVersionId).toBe('dv-fixed-1');
  });

  it('generates a designVersionId when none is supplied', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({ tenantProjectId: 'p-1', promptText: 'design' }) as never,
    );
    const body = (await res.json()) as { designVersionId: string };
    expect(body.designVersionId.startsWith('dv-')).toBe(true);
    expect(body.designVersionId.length).toBeGreaterThan(5);
  });

  it('includes a note pointing at WIZARD_DESIGN_LIVE for the live path', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({ tenantProjectId: 'p-1', promptText: 'design' }) as never,
    );
    const body = (await res.json()) as { note: string };
    expect(body.note).toContain('WIZARD_DESIGN_LIVE');
  });

  it('returns the same shape for repeated calls (idempotent on stub)', async () => {
    const { POST } = await loadRoute();
    const res1 = await POST(
      makeReq({
        tenantProjectId: 'p-1',
        promptText: 'design',
        designVersionId: 'dv-1',
      }) as never,
    );
    const res2 = await POST(
      makeReq({
        tenantProjectId: 'p-1',
        promptText: 'design',
        designVersionId: 'dv-1',
      }) as never,
    );
    const b1 = (await res1.json()) as Record<string, unknown>;
    const b2 = (await res2.json()) as Record<string, unknown>;
    expect(b1).toEqual(b2);
  });
});
