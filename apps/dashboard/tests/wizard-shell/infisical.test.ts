/**
 * createInfisicalProject — happy / error / malformed-body paths.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createInfisicalProject,
  InfisicalProvisionError,
} from '../../lib/tenants/infisical';

const OPTS = {
  baseUrl: 'https://infisical.test',
  adminToken: 'tk',
  organizationId: 'org-1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createInfisicalProject', () => {
  it('returns {projectId, name} on success', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ workspace: { _id: 'w-1', name: 'tenant-a' } }),
    ) as unknown as typeof fetch;
    const r = await createInfisicalProject('tenant-a', { ...OPTS, fetchImpl });
    expect(r).toEqual({ projectId: 'w-1', name: 'tenant-a' });
  });

  it('POSTs to /api/v2/workspace with bearer auth + JSON body', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      captured = { url, init };
      return jsonResponse({ workspace: { _id: 'w-1', name: 'tenant-a' } });
    }) as unknown as typeof fetch;
    await createInfisicalProject('tenant-a', { ...OPTS, fetchImpl });
    expect(captured.url).toBe('https://infisical.test/api/v2/workspace');
    expect((captured.init?.headers as Record<string, string>)?.authorization).toBe('Bearer tk');
    expect(captured.init?.body).toContain('"workspaceName":"tenant-a"');
  });

  it('throws InfisicalProvisionError on non-2xx', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'forbidden' }, 403)) as unknown as typeof fetch;
    const err = await createInfisicalProject('x', { ...OPTS, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(InfisicalProvisionError);
    expect((err as InfisicalProvisionError).status).toBe(403);
  });

  it('throws on missing workspace.<_id> in success body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ workspace: { name: 'x' } })) as unknown as typeof fetch;
    await expect(createInfisicalProject('x', { ...OPTS, fetchImpl })).rejects.toThrow(/malformed/);
  });

  it('throws on missing workspace.name in success body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ workspace: { _id: 'x' } })) as unknown as typeof fetch;
    await expect(createInfisicalProject('x', { ...OPTS, fetchImpl })).rejects.toThrow(/malformed/);
  });

  it('strips trailing slashes from baseUrl when composing the URL', async () => {
    let url = '';
    const fetchImpl = vi.fn(async (u: string) => {
      url = u;
      return jsonResponse({ workspace: { _id: 'x', name: 'x' } });
    }) as unknown as typeof fetch;
    await createInfisicalProject('x', { ...OPTS, baseUrl: 'https://infisical.test///', fetchImpl });
    expect(url).toBe('https://infisical.test/api/v2/workspace');
  });
});
