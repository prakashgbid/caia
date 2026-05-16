import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

import {
  callStructured,
  extractJson,
  StructuredOutputCancelled,
  StructuredOutputParseError,
} from '../src/structured-output.js';

import {
  fakeOllama,
  fakeClaude,
  installFakeAdapters,
  clearAdapters,
  jsonResponse,
  malformedResponse,
} from './_helpers.js';

const HappySchema = z.object({
  word: z.string().min(1),
  count: z.number().int().min(0),
});

describe('extractJson', () => {
  it('parses a clean JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    const raw = 'Here you go:\n```json\n{"a":1}\n```\n';
    expect(extractJson(raw)).toEqual({ a: 1 });
  });

  it('strips bare ``` fences', () => {
    expect(extractJson('```\n{"x":42}\n```')).toEqual({ x: 42 });
  });

  it('greedy-matches outermost { ... }', () => {
    expect(extractJson('lol talk talk { "y": 2 } more talk')).toEqual({ y: 2 });
  });

  it('returns null when no JSON is recoverable', () => {
    expect(extractJson('absolutely no JSON here at all')).toBeNull();
  });

  it('handles trailing commas by failing softly (returns null)', () => {
    expect(extractJson('{"a":1,}')).toBeNull();
  });

  it('handles nested objects', () => {
    expect(extractJson('{"a": {"b": [1,2,3]}}')).toEqual({
      a: { b: [1, 2, 3] },
    });
  });
});

describe('callStructured — happy paths', () => {
  beforeEach(() => clearAdapters());
  afterEach(() => clearAdapters());

  it('returns parsed data on a happy first attempt', async () => {
    const ollama = fakeOllama({
      responses: [jsonResponse({ word: 'hello', count: 3 })],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const result = await callStructured(HappySchema, {
      taskType: 'po-decomposer-scope-detection',
      systemPrompt: 'classify',
      userPrompt: 'do it',
    });

    expect(result.data).toEqual({ word: 'hello', count: 3 });
    expect(result.attempts).toBe(1);
    expect(result.provider).toBe('local');
    expect(result.costUsd).toBe(0);
    expect(result.durationMs).toBe(25);
  });

  it('parses successfully through markdown fences', async () => {
    const ollama = fakeOllama({
      responses: [
        { response: '```json\n{"word":"ok","count":1}\n```', durationMs: 15 },
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const result = await callStructured(HappySchema, {
      taskType: 'po-decomposer-scope-detection',
      systemPrompt: 'classify',
      userPrompt: 'do it',
    });

    expect(result.data).toEqual({ word: 'ok', count: 1 });
    expect(result.attempts).toBe(1);
  });

  it('attributes Claude cost when the rule routes Claude', async () => {
    const claude = fakeClaude({
      responses: [jsonResponse({ word: 'claude', count: 7 })],
    });
    installFakeAdapters(fakeOllama({ responses: [] }), claude);

    const result = await callStructured(HappySchema, {
      taskType: 'po-decomposer-initiative',
      systemPrompt: 'decompose',
      userPrompt: 'big initiative',
    });

    expect(result.data).toEqual({ word: 'claude', count: 7 });
    expect(result.provider).toBe('claude');
    expect(result.costUsd).toBeCloseTo(0.002, 5);
  });

  it('reports the model and usage on the winning attempt', async () => {
    const ollama = fakeOllama({
      responses: [
        {
          response: JSON.stringify({ word: 'hi', count: 1 }),
          model: 'qwen2.5-coder:7b',
          durationMs: 33,
          usage: { promptTokens: 100, completionTokens: 12, totalTokens: 112 },
        },
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const result = await callStructured(HappySchema, {
      taskType: 'po-decomposer-scope-detection',
      systemPrompt: 'classify',
      userPrompt: 'do it',
    });

    expect(result.model).toBe('qwen2.5-coder:7b');
    expect(result.usage?.promptTokens).toBe(100);
    expect(result.usage?.completionTokens).toBe(12);
  });
});

describe('callStructured — retry semantics', () => {
  beforeEach(() => clearAdapters());
  afterEach(() => clearAdapters());

  it('retries with feedback when the first response has wrong types', async () => {
    const ollama = fakeOllama({
      responses: [
        jsonResponse({ word: 'hi', count: 'not a number' }),
        jsonResponse({ word: 'hi', count: 5 }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const result = await callStructured(HappySchema, {
      taskType: 'po-decomposer-scope-detection',
      systemPrompt: 'classify',
      userPrompt: 'do it',
      maxRetries: 2,
    });

    expect(result.data).toEqual({ word: 'hi', count: 5 });
    expect(result.attempts).toBe(2);
    expect(result.durationMs).toBe(50);
  });

  it('retries when the first response has no JSON at all', async () => {
    const ollama = fakeOllama({
      responses: [
        malformedResponse('no JSON for you'),
        jsonResponse({ word: 'recovered', count: 2 }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const result = await callStructured(HappySchema, {
      taskType: 'po-decomposer-scope-detection',
      systemPrompt: 'classify',
      userPrompt: 'do it',
    });

    expect(result.data).toEqual({ word: 'recovered', count: 2 });
    expect(result.attempts).toBe(2);
  });

  it('throws StructuredOutputParseError after exhausting retries', async () => {
    const ollama = fakeOllama({
      responses: [
        jsonResponse({ word: 'a', count: 'still wrong' }),
        jsonResponse({ word: 'a', count: 'still wrong' }),
        jsonResponse({ word: 'a', count: 'still wrong' }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    await expect(
      callStructured(HappySchema, {
        taskType: 'po-decomposer-scope-detection',
        systemPrompt: 'classify',
        userPrompt: 'do it',
        maxRetries: 2,
      }),
    ).rejects.toBeInstanceOf(StructuredOutputParseError);
  });

  it('preserves the original taskType + last raw on parse failure', async () => {
    const ollama = fakeOllama({
      responses: [
        jsonResponse({ word: 'broken', count: 'nope' }),
        jsonResponse({ word: 'broken', count: 'nope' }),
        jsonResponse({ word: 'broken', count: 'nope' }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    try {
      await callStructured(HappySchema, {
        taskType: 'po-decomposer-scope-detection',
        systemPrompt: 'classify',
        userPrompt: 'do it',
        maxRetries: 2,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(StructuredOutputParseError);
      const e = err as StructuredOutputParseError;
      expect(e.taskType).toBe('po-decomposer-scope-detection');
      expect(e.attempts).toBe(3);
      expect(e.lastRaw).toContain('"word":"broken"');
    }
  });

  it('respects a maxRetries=0 setting (single attempt only)', async () => {
    // The local-llm-router escalates to Claude when the local response is
    // < MIN_RESPONSE_CHARS (=8 chars, see cascade-escalation.ts). The
    // previous fixture, `malformedResponse('no json')` (7 chars), tripped
    // that path and broke the test's assumption of a single
    // local-only attempt. Use a long-enough malformed body so we stay on
    // the local model and the parse failure is what propagates.
    const ollama = fakeOllama({
      responses: [malformedResponse('this is definitely not json output')],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    await expect(
      callStructured(HappySchema, {
        taskType: 'po-decomposer-scope-detection',
        systemPrompt: 'classify',
        userPrompt: 'do it',
        maxRetries: 0,
      }),
    ).rejects.toBeInstanceOf(StructuredOutputParseError);
  });
});

describe('callStructured — cancellation', () => {
  beforeEach(() => clearAdapters());
  afterEach(() => clearAdapters());

  it('honours an aborted signal before the first attempt', async () => {
    const ollama = fakeOllama({
      responses: [jsonResponse({ word: 'ok', count: 1 })],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const ac = new AbortController();
    ac.abort();

    await expect(
      callStructured(HappySchema, {
        taskType: 'po-decomposer-scope-detection',
        systemPrompt: 'classify',
        userPrompt: 'do it',
        signal: ac.signal,
      }),
    ).rejects.toBeInstanceOf(StructuredOutputCancelled);
  });
});
