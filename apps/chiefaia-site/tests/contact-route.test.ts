/**
 * /api/contact route handler — validates the JSON shape.
 */

import { describe, expect, it } from 'vitest';
import { POST } from '../app/api/contact/route';

function jsonReq(body: unknown) {
  return new Request('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/contact', () => {
  it('accepts a well-formed payload', async () => {
    const res = await POST(
      jsonReq({
        name: 'Operator',
        email: 'op@example.com',
        message: 'Hello, please reply.',
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('refuses malformed JSON', async () => {
    const res = await POST(jsonReq('not-json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: 'invalid_json' });
  });

  it('refuses missing fields', async () => {
    const res = await POST(jsonReq({ name: 'X', email: 'x@y.com' }));
    expect(res.status).toBe(400);
  });

  it('refuses a short message', async () => {
    const res = await POST(
      jsonReq({ name: 'Op', email: 'op@example.com', message: 'hi' })
    );
    expect(res.status).toBe(400);
  });

  it('refuses an invalid email', async () => {
    const res = await POST(
      jsonReq({ name: 'Op', email: 'not-an-email', message: 'long enough now' })
    );
    expect(res.status).toBe(400);
  });
});
