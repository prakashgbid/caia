// R-2 — model-override bypass guard.
//
// /v1/chat/completions used to accept `model: "claude-opus-4-7"` (or any
// other hard provider model name) and silently route through whatever the
// router picked, while the caller believed they had pinned. This test
// pins the new contract: hard model names → 400; advisory hints → pass
// through; omitted/empty → pass through.

import { describe, it, expect } from 'vitest';
import { buildApp, ADVISORY_MODEL_HINTS } from '../src/server.js';

describe('R-2: /v1/chat/completions caller-supplied model field', () => {
  it('rejects a Claude model NAME with 400 model-pinning-not-allowed', async () => {
    const app = buildApp();
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        messages: [{ role: 'user', content: 'hello' }],
        caia_task_type: 'commit-message',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as {
      error: string;
      allowed_hints: string[];
      rejected_value: string;
    };
    expect(body.error).toBe('model-pinning-not-allowed');
    expect(body.rejected_value).toBe('claude-opus-4-7');
    expect(body.allowed_hints).toEqual(expect.arrayContaining(['prefer-fast', 'prefer-local']));
  });

  it('rejects a local model NAME (qwen2.5-coder:32b) with 400', async () => {
    const app = buildApp();
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5-coder:32b',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('model-pinning-not-allowed');
  });

  it('rejects gibberish model strings with 400', async () => {
    const app = buildApp();
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'totally-made-up-model-name-7000',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('model-pinning-not-allowed');
  });

  it('treats empty-string model as omitted (no 400)', { timeout: 30000 }, async () => {
    const app = buildApp();
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: '',
        messages: [{ role: 'user', content: 'hi' }],
        caia_task_type: 'commit-message',
      }),
    });
    expect(res.status).not.toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).not.toBe('model-pinning-not-allowed');
  });

  it('accepts every advisory hint in ADVISORY_MODEL_HINTS without 400', { timeout: 30000 }, async () => {
    const app = buildApp();
    for (const hint of ADVISORY_MODEL_HINTS) {
      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: hint,
          messages: [{ role: 'user', content: 'hi' }],
          caia_task_type: 'commit-message',
        }),
      });
      // Either 200 (router executed against a live Ollama) or 502 (no
      // Ollama in CI). Both prove the validation path didn't reject.
      expect([200, 502]).toContain(res.status);
      const body = await res.json() as { error?: string };
      expect(body.error).not.toBe('model-pinning-not-allowed');
    }
  });

  it('omitting model entirely is fine (pre-R-2 behavior preserved)', { timeout: 30000 }, async () => {
    const app = buildApp();
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        caia_task_type: 'commit-message',
      }),
    });
    expect([200, 502]).toContain(res.status);
    const body = await res.json() as { error?: string };
    expect(body.error).not.toBe('model-pinning-not-allowed');
  });

  it('echoes validated advisory_hint back in response.caia (when router succeeds)', { timeout: 30000 }, async () => {
    // Best-effort: if Ollama isn't available the router throws and we get
    // 502 with no `caia` block — that's CI-acceptable. When Ollama IS up,
    // we expect `caia.advisory_hint === 'prefer-fast'`.
    const app = buildApp();
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'prefer-fast',
        messages: [{ role: 'user', content: 'hi' }],
        caia_task_type: 'commit-message',
      }),
    });
    if (res.status === 200) {
      const body = await res.json() as { caia: { advisory_hint: string } };
      expect(body.caia.advisory_hint).toBe('prefer-fast');
    }
  });
});
