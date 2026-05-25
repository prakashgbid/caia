import { describe, expect, it } from 'vitest';
import {
  makeClaudeIntentClassifier,
  makeClaudeExpectedChangeWriter,
  makeHeuristicClassifier,
  makeNoopExpectedChangeWriter,
  parseScopeClassification,
  type LlmInvoker,
} from '../src/scope-resolver.js';

const dummyTicket = { id: 'WD-x', domId: 'WD-x' };

describe('makeHeuristicClassifier', () => {
  it('classifies typography as self-only', async () => {
    const r = await makeHeuristicClassifier()({ prompt: 'make this serif and 1.5x bigger', ticket: dummyTicket, selection: ['WD-x'] });
    expect(r.kind).toBe('self-only');
    expect(r.reason).toContain('serif');
  });
  it('classifies rebuild as subtree', async () => {
    const r = await makeHeuristicClassifier()({ prompt: 'rebuild the hero', ticket: dummyTicket, selection: ['SE-x'] });
    expect(r.kind).toBe('subtree');
  });
  it('classifies layout as page', async () => {
    const r = await makeHeuristicClassifier()({ prompt: 'change the layout of the whole page', ticket: dummyTicket, selection: ['PG-home'] });
    expect(r.kind).toBe('page');
  });
  it('default self-only on no keyword', async () => {
    const r = await makeHeuristicClassifier()({ prompt: 'do the thing', ticket: dummyTicket, selection: ['WD-x'] });
    expect(r.kind).toBe('self-only');
    expect(r.reason).toContain('no broader-scope');
  });
  it('honors custom hint lists', async () => {
    const c = makeHeuristicClassifier({ sectionHints: ['floof'], pageHints: ['gloop'], selfHints: [] });
    expect((await c({ prompt: 'floof it', ticket: dummyTicket, selection: ['x'] })).kind).toBe('subtree');
    expect((await c({ prompt: 'gloop it', ticket: dummyTicket, selection: ['x'] })).kind).toBe('page');
  });
  it('is case-insensitive', async () => {
    const r = await makeHeuristicClassifier()({ prompt: 'REBUILD the hero', ticket: dummyTicket, selection: ['x'] });
    expect(r.kind).toBe('subtree');
  });
});

describe('parseScopeClassification', () => {
  it('parses valid JSON', () => {
    expect(parseScopeClassification('{"scope":"self-only","reason":"r1"}')).toEqual({ kind: 'self-only', reason: 'r1' });
  });
  it('tolerates surrounding prose', () => {
    const r = parseScopeClassification('Answer: {"scope":"subtree","reason":"all slides"} end');
    expect(r.kind).toBe('subtree');
  });
  it('falls back on unparseable JSON', () => {
    expect(parseScopeClassification('not json').kind).toBe('self-only');
  });
  it('falls back on invalid scope', () => {
    expect(parseScopeClassification('{"scope":"global","reason":"r"}').kind).toBe('self-only');
  });
  it('falls back on array shape', () => {
    expect(parseScopeClassification('["self-only"]').kind).toBe('self-only');
  });
  it('uses default reason when reason missing', () => {
    expect(parseScopeClassification('{"scope":"page","reason":""}').reason).toBe('classifier returned no reason');
  });
  it('uses caller fallback', () => {
    const r = parseScopeClassification('garbage', { kind: 'subtree', reason: 'cb' });
    expect(r.kind).toBe('subtree');
    expect(r.reason).toBe('cb');
  });
});

describe('makeClaudeIntentClassifier', () => {
  it('passes prompt + ticket to invoker', async () => {
    const seen: Array<{ system: string; user: string; model: string }> = [];
    const invoke: LlmInvoker = async (input) => {
      seen.push({ system: input.system, user: input.user, model: input.model });
      return '{"scope":"subtree","reason":"big change"}';
    };
    const c = makeClaudeIntentClassifier({ invoke });
    const r = await c({ prompt: 'rebuild it', ticket: { id: 'SE-hero', domId: 'SE-hero' }, selection: ['SE-hero', 'WD-x'] });
    expect(r.kind).toBe('subtree');
    expect(seen[0]!.user).toContain('SE-hero');
    expect(seen[0]!.user).toContain('Multi-select size: 2');
    expect(seen[0]!.model).toBe('claude-haiku-4-5-20251001');
  });
  it('honors model + maxTokens overrides', async () => {
    const seen: Array<{ model: string; maxTokens: number }> = [];
    const invoke: LlmInvoker = async (input) => {
      seen.push({ model: input.model, maxTokens: input.maxTokens });
      return '{"scope":"self-only","reason":"r"}';
    };
    const c = makeClaudeIntentClassifier({ invoke, model: 'claude-sonnet-4-6', maxTokens: 1024 });
    await c({ prompt: 'p', ticket: dummyTicket, selection: ['x'] });
    expect(seen[0]).toEqual({ model: 'claude-sonnet-4-6', maxTokens: 1024 });
  });
  it('falls back gracefully on garbage', async () => {
    const invoke: LlmInvoker = async () => 'I cannot help with that.';
    const r = await makeClaudeIntentClassifier({ invoke })({ prompt: 'p', ticket: dummyTicket, selection: ['x'] });
    expect(r.kind).toBe('self-only');
  });
  it('uses caller-supplied fallback', async () => {
    const invoke: LlmInvoker = async () => 'garbage';
    const r = await makeClaudeIntentClassifier({ invoke, fallback: { kind: 'page', reason: 'pf' } })({ prompt: 'p', ticket: dummyTicket, selection: ['x'] });
    expect(r.kind).toBe('page');
  });
});

describe('makeClaudeExpectedChangeWriter', () => {
  it('returns trimmed model output', async () => {
    const invoke: LlmInvoker = async () => '  Change typography of headline.  ';
    const out = await makeClaudeExpectedChangeWriter({ invoke })({ prompt: 'p', ticket: dummyTicket, scope: 'self-only' });
    expect(out).toBe('Change typography of headline.');
  });
  it('forwards model + maxTokens', async () => {
    const seen: Array<{ model: string; maxTokens: number }> = [];
    const invoke: LlmInvoker = async (input) => {
      seen.push({ model: input.model, maxTokens: input.maxTokens });
      return 'ok';
    };
    await makeClaudeExpectedChangeWriter({ invoke, model: 'claude-opus-4-6', maxTokens: 64 })({ prompt: 'p', ticket: dummyTicket, scope: 'page' });
    expect(seen[0]).toEqual({ model: 'claude-opus-4-6', maxTokens: 64 });
  });
});

describe('makeNoopExpectedChangeWriter', () => {
  it('echoes the prompt with a prefix', () => {
    const out = makeNoopExpectedChangeWriter('Change')({ prompt: 'do something', ticket: dummyTicket, scope: 'self-only' });
    expect(out).toBe('Change WD-x — do something');
  });
});
