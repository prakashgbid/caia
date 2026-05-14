import { describe, expect, it, vi } from 'vitest';

import {
  DISTILL_PROMPT_TEMPLATE,
  LOCAL_LLM_ROUTER_DEFAULT_MODEL,
  LOCAL_LLM_ROUTER_DEFAULT_URL,
  createDefaultDistiller,
  createDistiller,
  createLocalLlmRouterDistiller,
  parseDistillerOutput,
  parseInstructionJson
} from '../src/distiller.js';
import type { ClaudeDistiller, DistillOutput } from '../src/types.js';

describe('parseDistillerOutput', () => {
  it('parses claude envelope + inner JSON', () => {
    const inner = JSON.stringify({ instruction: 'q', response: 'a' });
    const outer = JSON.stringify({ result: inner });
    expect(parseDistillerOutput(outer)).toEqual({ instruction: 'q', response: 'a' });
  });

  it('throws on malformed envelope', () => {
    expect(() => parseDistillerOutput('not json')).toThrow();
  });

  it('throws when result is not a string', () => {
    expect(() => parseDistillerOutput(JSON.stringify({ result: 123 }))).toThrow();
  });

  it('throws on malformed inner JSON', () => {
    expect(() => parseDistillerOutput(JSON.stringify({ result: 'not-json' }))).toThrow();
  });

  it('throws when inner JSON missing fields', () => {
    expect(() =>
      parseDistillerOutput(JSON.stringify({ result: JSON.stringify({ x: 1 }) }))
    ).toThrow();
  });
});

describe('parseInstructionJson', () => {
  it('parses plain JSON', () => {
    const s = JSON.stringify({ instruction: 'q', response: 'a' });
    expect(parseInstructionJson(s)).toEqual({ instruction: 'q', response: 'a' });
  });

  it('strips ```json code fences (qwen2.5-coder default output shape)', () => {
    const fenced = '```json\n{"instruction":"q","response":"a"}\n```';
    expect(parseInstructionJson(fenced)).toEqual({ instruction: 'q', response: 'a' });
  });

  it('strips bare ``` fences without language tag', () => {
    const fenced = '```\n{"instruction":"q","response":"a"}\n```';
    expect(parseInstructionJson(fenced)).toEqual({ instruction: 'q', response: 'a' });
  });

  it('extracts JSON object embedded in surrounding prose', () => {
    const prose =
      'Sure, here is the pair:\n{"instruction":"q","response":"a"}\nLet me know if you need more.';
    expect(parseInstructionJson(prose)).toEqual({ instruction: 'q', response: 'a' });
  });

  it('throws when neither instruction nor response are strings', () => {
    expect(() => parseInstructionJson(JSON.stringify({ x: 1 }))).toThrow();
  });
});

describe('createDefaultDistiller (claude-binary backend)', () => {
  it('strips ANTHROPIC_API_KEY from spawn env', async () => {
    const fakeSpawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ result: JSON.stringify({ instruction: 'q', response: 'a' }) }),
      stderr: '',
      error: null
    });
    const distiller = createDefaultDistiller({
      binaryPath: 'claude',
      spawnFn: fakeSpawn as never
    });
    process.env['ANTHROPIC_API_KEY'] = 'should-not-leak';
    await distiller.distill({ source: 'memory', kind: 'directive', text: 'x' });
    const callOpts = fakeSpawn.mock.calls[0]?.[2] as { env: Record<string, string | undefined> };
    expect(callOpts.env['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('throws on non-zero exit', async () => {
    const fakeSpawn = vi.fn().mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'rate limit',
      error: null
    });
    const distiller = createDefaultDistiller({
      binaryPath: 'claude',
      spawnFn: fakeSpawn as never
    });
    await expect(
      distiller.distill({ source: 'memory', text: 'x' })
    ).rejects.toThrow(/exited 1/);
  });

  it('passes prompt as input', async () => {
    const fakeSpawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ result: JSON.stringify({ instruction: 'q', response: 'a' }) }),
      stderr: '',
      error: null
    });
    const distiller = createDefaultDistiller({
      binaryPath: 'claude',
      spawnFn: fakeSpawn as never
    });
    await distiller.distill({ source: 'memory', kind: 'directive', text: 'BODY' });
    const callOpts = fakeSpawn.mock.calls[0]?.[2] as { input: string };
    expect(callOpts.input).toContain('BODY');
    expect(callOpts.input).toContain('memory/directive');
  });
});

describe('DISTILL_PROMPT_TEMPLATE', () => {
  it('contains placeholder slots', () => {
    expect(DISTILL_PROMPT_TEMPLATE).toContain('{source}');
    expect(DISTILL_PROMPT_TEMPLATE).toContain('{kind}');
    expect(DISTILL_PROMPT_TEMPLATE).toContain('{text}');
  });
});

describe('createLocalLlmRouterDistiller', () => {
  const goodHealth = (): Response =>
    new Response(JSON.stringify({ ok: true }), { status: 200 });
  const goodChat = (instruction: string, response: string): Response =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '```json\n' + JSON.stringify({ instruction, response }) + '\n```'
            }
          }
        ]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );

  function neverCalledFallback(): ClaudeDistiller {
    return {
      distill: vi.fn().mockRejectedValue(new Error('fallback should not be called'))
    };
  }

  it('POSTs to /v1/chat/completions with qwen2.5-coder:7b and parses fenced JSON', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => goodHealth())
      .mockImplementationOnce(async () => goodChat('q', 'a'));

    const distiller = createLocalLlmRouterDistiller({
      fetchFn,
      fallback: neverCalledFallback()
    });

    const out = await distiller.distill({ source: 'memory', kind: 'directive', text: 'BODY' });
    expect(out).toEqual({ instruction: 'q', response: 'a' });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [healthUrl, healthInit] = fetchFn.mock.calls[0]!;
    expect(String(healthUrl)).toBe(`${LOCAL_LLM_ROUTER_DEFAULT_URL}/healthz`);
    expect((healthInit as RequestInit | undefined)?.method ?? 'GET').toBe('GET');

    const [chatUrl, chatInit] = fetchFn.mock.calls[1]!;
    expect(String(chatUrl)).toBe(`${LOCAL_LLM_ROUTER_DEFAULT_URL}/v1/chat/completions`);
    const init = chatInit as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe(LOCAL_LLM_ROUTER_DEFAULT_MODEL);
    expect(body.messages[0]?.role).toBe('user');
    expect(body.messages[0]?.content).toContain('BODY');
    expect(body.messages[0]?.content).toContain('memory/directive');
  });

  it('falls back to claude-binary when /healthz is unhealthy', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('upstream down', { status: 503 }));

    const fallbackOut: DistillOutput = { instruction: 'fb-q', response: 'fb-a' };
    const fallback: ClaudeDistiller = {
      distill: vi.fn().mockResolvedValue(fallbackOut)
    };

    const distiller = createLocalLlmRouterDistiller({ fetchFn, fallback });

    const result = await distiller.distill({ source: 'memory', text: 'X' });
    expect(result).toEqual(fallbackOut);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fallback.distill).toHaveBeenCalledOnce();
  });

  it('falls back when /healthz throws (e.g. connection refused)', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const fallback: ClaudeDistiller = {
      distill: vi.fn().mockResolvedValue({ instruction: 'fb-q', response: 'fb-a' })
    };
    const distiller = createLocalLlmRouterDistiller({ fetchFn, fallback });
    await expect(distiller.distill({ source: 'memory', text: 'X' })).resolves.toEqual({
      instruction: 'fb-q',
      response: 'fb-a'
    });
    expect(fallback.distill).toHaveBeenCalledOnce();
  });

  it('throws (without falling back) when the chat call returns non-2xx', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(goodHealth())
      .mockResolvedValueOnce(new Response('bad model', { status: 502 }));

    const fallback = neverCalledFallback();
    const distiller = createLocalLlmRouterDistiller({ fetchFn, fallback });
    await expect(distiller.distill({ source: 'memory', text: 'X' })).rejects.toThrow(/502/);
    expect(fallback.distill).not.toHaveBeenCalled();
  });

  it('throws on malformed chat completion body', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(goodHealth())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    const distiller = createLocalLlmRouterDistiller({
      fetchFn,
      fallback: neverCalledFallback()
    });
    await expect(distiller.distill({ source: 'memory', text: 'X' })).rejects.toThrow(
      /choices\[\]/
    );
  });
});

describe('createDistiller (backend selector)', () => {
  it('defaults to claude-binary when backend is undefined', async () => {
    const fakeSpawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ result: JSON.stringify({ instruction: 'q', response: 'a' }) }),
      stderr: '',
      error: null
    });
    const distiller = createDistiller({
      backend: undefined,
      claudeBinaryPath: 'claude',
      spawnFn: fakeSpawn as never
    });
    const out = await distiller.distill({ source: 'memory', text: 'X' });
    expect(out).toEqual({ instruction: 'q', response: 'a' });
    expect(fakeSpawn).toHaveBeenCalledOnce();
  });

  it('uses claude-binary when backend="claude-binary"', async () => {
    const fakeSpawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ result: JSON.stringify({ instruction: 'q', response: 'a' }) }),
      stderr: '',
      error: null
    });
    const distiller = createDistiller({
      backend: 'claude-binary',
      claudeBinaryPath: 'claude',
      spawnFn: fakeSpawn as never
    });
    await distiller.distill({ source: 'memory', text: 'X' });
    expect(fakeSpawn).toHaveBeenCalledOnce();
  });

  it('uses local-llm-router when backend="local-llm-router"', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              { message: { role: 'assistant', content: '{"instruction":"q","response":"a"}' } }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fakeSpawn = vi.fn();
    const distiller = createDistiller({
      backend: 'local-llm-router',
      claudeBinaryPath: 'claude',
      fetchFn,
      spawnFn: fakeSpawn as never
    });
    const out = await distiller.distill({ source: 'memory', text: 'X' });
    expect(out).toEqual({ instruction: 'q', response: 'a' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fakeSpawn).not.toHaveBeenCalled();
  });

  it('falls back to claude-binary spawn when local-llm-router is unhealthy', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('down', { status: 503 }));
    const fakeSpawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        result: JSON.stringify({ instruction: 'fb-q', response: 'fb-a' })
      }),
      stderr: '',
      error: null
    });
    const distiller = createDistiller({
      backend: 'local-llm-router',
      claudeBinaryPath: 'claude',
      fetchFn,
      spawnFn: fakeSpawn as never
    });
    const out = await distiller.distill({ source: 'memory', text: 'X' });
    expect(out).toEqual({ instruction: 'fb-q', response: 'fb-a' });
    expect(fakeSpawn).toHaveBeenCalledOnce();
  });

  it('falls back to claude-binary for unknown backend values', async () => {
    const fakeSpawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ result: JSON.stringify({ instruction: 'q', response: 'a' }) }),
      stderr: '',
      error: null
    });
    const distiller = createDistiller({
      backend: 'bogus-value',
      claudeBinaryPath: 'claude',
      spawnFn: fakeSpawn as never
    });
    await distiller.distill({ source: 'memory', text: 'X' });
    expect(fakeSpawn).toHaveBeenCalledOnce();
  });
});
