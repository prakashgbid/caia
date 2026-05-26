/**
 * Unit tests for the Step 5 proposal generator API route.
 *
 * The tests run the default (stub) path of the handler with a mocked
 * `next/headers` returning a tenant-id. The live-mode path
 * (WIZARD_PROPOSAL_LIVE=1) is integration-tested in CI via a separate
 * E2E pass — invoking the real runStep5 from a vitest jsdom env trips
 * Next.js's request-scope guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  delete process.env['WIZARD_PROPOSAL_LIVE'];
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in realEnv)) delete process.env[k];
  }
  for (const k of Object.keys(realEnv)) {
    process.env[k] = realEnv[k]!;
  }
});

async function loadRoute(): Promise<typeof import('../../../app/api/wizard/proposal/generate/route')> {
  return await import('../../../app/api/wizard/proposal/generate/route');
}

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:7777/api/wizard/proposal/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/wizard/proposal/generate', () => {
  it('returns 400 on invalid JSON', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request('http://localhost/api/wizard/proposal/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when tenantProjectId is missing', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({}) as never);
    expect(res.status).toBe(400);
  });

  it('returns 200 with stub proposal in default mode', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ tenantProjectId: 'p-1' }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; proposal: { execSummaryMd: string } };
    expect(body.source).toBe('memory');
    expect(body.proposal.execSummaryMd).toContain('Executive Summary');
  });

  it('default stub proposal contains all three Markdown renderers', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ tenantProjectId: 'p-1' }) as never);
    const body = (await res.json()) as {
      proposal: { execSummaryMd: string; fullProposalMd: string; onePagerMd: string };
    };
    expect(body.proposal.execSummaryMd).toBeTruthy();
    expect(body.proposal.fullProposalMd).toBeTruthy();
    expect(body.proposal.onePagerMd).toBeTruthy();
  });

  it('default stub proposal has a design-app prompt and ship reviewer badge', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ tenantProjectId: 'p-1' }) as never);
    const body = (await res.json()) as {
      designAppPrompt: { reviewerBadge: string; reviewerScore: number; target: string };
    };
    expect(body.designAppPrompt.reviewerBadge).toBe('ship');
    expect(body.designAppPrompt.target).toBe('claude_design');
    expect(typeof body.designAppPrompt.reviewerScore).toBe('number');
  });

  it('default stub proposal reports cacheHit:false', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ tenantProjectId: 'p-1' }) as never);
    const body = (await res.json()) as { cacheHit: boolean };
    expect(body.cacheHit).toBe(false);
  });

  it('returns a valid JSON envelope with `ok: true` in default mode', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ tenantProjectId: 'p-1' }) as never);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('runtime is set to nodejs', async () => {
    const mod = await loadRoute();
    expect(mod.runtime).toBe('nodejs');
  });

  it('dynamic is force-dynamic', async () => {
    const mod = await loadRoute();
    expect(mod.dynamic).toBe('force-dynamic');
  });

  it('produces revisionNumber 1 in the stub path', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ tenantProjectId: 'p-1' }) as never);
    const body = (await res.json()) as { proposal: { revisionNumber: number } };
    expect(body.proposal.revisionNumber).toBe(1);
  });

  it('returns an error envelope on a malformed body', async () => {
    const { POST } = await loadRoute();
    const badRes = await POST(
      new Request('http://localhost/api/wizard/proposal/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }) as never,
    );
    const badBody = await badRes.json();
    expect(badBody).toHaveProperty('error');
  });

  it('accepts a designAppTarget passthrough in the body', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({ tenantProjectId: 'p-1', designAppTarget: 'v0' }) as never,
    );
    // V1 stub path always returns claude_design — but the route should
    // not 400 just because we passed designAppTarget through.
    expect(res.status).toBe(200);
  });

  it('accepts a revisionReason passthrough in the body', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({ tenantProjectId: 'p-1', revisionReason: 'just-because' }) as never,
    );
    expect(res.status).toBe(200);
  });
});
