/**
 * Output validation tests — verifies the contract validator catches
 * every documented error class and accepts well-formed outputs.
 */

import { describe, it, expect } from 'vitest';

import { SEO_OWNED_FIELD_KEYS } from '../src/contract.js';
import { stripFences, validateArchitectOutput } from '../src/validation.js';
import { goldenAssistantText, goldenExpectedOutput } from './helpers/fakes.js';

describe('validateArchitectOutput — happy path', () => {
  it('accepts the canonical golden output', () => {
    const result = validateArchitectOutput(goldenAssistantText(), SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.parsed?.architectName).toBe('seo');
    expect(result.parsed?.status).toBe('ok');
  });

  it('accepts JSON wrapped in ```json fences', () => {
    const fenced = '```json\n' + goldenAssistantText() + '\n```';
    const result = validateArchitectOutput(fenced, SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(true);
  });

  it('accepts JSON wrapped in plain ``` fences', () => {
    const fenced = '```\n' + goldenAssistantText() + '\n```';
    const result = validateArchitectOutput(fenced, SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(true);
  });
});

describe('validateArchitectOutput — error paths', () => {
  it('rejects invalid JSON', () => {
    const result = validateArchitectOutput('{not json', SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('invalid-json');
  });

  it('rejects a top-level array', () => {
    const result = validateArchitectOutput('[1,2,3]', SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('wrong-top-level-type');
  });

  it('rejects null top-level', () => {
    const result = validateArchitectOutput('null', SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('wrong-top-level-type');
  });

  it('flags missing top-level keys', () => {
    const result = validateArchitectOutput('{"architectName":"seo"}', SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(false);
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain('missing-top-level-key');
  });

  it('flags a missing owned field', () => {
    const golden = goldenExpectedOutput();
    const fields = { ...golden.architectureFields } as Record<string, unknown>;
    delete fields['seo.schemaOrgJsonLd'];
    const corrupted = { ...golden, architectureFields: fields };
    const result = validateArchitectOutput(JSON.stringify(corrupted), SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'missing-owned-field')).toBe(true);
  });

  it('flags an unexpected field outside the owned namespace', () => {
    const golden = goldenExpectedOutput();
    const fields = {
      ...golden.architectureFields,
      'frontend.componentTree': 'not yours to declare'
    };
    const corrupted = { ...golden, architectureFields: fields };
    const result = validateArchitectOutput(JSON.stringify(corrupted), SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'unexpected-field')).toBe(true);
  });

  it('flags out-of-range confidence', () => {
    const corrupted = { ...goldenExpectedOutput(), confidence: 1.5 };
    const result = validateArchitectOutput(JSON.stringify(corrupted), SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'confidence-out-of-range')).toBe(true);
  });

  it('flags negative confidence', () => {
    const corrupted = { ...goldenExpectedOutput(), confidence: -0.1 };
    const result = validateArchitectOutput(JSON.stringify(corrupted), SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'confidence-out-of-range')).toBe(true);
  });

  it('flags overly long notes', () => {
    const corrupted = { ...goldenExpectedOutput(), notes: 'x'.repeat(801) };
    const result = validateArchitectOutput(JSON.stringify(corrupted), SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'notes-too-long')).toBe(true);
  });

  it('flags too many risk entries', () => {
    const corrupted = {
      ...goldenExpectedOutput(),
      risks: ['a', 'b', 'c', 'd', 'e', 'f']
    };
    const result = validateArchitectOutput(JSON.stringify(corrupted), SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'too-many-risks')).toBe(true);
  });

  it('flags invalid status', () => {
    const corrupted = { ...goldenExpectedOutput(), status: 'bananas' };
    const result = validateArchitectOutput(JSON.stringify(corrupted), SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'invalid-status')).toBe(true);
  });

  it('accepts every legal status value', () => {
    for (const s of ['ok', 'partial', 'failed']) {
      const variant = { ...goldenExpectedOutput(), status: s };
      const result = validateArchitectOutput(JSON.stringify(variant), SEO_OWNED_FIELD_KEYS);
      expect(result.ok).toBe(true);
    }
  });
});

describe('stripFences', () => {
  it('strips ```json fences', () => {
    const out = stripFences('```json\n{"x":1}\n```');
    expect(out).toBe('{"x":1}');
  });

  it('strips plain ``` fences', () => {
    const out = stripFences('```\n{"x":1}\n```');
    expect(out).toBe('{"x":1}');
  });

  it('passes plain JSON through unchanged', () => {
    const out = stripFences('{"x":1}');
    expect(out).toBe('{"x":1}');
  });

  it('trims surrounding whitespace', () => {
    expect(stripFences('   {"x":1}   ')).toBe('{"x":1}');
  });
});
