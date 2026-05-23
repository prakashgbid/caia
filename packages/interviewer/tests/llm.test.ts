import { describe, expect, it } from 'vitest';
import { ScriptedLlmCaller, extractJsonObject } from '../src/llm.js';
import { InterviewerError } from '../src/errors.js';

describe('extractJsonObject', () => {
  it('parses bare JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses fenced JSON code blocks', () => {
    expect(extractJsonObject('Here you go:\n```json\n{"x":2}\n```')).toEqual({ x: 2 });
  });
  it('parses first balanced object embedded in prose', () => {
    expect(extractJsonObject('preface\n{"k":"v"}\ntrailer')).toEqual({ k: 'v' });
  });
  it('throws on empty', () => {
    expect(() => extractJsonObject('')).toThrowError(InterviewerError);
  });
  it('throws on non-JSON gibberish', () => {
    expect(() => extractJsonObject('this is just words without braces')).toThrowError(InterviewerError);
  });
  it('handles strings containing braces', () => {
    expect(extractJsonObject('{"s":"a{b}c"}')).toEqual({ s: 'a{b}c' });
  });
});

describe('ScriptedLlmCaller', () => {
  it('returns canned responses on match', async () => {
    const llm = new ScriptedLlmCaller([{ match: 'hello', response: '{"ok":true}' }]);
    const r = await llm.call('say hello');
    expect(r.ok).toBe(true);
    expect(r.text).toBe('{"ok":true}');
  });
  it('returns ok=false when no step matches and no default', async () => {
    const llm = new ScriptedLlmCaller([{ match: 'hello', response: 'x' }]);
    const r = await llm.call('different prompt');
    expect(r.ok).toBe(false);
  });
  it('falls back to defaultResponse', async () => {
    const llm = new ScriptedLlmCaller([], 'default');
    const r = await llm.call('anything');
    expect(r.text).toBe('default');
  });
  it('serializes object responses', async () => {
    const llm = new ScriptedLlmCaller([{ match: 'x', response: { a: 1 } }]);
    const r = await llm.call('x');
    expect(JSON.parse(r.text)).toEqual({ a: 1 });
  });
  it('tracks hit counts per step', async () => {
    const llm = new ScriptedLlmCaller([
      { match: 'a', response: '1' },
      { match: 'b', response: '2' },
    ]);
    await llm.call('a here');
    await llm.call('a here');
    await llm.call('b here');
    expect(llm.hits(0)).toBe(2);
    expect(llm.hits(1)).toBe(1);
    expect(llm.totalCalls()).toBe(3);
  });
});
