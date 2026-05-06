import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '../app/api/chat/route';

beforeEach(() => {
  delete process.env['CAIA_ORCHESTRATOR_URL'];
});

function makeReq(body: unknown): Request {
  return new Request('http://localhost:7777/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function readStreamToText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

describe('POST /api/chat', () => {
  it('returns 400 when the request body is invalid JSON', async () => {
    const req = new Request('http://localhost:7777/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json'
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when the messages array has no user role', async () => {
    const res = await POST(
      makeReq({ messages: [{ role: 'assistant', content: 'hi' }] }) as never
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 + streams a routing decision for a PO-routed message', async () => {
    const res = await POST(
      makeReq({
        messages: [{ role: 'user', content: 'Decompose this story into tasks.' }]
      }) as never
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-caia-routed-agent')).toBe('caia-po');
    expect(res.headers.get('x-caia-classification')).toBe('decomposition');
    expect(res.headers.get('x-caia-forwarded')).toBe('0');
    expect(res.headers.get('x-vercel-ai-data-stream')).toBe('v1');

    const text = await readStreamToText(res.body);
    expect(text).toContain('caia-po');
    expect(text).toContain('decomposition');
    // AI SDK Data Stream Protocol — text chunks start with `0:`.
    expect(text).toMatch(/^0:/);
    // Final finish chunk uses prefix `d:`.
    expect(text).toContain('d:');
  });

  it('routes a coding prompt to caia-coding', async () => {
    const res = await POST(
      makeReq({
        messages: [{ role: 'user', content: 'Implement the new feature branch.' }]
      }) as never
    );
    expect(res.headers.get('x-caia-routed-agent')).toBe('caia-coding');
    expect(res.headers.get('x-caia-classification')).toBe('implementation');
  });

  it('forwards the prompt to the orchestrator when CAIA_ORCHESTRATOR_URL is set', async () => {
    process.env['CAIA_ORCHESTRATOR_URL'] = 'http://orchestrator.test';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ id: 'prm_abc123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const res = await POST(
      makeReq({
        messages: [{ role: 'user', content: 'Decompose this.' }]
      }) as never
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://orchestrator.test/prompts',
      expect.objectContaining({ method: 'POST' })
    );
    expect(res.headers.get('x-caia-forwarded')).toBe('1');
    expect(res.headers.get('x-caia-prompt-id')).toBe('prm_abc123');
    fetchSpy.mockRestore();
  });

  it('does NOT crash when the orchestrator returns 500', async () => {
    process.env['CAIA_ORCHESTRATOR_URL'] = 'http://orchestrator.test';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response('boom', { status: 500 });
    });

    const res = await POST(
      makeReq({ messages: [{ role: 'user', content: 'Decompose this.' }] }) as never
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-caia-forwarded')).toBe('0');
    fetchSpy.mockRestore();
  });

  it('does NOT crash when fetch itself rejects', async () => {
    process.env['CAIA_ORCHESTRATOR_URL'] = 'http://orchestrator.test';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('network down');
    });

    const res = await POST(
      makeReq({ messages: [{ role: 'user', content: 'Decompose this.' }] }) as never
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-caia-forwarded')).toBe('0');
    fetchSpy.mockRestore();
  });
});
